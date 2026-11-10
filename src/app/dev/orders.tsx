import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components";
import { ConnectionChip } from "@/features/sync/ConnectionChip";
import { colors, spacing } from "@/constants/theme";
import { AuthContext } from "@/features/auth/AuthProvider";
import { OrdersScreen } from "@/features/orders";
import { OrderDetailsScreen } from "@/features/orders/OrderDetailsScreen";
import type { OrderDetail, OrderListRow } from "@/features/orders/ordersData";
import { queryClient } from "@/services/data";
import { supabase } from "@/services/supabase";
import type { Profile } from "@/types/auth";
import { toISODate } from "@/utils/format";

// Dev-only: Orders list and Order detail for each status, with pretend data
// from the Figma frames. Requests are answered here; nothing reaches a server.

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return toISODate(d); };
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const liza = { full_name: "Liza Ramos", email: "" };
const line = (id: string, name: string, quantity: number, unitPrice: number, packed = false) => ({
  id, quantity, unit_of_measurement: "kg", unit_price: unitPrice, line_total: Math.round(quantity * unitPrice * 100) / 100,
  preparation_status: packed ? "completed" : "pending", products: { product_name: name }, product_varieties: null,
});
const customer = (business_name: string, contact_person: string, phone: string, delivery_address: string) => ({ business_name, contact_person, phone, delivery_address });

function detail(base: Partial<OrderDetail> & Pick<OrderDetail, "id" | "order_number" | "status" | "order_items">): OrderDetail {
  const subtotal = base.order_items.reduce((sum, item) => sum + item.line_total, 0);
  const discount = base.discount_type === "fixed" ? Number(base.discount_value) : base.discount_type === "percent" ? Math.round(subtotal * Number(base.discount_value)) / 100 : 0;
  return {
    order_source: "viber", requested_delivery_date: day(0), notes: null, requires_attention: false, attention_reason: null,
    discount_type: null, discount_value: null, discount_reason: null, sales_invoice_number: null,
    customers: customer("Casa Verde Restaurant", "Mark Reyes", "0917 555 0142", "12 Mabini St., Poblacion, Makati"),
    deliveries: [], order_activity: [{ id: `${base.id}-a`, action: "created", details: {}, created_at: at(45), profiles: liza }],
    order_subtotal: subtotal, order_discount: discount, order_total: subtotal - discount,
    ...base,
  };
}

const DETAILS: Record<string, OrderDetail> = {
  o1048: detail({
    id: "o1048", order_number: "DR-1048", status: "for_verification", requires_attention: true, attention_reason: "Confirm onion quantity — customer wrote “1 sack”.",
    notes: "Deliver before 11 AM, back entrance.",
    order_items: [line("l1", "Tomatoes", 10, 85), line("l2", "Red onions", 5, 140), line("l3", "Romaine lettuce", 3, 220)],
  }),
  o1047: detail({
    id: "o1047", order_number: "DR-1047", status: "confirmed", order_source: "purchase_order", requested_delivery_date: day(1),
    customers: customer("Sampaguita Hotel", "Joy Santos", "0918 555 2231", "88 Roxas Blvd., Pasay"), sales_invoice_number: "13451",
    order_items: [line("l4", "Carabao mangoes", 10, 180), line("l5", "Lakatan bananas", 15, 95), line("l6", "Calamansi", 9, 85)],
  }),
  o1046: detail({
    id: "o1046", order_number: "DR-1046", status: "for_preparation", order_source: "phone",
    customers: customer("Luntian Grocers", "Ben Tan", "0915 555 0110", "45 Rizal Ave., Quezon City"),
    order_items: [line("l7", "Cabbage", 20, 60, true), line("l8", "Tomatoes", 25, 85, true), line("l9", "Lakatan bananas", 30, 95), line("l10", "Red onions", 17.5, 140)],
  }),
  o1045: detail({
    id: "o1045", order_number: "DR-1045", status: "for_delivery", order_source: "messenger",
    customers: customer("Kusina ni Maria", "Maria Dela Paz", "0916 555 7788", "3 Aguinaldo Hwy., Imus, Cavite"),
    discount_type: "fixed", discount_value: 500, discount_reason: "Delayed delivery compensation",
    deliveries: [{ id: "d1045", assigned_driver_id: "dev-driver", scheduled_date: day(0), scheduled_time: "10:30:00", status: "scheduled", notes: null, received_by: null, profiles: { full_name: "Rico Driver", email: "" } }],
    order_items: [line("l11", "Tomatoes", 10, 85), line("l12", "Red onions", 3, 140), line("l13", "Calamansi", 3, 100)],
    order_activity: [
      { id: "a3", action: "discount_applied", details: { amount: 500, reason: "Delayed delivery compensation" }, created_at: at(30), profiles: liza },
      { id: "a2", action: "status_changed", details: { to_status: "for_delivery" }, created_at: at(90), profiles: { full_name: "Carlo Santos", email: "" } },
      { id: "a1", action: "created", details: {}, created_at: at(300), profiles: liza },
    ],
  }),
  o1043: detail({
    id: "o1043", order_number: "DR-1043", status: "completed", order_source: "purchase_order", requested_delivery_date: day(-1), sales_invoice_number: "13440",
    customers: customer("Sampaguita Hotel", "Joy Santos", "0918 555 2231", "88 Roxas Blvd., Pasay"),
    deliveries: [{ id: "d1043", assigned_driver_id: "dev-driver", scheduled_date: day(-1), scheduled_time: "09:15:00", status: "completed", notes: null, received_by: "Joy Santos", profiles: { full_name: "Carlo Diaz", email: "" } }],
    order_items: [line("l14", "Carabao mangoes", 25, 180), line("l15", "Tomatoes", 10, 87)],
  }),
};

const LIST: OrderListRow[] = [
  ["o1048", 0], ["o1044", 1], ["o1047", 1], ["o1046", 0], ["o1045", 0], ["o1043", -1],
].map(([id, offset]) => {
  const d = DETAILS[id as string] ?? detail({ id: "o1044", order_number: "DR-1044", status: "for_verification", customers: customer("Bistro Alon", "", "", ""), order_items: [line("x1", "Tomatoes", 4, 85), line("x2", "Calamansi", 4, 97.5)] });
  return {
    id: d.id, order_number: d.order_number, customer_id: "c", status: d.status, requested_delivery_date: day(offset as number), requires_attention: d.requires_attention,
    attention_reason: d.attention_reason, created_at: at(10), order_total: d.order_total, customers: { business_name: d.customers?.business_name ?? "" }, order_items: d.order_items.map((item) => ({ id: item.id })),
  };
});

type Preview = "list" | "stale" | keyof typeof DETAILS;
const PREVIEWS: { key: Preview; label: string }[] = [
  { key: "list", label: "Orders" },
  { key: "o1048", label: "For verification" },
  { key: "o1047", label: "Confirmed" },
  { key: "o1046", label: "Preparing" },
  { key: "o1045", label: "For delivery" },
  { key: "o1043", label: "Completed" },
  { key: "stale", label: "Couldn’t refresh" },
];

let failRequests = false;

/** Answers the screens' Supabase calls from the pretend data. */
function fakeQuery(table: string) {
  let id: string | null = null;
  const result = () => (failRequests
    ? { data: null, error: { message: "Network request failed", code: "", details: "", hint: "" } }
    : { data: table === "orders" && id ? DETAILS[id] ?? null : table === "orders" ? LIST : [], error: null });
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (value: unknown) => void) => setTimeout(() => resolve(result()), 150);
      if (prop === "eq") return (column: string, value: string) => { if (column === "id") id = value; return chain; };
      return () => chain;
    },
  });
  return chain;
}

function install(preview: Preview): Preview {
  const client = supabase as unknown as { from: unknown; rpc: unknown };
  client.from = fakeQuery;
  client.rpc = async () => ({ data: { total: 0 }, error: null });
  failRequests = preview === "stale";
  queryClient.clear();
  queryClient.setQueryDefaults(["orders"], { retry: false });
  // "Couldn’t refresh": data loaded 25 minutes ago, then the refresh fails.
  queryClient.setQueryData(["orders", "list"], LIST, { updatedAt: Date.now() - 25 * 60_000 });
  return preview;
}

export default function OrdersPreview() {
  const [preview, setPreview] = useState<Preview>(() => install("list"));
  const profile: Profile = {
    id: "preview", full_name: "Ana Reyes", email: "", username: "ana.reyes", role: "administrator", status: "active",
    must_change_password: false, must_change_reason: null, temp_password_expires_at: null, created_at: "", updated_at: "",
  };
  const value = useMemo(() => ({
    session: null, user: null, initialized: true, error: null, profile,
    isActive: true, needsPasswordChange: false, welcomePending: false, knowsCurrentPassword: false,
    matchesSignInPassword: () => false,
    signIn: async () => null, changePassword: async () => ({ ok: true as const }), finishWelcome: () => {},
    signOut: async () => {}, refreshProfile: async () => null, realRole: null, previewRole: null, startRolePreview: () => {}, endRolePreview: () => {},
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <View style={styles.page}>
      <SafeAreaView edges={["top"]} style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {PREVIEWS.map((p) => <Chip key={p.key} label={p.label} selected={preview === p.key} onPress={() => setPreview(install(p.key))} />)}
          <ConnectionChip />
        </ScrollView>
      </SafeAreaView>
      <View style={styles.screen}>
        <AuthContext.Provider value={value}>
          {preview === "list" || preview === "stale" ? <OrdersScreen key={preview} /> : <OrderDetailsScreen key={preview} orderId={preview} />}
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
