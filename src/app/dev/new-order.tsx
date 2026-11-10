import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components";
import { colors, spacing } from "@/constants/theme";
import { AuthContext } from "@/features/auth/AuthProvider";
import { NewOrderScreen } from "@/features/orders/new/NewOrderScreen";
import { queryClient } from "@/services/data";
import { supabase } from "@/services/supabase";
import type { Profile } from "@/types/auth";

// Dev-only: the three-step New order with pretend data from the Figma frames.
// Requests are answered here; nothing reaches a server.

const past = "2026-01-01T00:00:00Z";
const sku = (id: string, unit = "kg") => ({ id, selling_sku: id.toUpperCase(), unit_of_measurement: unit, status: "active" });
const TABLES: Record<string, unknown[]> = {
  customers: [
    { id: "c1", customer_code: "CUS-0012", business_name: "Casa Verde Restaurant", contact_person: "Mark Reyes" },
    { id: "c2", customer_code: "CUS-0007", business_name: "Sampaguita Hotel", contact_person: "Joy Santos" },
    { id: "c3", customer_code: "CUS-0021", business_name: "Luntian Grocers", contact_person: "Ben Cruz" },
    { id: "c4", customer_code: "CUS-0033", business_name: "Kusina ni Maria", contact_person: "Maria Dela Paz" },
    { id: "c5", customer_code: "CUS-0040", business_name: "Bistro Alon", contact_person: "Paolo Lim" },
  ],
  products: [
    { id: "p1", product_name: "Tomatoes", unit_of_measurement: "kg", product_skus: [sku("tom-kg"), sku("tom-box", "box")] },
    { id: "p2", product_name: "Red onions", unit_of_measurement: "kg", product_skus: [sku("oni-kg")] },
    { id: "p3", product_name: "Cabbage", unit_of_measurement: "head", product_skus: [sku("cab-head", "head")] },
    { id: "p4", product_name: "Carrots", unit_of_measurement: "kg", product_skus: [sku("car-kg")] },
    { id: "p5", product_name: "Calamansi", unit_of_measurement: "kg", product_skus: [] },
    { id: "p6", product_name: "Romaine lettuce", unit_of_measurement: "kg", product_skus: [sku("rom-kg")] },
  ],
  price_history: [
    ["p1", null, 85], ["p1", "tom-box", 900], ["p2", null, 140], ["p3", null, 60], ["p4", null, 95], ["p5", null, 110], ["p6", null, 220],
  ].map(([product_id, product_sku_id, selling_price]) => ({ product_id, product_sku_id, selling_price, effective_from: past, effective_to: null })),
  customer_pricing: [],
  order_sources: ["Messenger", "Viber", "Phone", "Purchase order", "Other"].map((label, index) => ({ id: `s${index}`, code: label.toLowerCase().replace(" ", "_"), label, sort_order: index })),
  delivery_time_slots: [
    { id: "t1", label: "7:00 AM – 9:00 AM", starts_at: "07:00:00", ends_at: "09:00:00", sort_order: 420 },
    { id: "t2", label: "1:00 PM – 3:00 PM", starts_at: "13:00:00", ends_at: "15:00:00", sort_order: 780 },
  ],
  orders: [],
};
const STOCK = [
  { product_id: "p2", sku_id: "oni-kg", current_quantity: 18, status: "low_stock" },
  { product_id: "p3", sku_id: "cab-head", current_quantity: 40, status: "available" },
  { product_id: "p4", sku_id: "car-kg", current_quantity: 0, status: "out_of_stock" },
  { product_id: "p6", sku_id: "rom-kg", current_quantity: 9, status: "low_stock" },
];

function fakeQuery(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (value: unknown) => void) => setTimeout(() => resolve({ data: TABLES[table] ?? [], error: null }), 120);
      return () => chain;
    },
  });
  return chain;
}

let failSave = false;
async function fakeRpc(name: string) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (name === "get_product_inventory_availability") return { data: STOCK, error: null };
  if (name === "create_order") {
    if (failSave) return { data: null, error: { message: "The discount cannot be more than the subtotal of 145.00", code: "P0001", details: "", hint: "" } };
    return { data: { order_id: "o1", order_number: "ORD-1049", status: "for_verification", subtotal: 145, discount_amount: 0, total: 145 }, error: null };
  }
  return { data: null, error: null };
}

type Preview = "admin" | "office" | "error";
const PREVIEWS: { key: Preview; label: string }[] = [
  { key: "admin", label: "Administrator" },
  { key: "office", label: "Office staff" },
  { key: "error", label: "Server refuses" },
];

function install(preview: Preview): Preview {
  const client = supabase as unknown as { from: unknown; rpc: unknown };
  client.from = fakeQuery;
  client.rpc = fakeRpc;
  failSave = preview === "error";
  queryClient.clear();
  return preview;
}

export default function NewOrderPreview() {
  const [preview, setPreview] = useState<Preview>(() => install("admin"));
  const value = useMemo(() => {
    const profile: Profile = {
      id: "preview", full_name: "Ana Reyes", email: "", username: "ana.reyes", role: preview === "office" ? "administrative_staff" : "administrator", status: "active",
      must_change_password: false, must_change_reason: null, temp_password_expires_at: null, created_at: "", updated_at: "",
    };
    return {
      session: null, user: null, initialized: true, error: null, profile,
      isActive: true, needsPasswordChange: false, welcomePending: false, knowsCurrentPassword: false,
      matchesSignInPassword: () => false,
      signIn: async () => null, changePassword: async () => ({ ok: true as const }), finishWelcome: () => {},
      signOut: async () => {}, refreshProfile: async () => null, realRole: null, previewRole: null, startRolePreview: () => {}, endRolePreview: () => {},
    };
  }, [preview]);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <View style={styles.page}>
      <SafeAreaView edges={["top"]} style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {PREVIEWS.map((p) => <Chip key={p.key} label={p.label} selected={preview === p.key} onPress={() => setPreview(install(p.key))} />)}
        </ScrollView>
      </SafeAreaView>
      <View style={styles.screen}>
        <AuthContext.Provider value={value}>
          <NewOrderScreen key={preview} />
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
