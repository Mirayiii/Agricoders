import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components";
import { ConnectionChip } from "@/features/sync/ConnectionChip";
import { colors, spacing } from "@/constants/theme";
import { AuthContext } from "@/features/auth/AuthProvider";
import { CustomerDetailScreen } from "@/features/customers";
import { BatchPriceScreen, ProductDetailScreen, ProductsScreen } from "@/features/products";
import { manilaToday } from "@/features/purchasing/purchasingLogic";
import {
  CustomerAnalyticsScreen, CustomerReportScreen, DailyPricesScreen, ItemAnalyticsScreen, OrderReportScreen, ProductVolumeScreen, ReportsScreen,
} from "@/features/reports";
import { addDays, periodRange } from "@/features/reports/reportsLogic";
import { queryClient } from "@/services/data";
import { supabase } from "@/services/supabase";
import type { Profile, ProfileRole } from "@/types/auth";

// Dev-only: Products & stock and Reports with pretend data from the Figma
// frames. Nothing reaches a server.

const TODAY = manilaToday();
const WEEK = periodRange("week", TODAY);
const day = (offset: number) => addDays(WEEK.start, offset);
const margin = (c: number, s: number) => (c > 0 && s > 0 ? Math.round(((s - c) / s) * 1000) / 10 : null);

type P = { id: string; product_name: string; status: string; unit: string; track_stock: boolean; unit_count: number; buying_sku: string | null; selling_sku: string | null; sku_id: string; cost_price: number | null; selling_price: number | null; margin_percent: number | null; stock_quantity: number | null; low_stock_threshold: number | null; stock_status: string | null };
const product = (id: string, name: string, unit: string, code: string, cost: number, selling: number, stock?: [number, number, string]): P => ({
  id, product_name: name, status: "active", unit, track_stock: Boolean(stock), unit_count: id === "p2" ? 3 : 1, buying_sku: `10${code.slice(2)}`.replace(/^1010/, "1000"), selling_sku: code, sku_id: `s-${id}`,
  cost_price: cost, selling_price: selling, margin_percent: margin(cost, selling),
  stock_quantity: stock ? stock[0] : null, low_stock_threshold: stock ? stock[1] : null, stock_status: stock ? stock[2] : null,
});
const PRODUCTS: P[] = [
  product("p1", "Tomatoes", "kg", "100001", 62, 85),
  product("p2", "Red onions", "kg", "100002", 105, 140, [18, 20, "low_stock"]),
  product("p3", "Cabbage", "head", "100003", 42, 60, [40, 10, "available"]),
  product("p4", "Carrots", "kg", "100004", 70, 95, [0, 10, "out_of_stock"]),
  product("p5", "Calamansi", "kg", "100005", 80, 110),
  product("p6", "Romaine lettuce", "kg", "100006", 165, 220),
  product("p7", "Honey", "bottle", "100010", 0, 380),
  { ...product("p8", "Okra", "kg", "100011", 50, 70), status: "archived" },
];
PRODUCTS[1].buying_sku = "100002";
PRODUCTS[1].selling_sku = "101002";

const HISTORY = [
  [0, 105, 140, "Ana Mercado"], [1, 110, 145, "Ana Mercado"], [2, 105, 135, "Ana Mercado"], [3, 102, 138, "Liza Ramos"], [4, 100, 135, "Ana Mercado"],
].map(([back, c, s, by], i) => ({ id: `h${i}`, cost_price: c, selling_price: s, margin_percent: margin(c as number, s as number), effective_from: `${addDays(TODAY, -(back as number))}T00:00:00+08:00`, price_date: addDays(TODAY, -(back as number)), set_by: by, is_current: i === 0 }));

const ACTIVITY = [
  { id: "a1", transaction_type: "decrease", quantity: 12, previous_quantity: 30, new_quantity: 18, reason: "Spoilage — soft bulbs", created_at: new Date(Date.now() - 20 * 3600_000).toISOString(), performed_by_name: "Rico Bautista" },
  { id: "a2", transaction_type: "increase", quantity: 30, previous_quantity: 0, new_quantity: 30, reason: "Supplier delivery", created_at: new Date(Date.now() - 9 * 86400_000).toISOString(), performed_by_name: "Rico Bautista" },
];

const DAILY_SALES = [2700, 425, 1700, 5400, 12520, 7400, 4500];
const DAILY_KG = [27, 4, 17, 52, 120, 70, 47];
const totals = (sales: number, cost: number, orders: number, kg: number, missing = 0) => ({
  sales, orders, covered_sales: sales, cost, profit: sales - cost, margin_percent: margin(cost, sales), lines_without_cost: missing, volume: kg ? [{ unit: "kg", quantity: kg }] : [],
});
const CUSTOMERS = [
  ["c12", "Casa Verde Restaurant", "CUS-0012", 11365, 8412, 5, 103],
  ["c07", "Sampaguita Hotel", "CUS-0007", 9835, 7430, 2, 84],
  ["c21", "Luntian Grocers", "CUS-0021", 9315, 7010, 2, 88],
  ["c33", "Kusina ni Maria", "CUS-0033", 2740, 2080, 2, 34],
  ["c40", "Bistro Alon", "CUS-0040", 1390, 1326, 2, 28],
  ["c05", "Lito Garcia Enterprises", "CUS-0005", 0, 0, 0, 0],
].map(([id, name, code, sales, cost, orders, kg]) => ({ customer_id: id, name, code, status: "active", ...totals(sales as number, cost as number, orders as number, kg as number) }));
const VOLUME = [
  ["p1", "Tomatoes", "kg", 102, 8670, 6324, 9, 5], ["p9", "Lakatan bananas", "kg", 65, 4875, 3800, 3, 2], ["p10", "Carabao mangoes", "crate", 50, 7250, 5600, 2, 1],
  ["p2", "Red onions", "kg", 47, 6580, 4935, 5, 3], ["p4", "Carrots", "kg", 28, 2660, 1960, 2, 2], ["p3", "Cabbage", "head", 26, 1920, 1092, 2, 2],
  ["p6", "Romaine lettuce", "kg", 10, 2200, 1650, 3, 2], ["p5", "Calamansi", "kg", 9, 990, 720, 3, 3], ["p11", "Ampalaya", "kg", 0, 0, 0, 0, 0], ["p7", "Honey", "bottle", 0, 0, 0, 0, 0],
].map(([id, name, unit, vol, sales, cost, orders, clients]) => ({ product_id: id, name, unit, main_volume: vol, clients, ...totals(sales as number, cost as number, orders as number, unit === "kg" ? vol as number : 0) }));

const SALES_REPORT = {
  start: WEEK.start, end: WEEK.end, active_customers: 6, products_total: 10,
  totals: { ...totals(34645, 26258, 13, 337), volume: [{ unit: "kg", quantity: 337 }, { unit: "pc", quantity: 24 }] },
  daily: DAILY_SALES.map((sales, i) => ({ date: day(i), sales, volume: DAILY_KG[i] })),
  customers: CUSTOMERS, products: VOLUME,
};

const line = (product_name: string, quantity: number, unit: string, unit_price: number) => ({ product_name, quantity, unit, unit_price, amount: quantity * unit_price });
const STATEMENT_ORDERS = [
  { order_id: "o1", order_number: "ORD-1049", status: "confirmed", delivery_date: day(6), dr_number: 1049, sales_invoice_number: null, received_by: null, lines: [line("Tomatoes", 15, "kg", 85), line("Red onions", 12, "kg", 140), line("Carrots", 18, "kg", 95)], discount: 0 },
  { order_id: "o2", order_number: "ORD-1048", status: "for_verification", delivery_date: day(4), dr_number: null, sales_invoice_number: null, received_by: null, lines: [line("Tomatoes", 10, "kg", 85), line("Red onions", 5, "kg", 140), line("Romaine lettuce", 3, "kg", 220)], discount: 0 },
  { order_id: "o3", order_number: "ORD-1042", status: "for_delivery", delivery_date: day(4), dr_number: 1042, sales_invoice_number: null, received_by: null, lines: [line("Romaine lettuce", 4, "kg", 220), line("Tomatoes", 6, "kg", 85)], discount: 0 },
  { order_id: "o4", order_number: "ORD-1037", status: "completed", delivery_date: day(1), dr_number: 1037, sales_invoice_number: "SI-2210", received_by: "Mark Reyes", lines: [line("Tomatoes", 5, "kg", 85)], discount: 0 },
  { order_id: "o5", order_number: "ORD-1031", status: "completed", delivery_date: day(0), dr_number: 1031, sales_invoice_number: null, received_by: "Mark Reyes", lines: [line("Cabbage", 10, "head", 60), line("Calamansi", 20, "kg", 110)], discount: 140 },
].map((order) => {
  const subtotal = order.lines.reduce((sum, l) => sum + l.amount, 0);
  return { ...order, subtotal, total: subtotal - order.discount };
});
const STATEMENT = {
  customer: { id: "c12", name: "Casa Verde Restaurant", business_name: "Casa Verde Holdings Inc.", brand_name: "Casa Verde Restaurant", tin: "123-456-789-000", code: "CUS-0012", contact_person: "Mark Reyes", phone: "0917 555 0142", delivery_address: "12 Mabini St., Poblacion, Makati" },
  start: WEEK.start, end: WEEK.end,
  totals: totals(11365, 8412, 5, 103, 1),
  daily: [2700, 425, 0, 0, 3600, 0, 4665].map((sales, i) => ({ date: day(i), sales, volume: Math.round(sales / 45) })),
  orders: STATEMENT_ORDERS,
};
const ITEM = {
  product: { id: "p1", name: "Tomatoes", unit: "kg", unit_key: "kg", selling_sku: "100001", buying_sku: "100001", selling_price: 85, cost_price: 62 },
  start: WEEK.start, end: WEEK.end, totals: totals(8670, 6324, 9, 102),
  daily: [15, 5, 0, 12, 49, 6, 15].map((volume, i) => ({ date: day(i), volume, sales: volume * 85 })),
  customers: [["c12", "Casa Verde Restaurant", 51, 5], ["c21", "Luntian Grocers", 25, 1], ["c07", "Sampaguita Hotel", 12, 1], ["c33", "Kusina ni Maria", 8, 1], ["c40", "Bistro Alon", 6, 1]]
    .map(([id, name, kg, orders]) => ({ customer_id: id, name, main_volume: kg, ...totals((kg as number) * 85, (kg as number) * 62, orders as number, kg as number) })),
};
const ORDERS = [
  ["DR-1049", "Casa Verde Restaurant", "confirmed", 6, 3, 4665], ["DR-1044", "Bistro Alon", "for_verification", 5, 2, 730], ["DR-1047", "Sampaguita Hotel", "confirmed", 5, 3, 4465],
  ["DR-1052", "Bistro Alon", "for_delivery", 5, 1, 660], ["DR-1041", "Luntian Grocers", "for_delivery", 5, 1, 1500], ["DR-1048", "Casa Verde Restaurant", "for_verification", 4, 3, 2210],
  ["DR-1046", "Luntian Grocers", "for_preparation", 4, 4, 7815], ["DR-1045", "Kusina ni Maria", "for_delivery", 4, 3, 1070], ["DR-1043", "Sampaguita Hotel", "completed", 3, 2, 5370],
  ["DR-1039", "Kusina ni Maria", "completed", 2, 2, 1670], ["DR-1037", "Casa Verde Restaurant", "completed", 1, 1, 425], ["DR-1040", "Casa Verde Restaurant", "completed", 0, 2, 2675],
].map(([order_number, customer_name, status, offset, item_count, total], i) => ({ order_id: `r${i}`, order_number, customer_name, status, requested_delivery_date: day(offset as number), item_count, total, total_rows: 12 }));

let products = structuredClone(PRODUCTS);
let history = structuredClone(HISTORY);

const ok = (data: unknown) => ({ data: structuredClone(data), error: null });
async function fakeRpc(name: string, args: Record<string, unknown>) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const find = (id: unknown) => products.find((p) => p.id === id);
  switch (name) {
    case "get_products_overview": return ok(products);
    case "get_price_history": return ok(args.p_product_id === "p2" ? history : []);
    case "get_inventory_activity": return ok(ACTIVITY);
    case "set_product_price": {
      const p = find(args.p_product_id);
      if (p) { p.cost_price = Number(args.p_cost); p.selling_price = Number(args.p_selling); p.margin_percent = margin(p.cost_price, p.selling_price); }
      history = [{ id: `h${history.length}`, cost_price: Number(args.p_cost), selling_price: Number(args.p_selling), margin_percent: margin(Number(args.p_cost), Number(args.p_selling)), effective_from: new Date().toISOString(), price_date: TODAY, set_by: "Ana Mercado", is_current: true }, ...history.map((h) => ({ ...h, is_current: false }))];
      return ok({ margin_percent: p?.margin_percent ?? null });
    }
    case "set_product_archived": {
      const p = find(args.p_product_id);
      if (p) p.status = args.p_archived ? "archived" : "active";
      return ok({ product_id: p?.id, product_name: p?.product_name, status: p?.status });
    }
    case "delete_product": {
      const p = find(args.p_product_id);
      products = products.filter((row) => row.id !== args.p_product_id);
      return ok({ product_id: p?.id, product_name: p?.product_name, deleted: true });
    }
    case "update_product": {
      const p = find(args.p_product_id);
      const changes = args.p_changes as Record<string, unknown>;
      const rename = changes.rename_unit as { from: string; to: string } | undefined;
      if (rename && rename.to === "bag") return { data: null, error: { message: `${rename.from} has stock on hand, so it can only be respelled as the same measure (for example kg to kilo). Add bag as a new unit instead.`, code: "P0001", details: "", hint: "" } };
      if (p && "track_stock" in changes) { p.track_stock = Boolean(changes.track_stock); p.stock_quantity = p.track_stock ? p.stock_quantity ?? 0 : null; p.stock_status = p.track_stock ? p.stock_status ?? "out_of_stock" : null; }
      return ok({ product_id: p?.id, product_name: p?.product_name });
    }
    case "create_product": return ok({ product_id: "p2", product_name: (args.p_product as { product_name: string }).product_name });
    case "batch_update_prices":
      if ((args.p_rows as { selling_price: number }[]).some((row) => row.selling_price <= 0)) return { data: null, error: { message: "Cabbage: the selling price must be more than ₱0", code: "P0001", details: "", hint: "" } };
      return ok({ updated: (args.p_rows as unknown[]).length, effective_from: new Date().toISOString() });
    case "get_batch_price_sheet": {
      const last: Record<string, [number, number]> = { p3: [80, 95], p4: [60, 75] };
      return ok({
        price_date: args.p_price_date, compare_date: args.p_compare_date ?? TODAY, compare_dates: [TODAY, addDays(TODAY, -1), addDays(TODAY, -2), addDays(TODAY, -3)],
        products: products.filter((p) => p.status === "active").map((p) => ({ product_id: p.id, name: p.product_name, unit: p.unit, sku: p.selling_sku, cost_price: p.cost_price, selling_price: p.selling_price, last_cost: last[p.id]?.[0] ?? p.cost_price, last_selling: last[p.id]?.[1] ?? p.selling_price })),
      });
    }
    case "get_sales_report": return ok(SALES_REPORT);
    case "get_customer_statement": return ok(STATEMENT);
    case "get_item_analytics": return ok(ITEM);
    case "get_order_report": return ok(ORDERS);
    case "get_daily_prices": return ok({
      date: args.p_date, dates: [TODAY, addDays(TODAY, -1), addDays(TODAY, -2), addDays(TODAY, -3)],
      products: products.filter((p) => p.status === "active").map((p) => ({ product_id: p.id, name: p.product_name, unit: p.unit, sku: p.selling_sku, cost_price: p.cost_price, selling_price: p.selling_price, margin_percent: p.margin_percent, set_on_date: true })),
    });
    case "get_customer_profile": return ok({
      customer: { ...STATEMENT.customer, business_name: "Casa Verde Holdings Inc.", customer_code: "CUS-0012", email: "orders@casaverde.ph", notes: null, status: "active", archived_at: null },
      order_count: 8, last_order_date: day(6), usual_products: ["Red onions", "Tomatoes", "Carrots"].map((product_name, i) => ({ product_id: `p${i}`, product_name, preferred: i < 2, times_ordered: 8 - i })),
    });
    case "get_customer_order_history": return ok([]);
    default: return ok([]);
  }
}

function fakeQuery(table: string) {
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") {
        const rows = table === "product_skus" ? [
          { id: "u1", unit_of_measurement: "kg", buying_sku: "100002", selling_sku: "101002" },
          { id: "u2", unit_of_measurement: "piece", buying_sku: null, selling_sku: null },
          { id: "u3", unit_of_measurement: "sack (25kg)", buying_sku: null, selling_sku: null },
        ] : [];
        return (resolve: (value: unknown) => void) => setTimeout(() => resolve({ data: structuredClone(rows), error: null }), 100);
      }
      return () => chain;
    },
  });
  return chain;
}

type Preview = "list" | "archived" | "details" | "pricing" | "stock" | "simple" | "batch" | "reports" | "customers" | "statement" | "volume" | "item" | "orders" | "prices" | "billing" | "office";
const PREVIEWS: { key: Preview; label: string }[] = [
  { key: "list", label: "Products & stock" }, { key: "archived", label: "Archived products" }, { key: "details", label: "Details" }, { key: "pricing", label: "Pricing" }, { key: "stock", label: "Stock" },
  { key: "simple", label: "Untracked product" }, { key: "batch", label: "Batch prices" }, { key: "reports", label: "Reports" }, { key: "customers", label: "Customer report" },
  { key: "statement", label: "Customer statement" }, { key: "volume", label: "Product volume" }, { key: "item", label: "Item analytics" }, { key: "orders", label: "Order report" },
  { key: "prices", label: "Daily prices" }, { key: "billing", label: "Customer statement row" }, { key: "office", label: "Office staff customer" },
];

function install(preview: Preview): Preview {
  const client = supabase as unknown as { from: unknown; rpc: unknown };
  client.from = fakeQuery;
  client.rpc = fakeRpc;
  products = structuredClone(PRODUCTS);
  history = structuredClone(HISTORY);
  queryClient.clear();
  return preview;
}

export default function ProductsPreview() {
  const [preview, setPreview] = useState<Preview>(() => install("list"));
  const role: ProfileRole = preview === "office" ? "administrative_staff" : "administrator";
  const value = useMemo(() => {
    const profile: Profile = {
      id: "preview", full_name: role === "administrator" ? "Ana Mercado" : "Liza Ramos", email: "", username: "preview", role, status: "active",
      must_change_password: false, must_change_reason: null, temp_password_expires_at: null, created_at: "", updated_at: "",
    };
    return {
      session: null, user: null, initialized: true, error: null, profile,
      isActive: true, needsPasswordChange: false, welcomePending: false, knowsCurrentPassword: false,
      matchesSignInPassword: () => false,
      signIn: async () => null, changePassword: async () => ({ ok: true as const }), finishWelcome: () => {},
      signOut: async () => {}, refreshProfile: async () => null, realRole: null, previewRole: null, startRolePreview: () => {}, endRolePreview: () => {},
    };
  }, [role]);

  if (!__DEV__) return <Redirect href="/" />;

  const screen = (() => {
    switch (preview) {
      case "list": return <ProductsScreen />;
      case "archived": return <ProductsScreen archivedOnly />;
      case "details": return <ProductDetailScreen productId="p2" initialTab="details" />;
      case "pricing": return <ProductDetailScreen productId="p2" initialTab="pricing" />;
      case "stock": return <ProductDetailScreen productId="p2" initialTab="stock" />;
      case "simple": return <ProductDetailScreen productId="p7" initialTab="pricing" />;
      case "batch": return <BatchPriceScreen initialDate={addDays(TODAY, 1)} />;
      case "reports": return <ReportsScreen />;
      case "customers": return <CustomerReportScreen />;
      case "statement": return <CustomerAnalyticsScreen customerId="c12" />;
      case "volume": return <ProductVolumeScreen />;
      case "item": return <ItemAnalyticsScreen productId="p1" />;
      case "orders": return <OrderReportScreen />;
      case "prices": return <DailyPricesScreen />;
      default: return <CustomerDetailScreen customerId="c12" />;
    }
  })();

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
          <View key={preview} style={styles.screen}>{screen}</View>
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
