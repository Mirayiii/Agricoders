import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components";
import { colors, spacing } from "@/constants/theme";
import { AuthContext } from "@/features/auth/AuthProvider";
import { DeliveriesScreen } from "@/features/deliveries";
import { ReceiptScreen } from "@/features/deliveries/receipt/ReceiptScreen";
import { queryClient } from "@/services/data";
import { connectivity, useIsOnline } from "@/services/offline";
import { outboxStore } from "@/services/offline/outboxStore";
import { supabase } from "@/services/supabase";
import type { Profile } from "@/types/auth";

// Dev-only: Deliveries and the receipt viewer with pretend data from the
// Figma frames (today is Thu, 27 Aug 2026 in Manila). Nothing reaches a server.

const RICO = "d-rico";
const customer = (business_name: string, delivery_address: string, phone = "0917 555 0101") => ({ business_name, delivery_address, phone, contact_person: null });
const person = (full_name: string) => ({ full_name, email: "" });
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));
const order = (order_number: string, c: ReturnType<typeof customer>, n: number, start: string | null = null, end: string | null = null) => ({ order_number, delivery_time_start: start, delivery_time_end: end, customers: c, order_items: items(n) });

const STOPS = [
  { id: "s42", order_id: "o42", scheduled_date: "2026-08-27", scheduled_time: "10:30:00", status: "scheduled", route_position: 1, received_by: null, completed_at: null, assigned_driver_id: null, profiles: null, orders: order("ORD-1042", customer("Casa Verde Restaurant", "12 Mabini St., Poblacion, Makati"), 2) },
  { id: "s45", order_id: "o45", scheduled_date: "2026-08-27", scheduled_time: "10:30:00", status: "scheduled", route_position: 2, received_by: null, completed_at: null, assigned_driver_id: null, profiles: null, orders: order("ORD-1045", customer("Kusina ni Maria", "3 Aguinaldo Hwy., Imus, Cavite"), 3) },
  { id: "s46", order_id: "o46", scheduled_date: "2026-08-27", scheduled_time: null, status: "scheduled", route_position: 1, received_by: null, completed_at: null, assigned_driver_id: RICO, profiles: person("Rico Bautista"), orders: order("ORD-1046", customer("Luntian Grocers", "45 Katipunan Ave., Quezon City"), 4, "07:00:00", "09:00:00") },
  { id: "s50", order_id: "o50", scheduled_date: "2026-08-27", scheduled_time: null, status: "scheduled", route_position: 2, received_by: null, completed_at: null, assigned_driver_id: RICO, profiles: person("Rico Bautista"), orders: order("ORD-1050", customer("Bistro Alon", "Unit 2, Seaside Blvd., Parañaque"), 1) },
  { id: "s41", order_id: "o41", scheduled_date: "2026-08-28", scheduled_time: "07:00:00", status: "scheduled", route_position: null, received_by: null, completed_at: null, assigned_driver_id: "d-carlo", profiles: person("Carlo Diaz"), orders: order("ORD-1041", customer("Luntian Grocers", "45 Katipunan Ave., Quezon City"), 1) },
  { id: "s52", order_id: "o52", scheduled_date: "2026-08-29", scheduled_time: null, status: "scheduled", route_position: null, received_by: null, completed_at: null, assigned_driver_id: null, profiles: null, orders: order("ORD-1052", customer("Bistro Alon", "Unit 2, Seaside Blvd., Parañaque"), 1) },
  { id: "s43", order_id: "o43", scheduled_date: "2026-08-26", scheduled_time: null, status: "completed", route_position: null, received_by: null, completed_at: "2026-08-26T01:15:00Z", assigned_driver_id: "d-carlo", profiles: person("Carlo Diaz"), orders: order("ORD-1043", customer("Sampaguita Hotel", "88 Roxas Blvd., Pasay"), 2) },
  { id: "s39", order_id: "o39", scheduled_date: "2026-08-25", scheduled_time: null, status: "completed", route_position: null, received_by: "Maria Dela Paz", completed_at: "2026-08-25T06:30:00Z", assigned_driver_id: "d-jun", profiles: person("Jun Villanueva"), orders: order("ORD-1039", customer("Kusina ni Maria", "3 Aguinaldo Hwy., Imus, Cavite"), 2) },
  { id: "s37", order_id: "o37", scheduled_date: "2026-08-24", scheduled_time: null, status: "completed", route_position: null, received_by: "Mark Reyes", completed_at: "2026-08-24T01:00:00Z", assigned_driver_id: "d-jun", profiles: person("Jun Villanueva"), orders: order("ORD-1037", customer("Casa Verde Restaurant", "12 Mabini St., Poblacion, Makati"), 1) },
];
const DRIVERS = [
  { id: RICO, full_name: "Rico Bautista", open_stops: 2 },
  { id: "d-jun", full_name: "Jun Villanueva", open_stops: 1 },
  { id: "d-paul", full_name: "Paul Santos", open_stops: 0 },
];
const RECEIPT = {
  id: "r1", order_id: "o43", dr_number: 2721, issued_at: "2026-10-14T00:40:00Z",
  content: {
    layout: "letter", company_name: "MEAH AGRICULTURAL PRODUCTS TRADING", company_address: "162 F. Benitez St. Brgy, Pasadena, San Juan 1500", company_phone: "0966-168-1602",
    order_number: "ORD-1043", customer_name: "Negril Trading Inc.", delivery_address: "554 Altura St., Sampaloc, Manila", delivery_date: "2026-10-14", sales_invoice_number: null,
    issued_by_name: "Juan Sebastian Hizon",
    lines: [["Baguio Beans", 6, "kg", 90], ["Cabbage", 12, "head", 110], ["Calamansi", 1, "kg", 65], ["Carrots", 7, "kg", 105], ["Garlic Peeled", 3, "kg", 120], ["Mani Hubad", 2, "kg", 150], ["Onion Red", 2, "kg", 70], ["Singkamas", 6, "kg", 43], ["Tomato", 2, "kg", 100], ["Ubod Buo", 4, "pc", 95]]
      .map(([description, quantity, unit, unit_price]) => ({ description, quantity, unit, unit_price, amount: Number(quantity) * Number(unit_price) })),
    subtotal: 4298, discount_amount: 0, total: 4298,
  },
};

type Preview = "office" | "driver" | "conflict" | "offline" | "reassigned" | "receipt" | "receipt_void";
let mode: Preview = "office";
let stops = structuredClone(STOPS);

function fakeQuery(table: string) {
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") {
        let rows: unknown[] = table === "deliveries" ? stops : table === "delivery_receipts" ? [RECEIPT] : [];
        if (table === "deliveries" && mode === "driver") rows = (rows as typeof stops).filter((row) => row.assigned_driver_id === RICO);
        rows = (rows as Record<string, unknown>[]).filter((row) => filters.every((f) => f(row)));
        return (resolve: (value: unknown) => void) => setTimeout(() => resolve({ data: structuredClone(rows), error: null }), 120);
      }
      return (...args: unknown[]) => {
        if (prop === "in" && table === "deliveries") filters.push((row) => (args[1] as unknown[]).includes(row[args[0] as string]));
        if (prop === "eq" && table === "deliveries") filters.push((row) => row[args[0] as string] === args[1]);
        return chain;
      };
    },
  });
  return chain;
}

async function fakeRpc(name: string, args: Record<string, unknown>) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (name === "manila_today") return { data: "2026-08-27", error: null };
  if (name === "get_delivery_drivers") return { data: DRIVERS, error: null };
  if (name === "get_delivery_receipt") return { data: { ...RECEIPT, finalized_at: mode === "receipt_void" ? "2026-10-14T03:00:00Z" : null, voided_at: mode === "receipt_void" ? "2026-10-14T03:00:00Z" : null }, error: null };
  if (name === "reorder_route") {
    if (mode === "conflict") return { data: null, error: { message: "This route changed while you were editing it. It has been reloaded: check the order and save again.", code: "P0001", details: "", hint: "" } };
    (args.p_delivery_ids as string[]).forEach((id, index) => { const row = stops.find((s) => s.id === id); if (row) row.route_position = index + 1; });
    return { data: {}, error: null };
  }
  if (name === "assign_delivery_driver") {
    const row = stops.find((s) => s.id === args.p_delivery_id);
    const driver = DRIVERS.find((d) => d.id === args.p_driver_id);
    if (row) Object.assign(row, { assigned_driver_id: driver?.id ?? null, profiles: driver ? person(driver.full_name) : null, route_position: 99 });
    return { data: {}, error: null };
  }
  if (name === "offline_complete_delivery") {
    if (mode === "reassigned") return { data: null, status: 400, error: { message: "This stop was reassigned to Carlo Diaz after you marked it delivered. Check with the office.", code: "OFCON", details: "", hint: "" } };
    const row = stops.find((s) => s.id === args.p_delivery_id);
    if (row) Object.assign(row, { status: "completed", completed_at: new Date().toISOString(), received_by: args.p_received_by });
    return { data: { order_id: row?.order_id, dr_label: "DR-2722" }, error: null };
  }
  if (name === "complete_delivery") {
    const row = stops.find((s) => s.id === args.p_delivery_id);
    if (row) Object.assign(row, { status: "completed", completed_at: new Date().toISOString(), received_by: args.p_received_by });
    return { data: { order_id: row?.order_id, dr_label: "DR-2722" }, error: null };
  }
  return { data: null, error: null };
}

const PREVIEWS: { key: Preview; label: string }[] = [
  { key: "office", label: "Office staff" },
  { key: "driver", label: "Driver (Rico)" },
  { key: "conflict", label: "Route changed elsewhere" },
  { key: "offline", label: "Driver offline" },
  { key: "reassigned", label: "Offline, then reassigned" },
  { key: "receipt", label: "Receipt viewer" },
  { key: "receipt_void", label: "Receipt, order cancelled" },
];

function install(preview: Preview): Preview {
  const client = supabase as unknown as { from: unknown; rpc: unknown };
  client.from = fakeQuery;
  client.rpc = fakeRpc;
  mode = preview;
  stops = structuredClone(STOPS);
  queryClient.clear();
  const driver = preview === "driver" || preview === "offline" || preview === "reassigned";
  // After this render: changing the connection updates other components.
  setTimeout(() => {
    void outboxStore.openPreview(driver ? RICO : "preview");
    // Load the stops first (as if opened online this morning), then lose the connection.
    connectivity.force(true);
    if (preview === "offline" || preview === "reassigned") setTimeout(() => connectivity.force(false), 900);
  }, 0);
  return preview;
}

export default function DeliveriesPreview() {
  const [preview, setPreview] = useState<Preview>(() => install("office"));
  const driver = preview === "driver" || preview === "offline" || preview === "reassigned";
  const online = useIsOnline();
  const value = useMemo(() => {
    const profile: Profile = {
      id: driver ? RICO : "preview", full_name: driver ? "Rico Bautista" : "Liza Ramos", email: "", username: "preview",
      role: driver ? "delivery_staff" : "administrative_staff", status: "active",
      must_change_password: false, must_change_reason: null, temp_password_expires_at: null, created_at: "", updated_at: "",
    };
    return {
      session: null, user: null, initialized: true, error: null, profile,
      isActive: true, needsPasswordChange: false, welcomePending: false, knowsCurrentPassword: false,
      matchesSignInPassword: () => false,
      signIn: async () => null, changePassword: async () => ({ ok: true as const }), finishWelcome: () => {},
      signOut: async () => {}, refreshProfile: async () => null, realRole: null, previewRole: null, startRolePreview: () => {}, endRolePreview: () => {},
    };
  }, [driver]);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <View style={styles.page}>
      <SafeAreaView edges={["top"]} style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {PREVIEWS.map((p) => <Chip key={p.key} label={p.label} selected={preview === p.key} onPress={() => setPreview(install(p.key))} />)}
          {preview === "offline" || preview === "reassigned" ? <Chip label={online ? "Online" : "Go back online"} selected={online} onPress={() => connectivity.force(!online)} /> : null}
        </ScrollView>
      </SafeAreaView>
      <View style={styles.screen}>
        <AuthContext.Provider value={value}>
          {preview === "receipt" || preview === "receipt_void" ? <ReceiptScreen key={preview} orderId="o43" orderStatus={preview === "receipt_void" ? "cancelled" : undefined} /> : <DeliveriesScreen key={preview} />}
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
