import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { mutate, unwrap, useAppMutation } from "@/services/data";
import { useOffline } from "@/services/offline";
import { supabase } from "@/services/supabase";
import type { AvailabilityRecord, PriceRecord, ProductRecord, SeenPrice } from "./newOrderLogic";

export const newOrderKeys = {
  base: ["new-order"] as const,
  catalog: () => ["new-order", "catalog"] as const,
  customerPrices: (customerId: string) => ["new-order", "customer-prices", customerId] as const,
  lists: () => ["new-order", "lists"] as const,
  copy: (orderId: string) => ["new-order", "copy", orderId] as const,
};

export type CustomerOption = { id: string; customer_code: string; business_name: string; brand_name?: string | null; contact_person: string | null };
export type OrderSourceOption = { id: string; code: string | null; label: string; sort_order: number };
export type DeliveryTimeOption = { id: string; label: string; starts_at: string | null; ends_at: string | null; sort_order: number };

export type CatalogData = { customers: CustomerOption[]; products: ProductRecord[]; listPrices: PriceRecord[]; availability: AvailabilityRecord[] };

const PRICE_COLUMNS = "product_id,product_sku_id,selling_price,effective_from,effective_to";

/** Customers, products with their SKUs, list prices and stock: everything steps 1 and 2 need. */
export function useNewOrderCatalog() {
  return useQuery({
    queryKey: newOrderKeys.catalog(),
    queryFn: async (): Promise<CatalogData> => {
      const now = new Date().toISOString();
      const [customers, products, listPrices] = await Promise.all([
        unwrap(supabase.from("customers").select("id,customer_code,business_name,brand_name,contact_person").eq("status", "active").order("business_name").returns<CustomerOption[]>()),
        unwrap(supabase.from("products").select("id,product_name,unit_of_measurement,product_skus(id,selling_sku,unit_of_measurement,status)").eq("status", "active").order("product_name").returns<ProductRecord[]>()),
        unwrap(supabase.from("price_history").select(PRICE_COLUMNS).lte("effective_from", now).or(`effective_to.is.null,effective_to.gt.${now}`).returns<PriceRecord[]>()),
      ]);
      const availability = products.length
        ? ((await unwrap(supabase.rpc("get_product_inventory_availability", { p_product_ids: products.map((product) => product.id) }))) as AvailabilityRecord[])
        : [];
      return { customers, products, listPrices, availability };
    },
  });
}

/** This customer's own prices, which come before list prices. */
export function useCustomerPrices(customerId: string | null) {
  return useQuery({
    queryKey: newOrderKeys.customerPrices(customerId ?? ""),
    enabled: Boolean(customerId),
    queryFn: () => {
      const now = new Date().toISOString();
      return unwrap(supabase.from("customer_pricing").select(PRICE_COLUMNS).eq("customer_id", customerId ?? "").lte("effective_from", now).or(`effective_to.is.null,effective_to.gt.${now}`).returns<PriceRecord[]>());
    },
  });
}

/** Order sources and delivery times offered on step 3 (only the active ones). */
export function useOrderLists() {
  return useQuery({
    queryKey: newOrderKeys.lists(),
    queryFn: async () => {
      const [sources, times] = await Promise.all([
        unwrap(supabase.from("order_sources").select("id,code,label,sort_order").eq("is_active", true).order("sort_order").returns<OrderSourceOption[]>()),
        unwrap(supabase.from("delivery_time_slots").select("id,label,starts_at,ends_at,sort_order").eq("is_active", true).order("sort_order").returns<DeliveryTimeOption[]>()),
      ]);
      return { sources, times };
    },
  });
}

/** An existing order to copy (Order again). */
export type CopiedOrder = {
  customer_id: string;
  order_source_id: string | null;
  order_source: string;
  notes: string | null;
  customers: CustomerOption | null;
  order_items: { product_id: string; product_sku_id: string | null; variety_id: string | null; quantity: number; unit_of_measurement: string; notes: string | null }[];
};

export function useOrderToCopy(orderId: string | undefined) {
  return useQuery({
    queryKey: newOrderKeys.copy(orderId ?? ""),
    enabled: Boolean(orderId),
    queryFn: () => unwrap(supabase.from("orders")
      .select("customer_id,order_source_id,order_source,notes,customers(id,customer_code,business_name,brand_name,contact_person),order_items(product_id,product_sku_id,variety_id,quantity,unit_of_measurement,notes)")
      .eq("id", orderId ?? "").single<CopiedOrder>()),
  });
}

/** An order already booked for this customer on this day, to warn about duplicates. */
export function useSameDayOrder(customerId: string | null, date: string | null) {
  return useQuery({
    queryKey: ["orders", "same-day", customerId, date],
    enabled: Boolean(customerId && date),
    queryFn: async () => {
      const rows = await unwrap(supabase.from("orders").select("order_number").eq("customer_id", customerId ?? "").eq("requested_delivery_date", date ?? "").neq("status", "cancelled").limit(1).returns<{ order_number: string }[]>());
      return rows[0]?.order_number ?? null;
    },
  });
}

export type CreatedOrder = { order_id: string; order_number: string; status: string; subtotal: number; discount_amount: number; total: number; replayed?: boolean };

const AFTER_CREATE = [["orders"], ["home"], ["reports"], ["customers"], ["inventory"]];

/**
 * Saves the order in one call. Retrying with the same request id returns the
 * first order. Offline it is saved on the phone and sent later (Phase 10),
 * with the prices shown on screen: if any changed by then, nothing is saved
 * and the order waits for review under Offline changes. Online, a price that
 * changed while the form was open is shown for review the same way
 * (PriceChangedError) before anything is saved.
 */
export function useCreateOrder() {
  const offline = useOffline();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (args: { payload: { p_order: unknown; p_items: unknown }; sourceOrderId?: string; requestId: string; seenPrices: SeenPrice[]; label: string; acceptCurrentPrices?: boolean }) => {
      const outcome = await offline.run<CreatedOrder>({
        id: args.requestId,
        rpc: "offline_create_order",
        args: { ...args.payload, p_source_order_id: args.sourceOrderId ?? null },
        seen: { prices: args.seenPrices },
        label: args.label,
        targetId: args.requestId,
        acceptCurrentPrices: args.acceptCurrentPrices,
      });
      return outcome.queued ? ({ queued: true } as const) : ({ queued: false, order: outcome.result } as const);
    },
    onSuccess: async (result) => {
      if (!result.queued) await Promise.all(AFTER_CREATE.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}

const LISTS = [newOrderKeys.lists()];

export function useAddOrderSource() {
  return useAppMutation((label: string) => mutate<string>("add_order_source", { p_label: label.trim() }), LISTS);
}
export function useRemoveOrderSource() {
  return useAppMutation((id: string) => mutate("remove_order_source", { p_id: id }), LISTS);
}
export function useAddDeliveryTime() {
  return useAppMutation((args: { start: string; end: string | null }) => mutate<string>("add_delivery_time_slot", { p_starts_at: args.start, p_ends_at: args.end }), LISTS);
}
export function useRemoveDeliveryTime() {
  return useAppMutation((id: string) => mutate("remove_delivery_time_slot", { p_id: id }), LISTS);
}
