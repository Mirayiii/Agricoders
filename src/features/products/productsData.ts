import { useQuery } from "@tanstack/react-query";

import { DataError, mutate, unwrap, useAppMutation, useRequestIds } from "@/services/data";
import { supabase } from "@/services/supabase";
import { normalizeOverview, type BatchSheetRow, type PriceHistoryRow, type ProductOverview } from "./productsLogic";

export const productsKeys = {
  all: ["products"] as const,
  list: () => ["products", "list"] as const,
  units: (id: string) => ["products", "units", id] as const,
  prices: (id: string) => ["products", "prices", id] as const,
  activity: (skuId: string) => ["products", "activity", skuId] as const,
  batch: (date: string, compare: string | null) => ["products", "batch", date, compare] as const,
};

/** Products & stock list (administrators, administrative and purchasing staff). */
export function useProductsOverview() {
  return useQuery({
    queryKey: productsKeys.list(),
    queryFn: async () => ((await unwrap(supabase.rpc("get_products_overview"))) as Record<string, unknown>[]).map(normalizeOverview),
  });
}

/** One product from the list query, so the detail screen opens instantly from the list. */
export function useProduct(productId: string) {
  const list = useProductsOverview();
  return { ...list, product: list.data?.find((row) => row.id === productId) as ProductOverview | undefined };
}

export type UnitRow = { id: string; unit_of_measurement: string; buying_sku: string | null; selling_sku: string | null };

export function useProductUnits(productId: string) {
  return useQuery({
    queryKey: productsKeys.units(productId),
    enabled: Boolean(productId),
    queryFn: async () =>
      (await unwrap(supabase.from("product_skus").select("id,unit_of_measurement,buying_sku,selling_sku").eq("product_id", productId).eq("status", "active").order("created_at"))) as UnitRow[],
  });
}

export function usePriceHistory(productId: string, enabled = true) {
  return useQuery({
    queryKey: productsKeys.prices(productId),
    enabled: Boolean(productId) && enabled,
    queryFn: async () =>
      ((await unwrap(supabase.rpc("get_price_history", { p_product_id: productId }))) as PriceHistoryRow[]).map((row) => ({
        ...row,
        cost_price: Number(row.cost_price),
        selling_price: Number(row.selling_price),
        margin_percent: row.margin_percent === null ? null : Number(row.margin_percent),
      })),
  });
}

export type StockActivity = { id: string; transaction_type: "increase" | "decrease" | "adjustment"; quantity: number; previous_quantity: number; new_quantity: number; reason: string; created_at: string; performed_by_name: string };

export function useStockActivity(skuId: string | null) {
  return useQuery({
    queryKey: productsKeys.activity(skuId ?? ""),
    enabled: Boolean(skuId),
    queryFn: async () => (await unwrap(supabase.rpc("get_inventory_activity", { p_sku_id: skuId, p_limit: 10 }))) as StockActivity[],
  });
}

export type BatchSheet = { price_date: string; compare_date: string | null; compare_dates: string[]; products: BatchSheetRow[] };

export function useBatchSheet(priceDate: string, compareDate: string | null) {
  return useQuery({
    queryKey: productsKeys.batch(priceDate, compareDate),
    queryFn: async () => (await unwrap(supabase.rpc("get_batch_price_sheet", { p_price_date: priceDate, p_compare_date: compareDate }))) as BatchSheet,
  });
}

/** One request id per action until it succeeds, so a retry is done once. */
function useOnce() {
  const ids = useRequestIds();
  return async <T,>(key: string, run: (id: string) => Promise<T>) => {
    const result = await run(ids.idFor(key));
    ids.done(key);
    return result;
  };
}

// New order and the order screens read product prices and units.
const AFFECTED = [productsKeys.all, ["new-order"], ["reports"]];

export function useCreateProduct() {
  const once = useOnce();
  return useAppMutation(
    (payload: Record<string, unknown>) =>
      once(`create:${JSON.stringify(payload)}`, (id) => mutate<{ product_id: string; product_name: string }>("create_product", { p_product: payload }, id)),
    AFFECTED,
  );
}

export type ProductChanges = {
  product_name?: string;
  track_stock?: boolean;
  add_unit?: string;
  default_unit?: string;
  remove_unit?: string;
  /** Renames a unit. Past orders and receipts keep the old name. */
  rename_unit?: { from: string; to: string };
  buying_sku?: string;
  selling_sku?: string;
  cost_price?: number;
  selling_price?: number;
};

export function useUpdateProduct() {
  const once = useOnce();
  return useAppMutation(
    (args: { productId: string; changes: ProductChanges }) =>
      once(`update:${args.productId}:${JSON.stringify(args.changes)}`, (id) =>
        mutate<{ product_id: string; product_name: string }>("update_product", { p_product_id: args.productId, p_changes: args.changes }, id)),
    AFFECTED,
  );
}

export function useSetProductArchived() {
  const once = useOnce();
  return useAppMutation(
    (args: { productId: string; archived: boolean }) =>
      once(`archive:${args.productId}:${args.archived}`, (id) =>
        mutate<{ product_id: string; product_name: string; status: string }>("set_product_archived", { p_product_id: args.productId, p_archived: args.archived }, id)),
    AFFECTED,
  );
}

export function useSetProductPrice() {
  const once = useOnce();
  return useAppMutation(
    (args: { productId: string; cost: number; selling: number }) =>
      once(`price:${args.productId}:${args.cost}:${args.selling}`, (id) =>
        mutate<{ margin_percent: number | null }>("set_product_price", { p_product_id: args.productId, p_cost: args.cost, p_selling: args.selling }, id)),
    AFFECTED,
  );
}

export function useBatchUpdatePrices() {
  const once = useOnce();
  return useAppMutation(
    (args: { priceDate: string; rows: { product_id: string; cost_price: number; selling_price: number }[] }) =>
      once(`batch:${args.priceDate}:${JSON.stringify(args.rows)}`, (id) =>
        mutate<{ updated: number; effective_from: string }>("batch_update_prices", { p_price_date: args.priceDate, p_rows: args.rows }, id)),
    AFFECTED,
  );
}

/** Manual stock change on the product's default unit (the existing inventory RPC). */
export function useAdjustStock() {
  return useAppMutation(
    async (args: { skuId: string; type: "increase" | "decrease"; quantity: number; reason: string; threshold: number | null }) =>
      unwrap(supabase.rpc("adjust_inventory", { p_sku_id: args.skuId, p_transaction_type: args.type, p_quantity: args.quantity, p_reason: args.reason, p_low_stock_threshold: args.threshold })),
    [productsKeys.all, ["inventory"]],
  );
}

/** A server refusal as written, or a plain network message. */
export function problemText(error: unknown): string {
  if (error instanceof DataError && error.code) return error.message;
  if (error instanceof Error && /fetch|network/i.test(error.message)) return "Couldn’t reach the server. Nothing was saved twice: try again.";
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
