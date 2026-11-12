import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components";
import { colors, spacing } from "@/constants/theme";
import { AuthContext } from "@/features/auth/AuthProvider";
import { PurchasingScreen } from "@/features/purchasing";
import { queryClient } from "@/services/data";
import { connectivity, useIsOnline } from "@/services/offline";
import { outboxStore } from "@/services/offline/outboxStore";
import { supabase } from "@/services/supabase";
import type { Profile } from "@/types/auth";

// Dev-only: Purchasing with pretend data from the Figma frames (today is
// Thu, 27 Aug 2026 in Manila). Requests are answered here; nothing reaches a server.

const customer = (business_name: string, delivery_address: string) => ({ business_name, delivery_address });
const line = (id: string, name: string, quantity: number, unit: string, done = false, notes: string | null = null) => ({
  id, quantity, unit_of_measurement: unit, notes, preparation_status: done ? "completed" : "pending", products: { product_name: name },
});
const ORDERS = [
  { id: "o46", order_number: "ORD-1046", requested_delivery_date: "2026-08-27", status: "for_preparation", customers: customer("Luntian Grocers", "21 Kalayaan Ave., Quezon City"),
    order_items: [line("l1", "Cabbage", 20, "head", true), line("l2", "Tomatoes", 25, "kg"), line("l3", "Lakatan bananas", 30, "kg", true), line("l4", "Red onions", 16, "kg", false, "Small bulbs only")] },
  { id: "o47", order_number: "ORD-1047", requested_delivery_date: "2026-08-28", status: "confirmed", customers: customer("Sampaguita Hotel", "88 Roxas Blvd., Pasay"),
    order_items: [line("m1", "Tomatoes", 10, "kg"), line("m2", "Calamansi", 3, "kg"), line("m3", "Romaine lettuce", 3, "kg")] },
  { id: "o48", order_number: "ORD-1048", requested_delivery_date: "2026-08-30", status: "confirmed", customers: customer("Casa Verde Restaurant", "12 Mabini St., Poblacion, Makati"),
    order_items: [line("n1", "Tomatoes", 6, "kg"), line("n2", "Lakatan bananas", 15, "kg"), line("n3", "Carabao mangoes", 2, "crate")] },
  { id: "o49", order_number: "ORD-1049", requested_delivery_date: "2026-08-31", status: "confirmed", customers: customer("Kusina ni Maria", "3 Aguinaldo Hwy., Imus, Cavite"),
    order_items: [line("p1", "Red onions", 5, "kg"), line("p2", "Calamansi", 3, "kg"), line("p3", "Cabbage", 0.5, "head")] },
];
// Changed after packing (Jac, 5 Nov): tomatoes went from 8 to 12 kg (unticked),
// the lettuce note changed (tick kept, "Note changed" shown) and packed
// calamansi was removed (to be confirmed as taken out). The delivery stays booked.
const REPACK = {
  id: "o45", order_number: "ORD-1045", requested_delivery_date: "2026-08-27", status: "for_preparation", packing_version: 2,
  customers: customer("Casa Verde Restaurant", "12 Mabini St., Poblacion, Makati"),
  deliveries: [{ id: "d45", status: "scheduled" }],
  order_items: [
    line("r1", "Tomatoes", 12, "kg"),
    { ...line("r2", "Romaine lettuce", 2, "kg", true, "Wrap separately, keep cold"), note_changed_at: "2026-08-27T01:10:00Z" },
    line("r3", "Cabbage", 4, "head", true),
  ],
  order_item_removals: [{ id: "x1", description: "Calamansi", quantity: 2, unit_of_measurement: "kg", removed_at: "2026-08-27T01:10:00Z", confirmed_at: null as string | null }],
};
// Figma "Purchasing · To buy": demand, stock on hand, and "Buy X more" when short (prototype, 5 Nov).
const BUY_LINES = [
  { product_id: "b1", product_name: "Lakatan bananas", unit: "kg", unit_key: "kg", quantity: 45, order_count: 2, stock: 60 },
  { product_id: "b2", product_name: "Tomatoes", unit: "kg", unit_key: "kg", quantity: 41, order_count: 3, stock: 120 },
  { product_id: "b3", product_name: "Red onions", unit: "kg", unit_key: "kg", quantity: 21, order_count: 2, stock: 18 },
  { product_id: "b4", product_name: "Cabbage", unit: "head", unit_key: "head", quantity: 20, order_count: 1, stock: 40 },
  { product_id: "b5", product_name: "Calamansi", unit: "kg", unit_key: "kg", quantity: 6, order_count: 2, stock: 25 },
  { product_id: "b6", product_name: "Romaine lettuce", unit: "kg", unit_key: "kg", quantity: 3, order_count: 1, stock: 9 },
  { product_id: "b7", product_name: "Carabao mangoes", unit: "crate", unit_key: "crate", quantity: 2, order_count: 1, stock: 12 },
];

function buyList(from: unknown, to: unknown, scale: number) {
  const items = BUY_LINES.map((line) => {
    const quantity = line.quantity * scale;
    const short = Math.max(quantity - line.stock, 0);
    return { ...line, quantity, order_count: line.order_count + (scale - 1), track_stock: true, bought: 0, remaining: short, short_by: short };
  });
  return { today: "2026-08-27", from, to, overdue_orders: mode === "late" ? 1 : 0, items, short_lines: items.filter((i) => i.short_by > 0).length, total_lines: items.length };
}

let mode: Preview = "staff";
let board: Record<string, any>[] = structuredClone(ORDERS);

function fakeQuery(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (value: unknown) => void) => setTimeout(() => resolve({ data: table === "orders" ? structuredClone(board) : [], error: null }), 120);
      return () => chain;
    },
  });
  return chain;
}

async function fakeRpc(name: string, args: Record<string, unknown>) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (name === "manila_today") return { data: "2026-08-27", error: null };
  if (name === "get_buy_list") {
    const custom = args.p_from !== null;
    return { data: buyList(args.p_from, args.p_to ?? "2026-08-28", custom ? 2 : 1), error: null };
  }
  if (name === "set_item_packed" || name === "offline_set_item_packed") {
    if (mode === "ticked_elsewhere") return { data: null, status: 400, error: { message: "Tomato was unticked by Ana Reyes after you ticked it. Check the line and tick it again if it’s packed.", code: "OFCON", details: "", hint: "" } };
    if (mode === "cancelled") return { data: null, error: { message: "This order was cancelled, so it can no longer be packed.", code: "P0001", details: "", hint: "" } };
    board = board.map((order) => ({ ...order, order_items: order.order_items.map((item: Record<string, unknown>) => (item.id === args.p_item_id ? { ...item, preparation_status: args.p_packed ? "completed" : "in_progress", note_changed_at: args.p_packed ? null : item.note_changed_at } : item)) }));
    const order = board.find((o) => o.order_items.some((item: Record<string, unknown>) => item.id === args.p_item_id));
    return { data: { order_id: order?.id, status: "for_preparation", packed_count: order?.order_items.filter((i: Record<string, unknown>) => i.preparation_status === "completed").length, item_count: order?.order_items.length }, error: null };
  }
  if (name === "confirm_item_removed") {
    board = board.map((order) => ({ ...order, order_item_removals: order.order_item_removals?.map((r: Record<string, unknown>) => (r.id === args.p_removal_id ? { ...r, confirmed_at: "2026-08-27T01:20:00Z" } : r)) }));
    return { data: { status: "for_preparation", removal_id: args.p_removal_id }, error: null };
  }
  if (name === "start_packing" || name === "cancel_packing") {
    board = board.map((order) => (order.id === args.p_order_id ? { ...order, status: name === "start_packing" ? "for_preparation" : "confirmed" } : order));
    return { data: { order_id: args.p_order_id, status: name === "start_packing" ? "for_preparation" : "confirmed" }, error: null };
  }
  return { data: null, error: null };
}

type Preview = "staff" | "repacking" | "late" | "cancelled" | "offline" | "ticked_elsewhere";
const PREVIEWS: { key: Preview; label: string }[] = [
  { key: "staff", label: "Purchasing staff" },
  { key: "repacking", label: "Changed after packing" },
  { key: "late", label: "With a late order" },
  { key: "cancelled", label: "Order cancelled elsewhere" },
  { key: "offline", label: "Packer offline" },
  { key: "ticked_elsewhere", label: "Offline, then unticked elsewhere" },
];

function install(preview: Preview): Preview {
  const client = supabase as unknown as { from: unknown; rpc: unknown };
  client.from = fakeQuery;
  client.rpc = fakeRpc;
  mode = preview;
  board = structuredClone(preview === "repacking" ? [REPACK, ...ORDERS] : ORDERS);
  queryClient.clear();
  // After this render: changing the connection updates other components.
  setTimeout(() => {
    void outboxStore.openPreview("preview");
    // Load the board first (as if opened online), then lose the connection.
    connectivity.force(true);
    if (preview === "offline" || preview === "ticked_elsewhere") setTimeout(() => connectivity.force(false), 900);
  }, 0);
  return preview;
}

export default function PurchasingPreview() {
  const [preview, setPreview] = useState<Preview>(() => install("staff"));
  const online = useIsOnline();
  const value = useMemo(() => {
    const profile: Profile = {
      id: "preview", full_name: "Rico Cruz", email: "", username: "rico.cruz", role: "fulfillment_staff", status: "active",
      must_change_password: false, must_change_reason: null, temp_password_expires_at: null, created_at: "", updated_at: "",
    };
    return {
      session: null, user: null, initialized: true, error: null, profile,
      isActive: true, needsPasswordChange: false, welcomePending: false, knowsCurrentPassword: false,
      matchesSignInPassword: () => false,
      signIn: async () => null, changePassword: async () => ({ ok: true as const }), finishWelcome: () => {},
      signOut: async () => {}, refreshProfile: async () => null, realRole: null, previewRole: null, startRolePreview: () => {}, endRolePreview: () => {},
    };
  }, []);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <View style={styles.page}>
      <SafeAreaView edges={["top"]} style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {PREVIEWS.map((p) => <Chip key={p.key} label={p.label} selected={preview === p.key} onPress={() => setPreview(install(p.key))} />)}
          {preview === "offline" || preview === "ticked_elsewhere" ? <Chip label={online ? "Online" : "Go back online"} selected={online} onPress={() => connectivity.force(!online)} /> : null}
        </ScrollView>
      </SafeAreaView>
      <View style={styles.screen}>
        <AuthContext.Provider value={value}>
          <PurchasingScreen key={preview} />
        </AuthContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  bar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  chips: { padding: spacing.sm, gap: spacing.sm },
  screen: { flex: 1 },
});
