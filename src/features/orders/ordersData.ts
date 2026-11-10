import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { mutate, unwrap, useAppMutation, useRequestIds } from "@/services/data";
import { useOffline } from "@/services/offline";
import { supabase } from "@/services/supabase";
import type { OrderSource, OrderStatus } from "@/types/orders";
import type { DeliveryStatus } from "@/features/deliveries/shared";
import type { DiscountType } from "./orderMoney";

export const ordersKeys = {
  all: ["orders"] as const,
  list: () => ["orders", "list"] as const,
  detail: (id: string) => ["orders", "detail", id] as const,
};

// Totals come from the server (order_subtotal, order_discount and
// order_total), the same numbers the reports use. The app never adds them up.
export type OrderListRow = {
  id: string;
  order_number: string;
  customer_id: string;
  status: OrderStatus;
  requested_delivery_date: string;
  requires_attention: boolean;
  attention_reason: string | null;
  created_at: string;
  order_total: number;
  customers: { business_name: string; brand_name?: string | null } | null;
  order_items: { id: string }[];
  /** The issued Delivery Receipt, if any (searchable by DR#, requirement OM-01). */
  delivery_receipts?: { dr_number: number } | { dr_number: number }[] | null;
};

// Line ids, counted in the app: PostgREST 12+ reads "order_items(count)" as a
// column called count (aggregates are off), which fails with "permission denied".
const LIST_COLUMNS = "id,order_number,customer_id,status,requested_delivery_date,requires_attention,attention_reason,created_at,order_total,customers(business_name,brand_name),order_items(id),delivery_receipts(dr_number)";

export function useOrdersList() {
  return useQuery({
    queryKey: ordersKeys.list(),
    queryFn: () => unwrap(supabase.from("orders").select(LIST_COLUMNS).order("created_at", { ascending: false }).returns<OrderListRow[]>()),
  });
}

export { orderSearchText } from "./orderSearch";

export const itemCount = (order: Pick<OrderListRow, "order_items">) => order.order_items.length;

type Person = { full_name: string | null; email: string } | null;

export type OrderDelivery = { id: string; assigned_driver_id: string | null; scheduled_date: string; scheduled_time: string | null; status: DeliveryStatus; notes: string | null; received_by: string | null; profiles: Person };
export type OrderActivity = { id: string; action: string; details: Record<string, unknown>; created_at: string; profiles: Person };
export type OrderLine = {
  id: string;
  quantity: number;
  unit_of_measurement: string;
  unit_price: number;
  line_total: number;
  preparation_status: string;
  products: { product_name: string } | null;
  product_varieties: { variety_name: string } | null;
};
export type OrderDetail = {
  id: string;
  order_number: string;
  status: OrderStatus;
  updated_at?: string;
  order_source: OrderSource;
  requested_delivery_date: string;
  /** Phase 4: optional delivery window taken with the order. */
  delivery_time_start?: string | null;
  delivery_time_end?: string | null;
  /** Phase 4: the source as named in the admin list (custom sources included). */
  order_sources?: { label: string } | null;
  notes: string | null;
  requires_attention: boolean;
  attention_reason: string | null;
  discount_type: DiscountType | null;
  discount_value: number | null;
  discount_reason: string | null;
  sales_invoice_number: string | null;
  order_subtotal: number;
  order_discount: number;
  order_total: number;
  customers: { business_name: string; brand_name?: string | null; contact_person: string | null; phone: string | null; delivery_address: string | null } | null;
  deliveries: OrderDelivery[] | null;
  order_items: OrderLine[];
  order_activity: OrderActivity[];
};

const DETAIL_COLUMNS = [
  "id,order_number,status,updated_at,order_source,requested_delivery_date,delivery_time_start,delivery_time_end,order_sources(label),notes,requires_attention,attention_reason",
  "discount_type,discount_value,discount_reason,sales_invoice_number,order_subtotal,order_discount,order_total",
  "customers(business_name,brand_name,contact_person,phone,delivery_address)",
  "deliveries(id,assigned_driver_id,scheduled_date,scheduled_time,status,notes,received_by,profiles!deliveries_assigned_driver_id_fkey(full_name,email))",
  "order_items(id,quantity,unit_of_measurement,unit_price,line_total,preparation_status,products(product_name),product_varieties(variety_name))",
  "order_activity(id,action,details,created_at,profiles(full_name,email))",
].join(",");

export function useOrderDetail(orderId: string | undefined) {
  return useQuery({
    queryKey: ordersKeys.detail(orderId ?? ""),
    enabled: Boolean(orderId),
    queryFn: () =>
      unwrap(
        supabase
          .from("orders")
          .select(DETAIL_COLUMNS)
          .eq("id", orderId ?? "")
          .order("created_at", { referencedTable: "order_items", ascending: true })
          .order("created_at", { referencedTable: "order_activity", ascending: false })
          .maybeSingle()
          .returns<OrderDetail | null>(),
      ),
  });
}

/** Everything that shows an order or its total. */
const ORDER_VIEWS = [ordersKeys.all, ["home"], ["reports"], ["customers"]];

export type OrderMoney = { order_id: string; subtotal: number; discount_amount: number; total: number };

export function useApplyDiscount() {
  return useAppMutation(
    (args: { orderId: string; type: DiscountType; value: number; reason: string; requestId: string }) =>
      mutate<OrderMoney>("apply_order_discount", { p_order_id: args.orderId, p_discount_type: args.type, p_discount_value: args.value, p_reason: args.reason.trim() }, args.requestId),
    ORDER_VIEWS,
  );
}

export function useRemoveDiscount() {
  return useAppMutation(
    (args: { orderId: string; reason: string; requestId: string }) =>
      mutate<OrderMoney>("remove_order_discount", { p_order_id: args.orderId, p_reason: args.reason.trim() }, args.requestId),
    ORDER_VIEWS,
  );
}

export function useSetSalesInvoice() {
  return useAppMutation(
    (args: { orderId: string; value: string; reason?: string | null; requestId: string }) =>
      mutate("set_sales_invoice_number", { p_order_id: args.orderId, p_sales_invoice_number: args.value.trim(), p_reason: args.reason?.trim() || null }, args.requestId),
    ORDER_VIEWS,
  );
}

export function useTransitionOrder() {
  return useAppMutation(
    (args: { orderId: string; next: OrderStatus }) => mutate("transition_order_status", { p_order_id: args.orderId, p_next_status: args.next, p_details: {} }),
    ORDER_VIEWS,
  );
}

/**
 * Confirm an order that is For verification (Phase 10: can be queued offline).
 * It is sent with the order's last change time as the person saw it, so an
 * order edited, flagged or cancelled meanwhile is held for review rather than
 * confirmed over the newer change.
 */
export function useConfirmOrder() {
  const offline = useOffline();
  const ids = useRequestIds();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (args: { orderId: string; orderNumber: string; updatedAt?: string }) => {
      const key = `confirm:${args.orderId}`;
      const outcome = await offline.run({
        id: ids.idFor(key),
        rpc: "offline_confirm_order",
        args: { p_order_id: args.orderId },
        seen: args.updatedAt ? { updated_at: args.updatedAt } : {},
        label: `Confirm ${args.orderNumber}`,
        targetId: args.orderId,
      });
      ids.done(key);
      return { queued: outcome.queued };
    },
    onSuccess: async (result) => {
      if (!result.queued) await Promise.all(ORDER_VIEWS.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}

export function useSetAttention() {
  return useAppMutation(
    (args: { orderId: string; flagged: boolean; reason?: string }) =>
      mutate("set_order_attention", { p_order_id: args.orderId, p_requires_attention: args.flagged, p_reason: args.flagged ? args.reason ?? null : null }),
    ORDER_VIEWS,
  );
}
