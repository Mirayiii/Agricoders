import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components";
import { colors, spacing } from "@/constants/theme";
import { AuthContext } from "@/features/auth/AuthProvider";
import { CustomerDetailScreen, CustomersScreen } from "@/features/customers";
import { NewOrderScreen } from "@/features/orders/new/NewOrderScreen";
import { queryClient } from "@/services/data";
import { supabase } from "@/services/supabase";
import type { Profile } from "@/types/auth";

// Dev-only: the Customers screens with pretend data from the Figma frames.
// Nothing reaches a server.

type FakeCustomer = { id: string; customer_code: string; business_name: string; status: string; order_count: number; archived_at: string | null; last_order_date: string | null; [key: string]: string | number | null };
const base = { email: null, notes: null, archived_at: null, brand_name: null, tin: null };
const CUSTOMERS: FakeCustomer[] = [
  { ...base, id: "c12", customer_code: "CUS-0012", business_name: "Casa Verde Holdings Inc.", brand_name: "Casa Verde Restaurant", tin: "123-456-789-000", contact_person: "Mark Reyes", phone: "0917 555 0142", email: "orders@casaverde.ph", delivery_address: "12 Mabini St., Poblacion, Makati", status: "active", order_count: 8, last_order_date: "2026-08-29" },
  { ...base, id: "c07", customer_code: "CUS-0007", business_name: "Sampaguita Hotel", contact_person: "Joy Santos", phone: "0918 555 2231", delivery_address: "88 Roxas Blvd., Pasay", status: "active", order_count: 5, last_order_date: "2026-08-27" },
  { ...base, id: "c21", customer_code: "CUS-0021", business_name: "Luntian Grocers", contact_person: "Ben Cruz", phone: "0927 555 9012", delivery_address: "45 Katipunan Ave., Quezon City", status: "active", order_count: 4, last_order_date: "2026-08-28" },
  { ...base, id: "c33", customer_code: "CUS-0033", business_name: "Kusina ni Maria", contact_person: "Maria Dela Paz", phone: "0916 555 7788", delivery_address: "3 Aguinaldo Hwy., Imus, Cavite", status: "active", order_count: 5, last_order_date: "2026-08-25" },
  { ...base, id: "c40", customer_code: "CUS-0040", business_name: "Bistro Alon", contact_person: "Paolo Lim", phone: "0905 555 3321", delivery_address: "Unit 2, Seaside Blvd., Parañaque", status: "active", order_count: 5, last_order_date: "2026-08-29" },
  { ...base, id: "c05", customer_code: "CUS-0005", business_name: "Tindahan ni Lito", contact_person: "Lito Garcia", phone: "0919 555 4410", delivery_address: "7 Rizal Ave., Marikina", status: "archived", archived_at: "2026-07-01T00:00:00Z", order_count: 12, last_order_date: "2026-06-20" },
];
const USUAL = ["Red onions", "Tomatoes", "Lakatan bananas", "Carrots", "Cabbage", "Romaine lettuce", "Carabao mangoes"]
  .map((product_name, i) => ({ product_id: `p${i}`, product_name, preferred: i < 2, times_ordered: 8 - i }));
const HISTORY = [
  ["ORD-1052", "for_verification", "2026-08-29", 3150],
  ["ORD-1046", "confirmed", "2026-08-28", 2480],
  ["ORD-1042", "completed", "2026-08-27", 4298],
  ["ORD-1031", "completed", "2026-08-20", 3875],
  ["ORD-1024", "cancelled", "2026-08-14", 1200],
  ["ORD-1019", "completed", "2026-08-08", 2990],
  ["ORD-1011", "completed", "2026-08-01", 3410],
  ["ORD-1004", "completed", "2026-07-25", 2760],
].map(([order_number, status, requested_delivery_date, total], i) => ({ order_id: `o${i}`, order_number, status, requested_delivery_date, total, total_rows: 8 }));

type Preview = "list" | "detail" | "archived" | "neworder";
let customers = structuredClone(CUSTOMERS);

async function fakeRpc(name: string, args: Record<string, unknown>) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const find = (id: unknown) => customers.find((c) => c.id === id);
  if (name === "get_customers") return { data: structuredClone(customers), error: null };
  if (name === "get_customer_profile") {
    const c = find(args.p_customer_id);
    if (!c) return { data: null, error: { message: "Customer not found", code: "P0001", details: "", hint: "" } };
    const { order_count, last_order_date, ...customer } = c;
    return { data: { customer, order_count, last_order_date, usual_products: c.id === "c12" ? USUAL : USUAL.slice(2, 5) }, error: null };
  }
  if (name === "get_customer_order_history") return { data: HISTORY, error: null };
  if (name === "set_customer_archived") {
    const c = find(args.p_customer_id);
    if (c) { c.status = args.p_archived ? "archived" : "active"; c.archived_at = args.p_archived ? new Date().toISOString() : null; }
    return { data: { customer_id: c?.id, business_name: c?.business_name, status: c?.status }, error: null };
  }
  if (name === "save_customer") {
    const fields = args.p_customer as Record<string, string | null>;
    if (customers.some((c) => c.customer_code === fields.customer_code && c.id !== args.p_customer_id)) {
      const other = customers.find((c) => c.customer_code === fields.customer_code);
      return { data: null, error: { message: `Customer code ${fields.customer_code} is already used by ${other?.business_name}`, code: "P0001", details: "", hint: "" } };
    }
    let c = find(args.p_customer_id);
    if (!c) {
      c = { ...base, id: `c${customers.length + 100}`, status: "active", order_count: 0, last_order_date: null, ...fields } as unknown as FakeCustomer;
      customers.push(c);
    } else Object.assign(c, fields);
    return { data: { customer_id: c.id, business_name: c.business_name, status: c.status }, error: null };
  }
  return { data: [], error: null };
}

function fakeQuery(table: string) {
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") {
        const rows = table === "customers" ? customers.filter((c) => c.status === "active") : table === "order_sources" ? [{ id: "s1", code: "viber", label: "Viber", sort_order: 1 }] : [];
        return (resolve: (value: unknown) => void) => setTimeout(() => resolve({ data: structuredClone(rows), error: null }), 120);
      }
      return () => chain;
    },
  });
  return chain;
}

const PREVIEWS: { key: Preview; label: string }[] = [
  { key: "list", label: "Customer list" },
  { key: "detail", label: "Customer detail" },
  { key: "archived", label: "Archived customer" },
  { key: "neworder", label: "New order for archived" },
];

function install(preview: Preview): Preview {
  const client = supabase as unknown as { from: unknown; rpc: unknown };
  client.from = fakeQuery;
  client.rpc = fakeRpc;
  customers = structuredClone(CUSTOMERS);
  queryClient.clear();
  return preview;
}

export default function CustomersPreview() {
  const [preview, setPreview] = useState<Preview>(() => install("list"));
  const value = useMemo(() => {
    const profile: Profile = {
      id: "preview", full_name: "Liza Ramos", email: "", username: "preview", role: "administrative_staff", status: "active",
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
        </ScrollView>
      </SafeAreaView>
      <View style={styles.screen}>
        <AuthContext.Provider value={value}>
          {preview === "list" ? <CustomersScreen key={preview} />
            : preview === "neworder" ? <NewOrderScreen key={preview} customerId="c05" />
            : <CustomerDetailScreen key={preview} customerId={preview === "archived" ? "c05" : "c12"} />}
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
