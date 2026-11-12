import { useQuery } from "@tanstack/react-query";

import { mutate, unwrap, useAppMutation, useRequestIds } from "@/services/data";
import { supabase } from "@/services/supabase";
import { receiptNumber, type Receipt, type StopRow } from "./deliveriesLogic";

export const deliveriesKeys = {
  all: ["deliveries"] as const,
  board: () => ["deliveries", "board"] as const,
  drivers: (date: string) => ["deliveries", "drivers", date] as const,
  receipt: (orderId: string) => ["deliveries", "receipt", orderId] as const,
};

const STOP_COLUMNS =
  "id,order_id,scheduled_date,scheduled_time,status,route_position,received_by,completed_at,assigned_driver_id,orders(order_number,updated_at,status,packing_version,delivery_time_start,delivery_time_end,customers(business_name,brand_name,contact_person,phone,delivery_address),order_items(id)),profiles!deliveries_assigned_driver_id_fkey(full_name,email)";
export const DONE_WINDOW_DAYS = 30;

/** Open stops and the last 30 days of delivered ones. Drivers only get their own (RLS). */
export function useDeliveryBoard() {
  return useQuery({
    queryKey: deliveriesKeys.board(),
    queryFn: async () => {
      const since = new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString();
      const [open, done] = await Promise.all([
        unwrap(supabase.from("deliveries").select(STOP_COLUMNS).in("status", ["scheduled", "for_delivery"]).order("scheduled_date").returns<StopRow[]>()),
        unwrap(supabase.from("deliveries").select(STOP_COLUMNS).eq("status", "completed").gte("completed_at", since).order("completed_at", { ascending: false }).returns<StopRow[]>()),
      ]);
      return [...open, ...done];
    },
  });
}

/** Packed orders that still need a delivery scheduled (office staff). */
export function useUnscheduledCount(enabled: boolean) {
  return useQuery({
    queryKey: [...deliveriesKeys.all, "unscheduled"],
    enabled,
    queryFn: async () => {
      const rows = await unwrap(supabase.from("orders").select("id,deliveries(id)").eq("status", "for_delivery").returns<{ id: string; deliveries: { id: string }[] | null }[]>());
      return rows.filter((row) => !row.deliveries?.length).length;
    },
  });
}

export type DriverOption = { id: string; full_name: string; open_stops: number };

export function useDrivers(date: string, enabled: boolean) {
  return useQuery({
    queryKey: deliveriesKeys.drivers(date),
    enabled,
    queryFn: async () => (await unwrap(supabase.rpc("get_delivery_drivers", { p_date: date }))) as DriverOption[],
  });
}

type ReceiptRow = { id: string; order_id: string; dr_number: number; issued_at: string; finalized_at?: string | null; voided_at?: string | null; content: Omit<Receipt, "receipt_id" | "order_id" | "dr_number" | "dr_label" | "issued_at" | "finalized_at" | "voided_at"> };

export const toReceipt = (row: ReceiptRow): Receipt => ({
  ...row.content,
  receipt_id: row.id,
  order_id: row.order_id,
  dr_number: row.dr_number,
  dr_label: `DR-${receiptNumber(row)}`,
  issued_at: row.issued_at,
  finalized_at: row.finalized_at ?? null,
  voided_at: row.voided_at ?? null,
});

/** The order's issued receipt, or null if none has been issued. */
export function useReceipt(orderId: string) {
  return useQuery({
    queryKey: deliveriesKeys.receipt(orderId),
    enabled: Boolean(orderId),
    queryFn: async () => {
      // Requirement DE-03: the DR number stays fixed; the server refreshes the
      // contents from the latest saved order until the delivery is completed,
      // then the receipt is frozen.
      const row = (await unwrap(supabase.rpc("get_delivery_receipt", { p_order_id: orderId }))) as ReceiptRow | null;
      return row ? toReceipt(row) : null;
    },
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

export function useReorderRoute() {
  const once = useOnce();
  return useAppMutation(
    (args: { date: string; driverId: string | null; ids: string[] }) =>
      once(`route:${args.date}:${args.driverId}:${args.ids.join(",")}`, (id) => mutate("reorder_route", { p_date: args.date, p_driver_id: args.driverId, p_delivery_ids: args.ids }, id)),
    [deliveriesKeys.all],
  );
}

export function useAssignDriver() {
  const once = useOnce();
  return useAppMutation(
    (args: { deliveryId: string; driverId: string | null }) =>
      once(`assign:${args.deliveryId}:${args.driverId}`, (id) => mutate("assign_delivery_driver", { p_delivery_id: args.deliveryId, p_driver_id: args.driverId }, id)),
    [deliveriesKeys.all],
  );
}


