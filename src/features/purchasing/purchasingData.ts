import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { mutate, unwrap, useAppMutation, useRequestIds } from "@/services/data";
import { escapeHtml, pdfPage, sharePdf } from "@/services/pdf";
import { supabase } from "@/services/supabase";
import { useOffline } from "@/services/offline";
import { buyListHeaders, buyListRows, type BuyList, type PackLine, type PackOrder, type PackRemoval, withLinePacked } from "./purchasingLogic";

export const purchasingKeys = {
  all: ["purchasing"] as const,
  board: () => ["purchasing", "board"] as const,
  buy: (from: string | null, to: string) => ["purchasing", "buy", from ?? "", to] as const,
  today: () => ["purchasing", "today"] as const,
  home: () => ["purchasing", "home"] as const,
};

const BOARD_COLUMNS =
  "id,order_number,requested_delivery_date,status,packing_version,delivery_time_start,delivery_time_end,customers(business_name,brand_name,delivery_address),order_items(id,quantity,unit_of_measurement,notes,note_changed_at,preparation_status,products(product_name)),order_item_removals(id,description,quantity,unit_of_measurement,removed_at,confirmed_at),deliveries(id,status)";

/** Orders being packed and orders confirmed and waiting, with their lines. */
export function usePackingBoard() {
  return useQuery({
    queryKey: purchasingKeys.board(),
    queryFn: () => unwrap(supabase.from("orders").select(BOARD_COLUMNS).in("status", ["confirmed", "for_preparation"]).order("requested_delivery_date").returns<PackOrder[]>()),
  });
}

/** Manila's date from the server, so Today and advance labels don't depend on the phone's clock. */
export function useManilaToday() {
  return useQuery({
    queryKey: purchasingKeys.today(),
    staleTime: 10 * 60 * 1000,
    queryFn: async () => (await unwrap(supabase.rpc("manila_today"))) as string,
  });
}

export function useBuyList(from: string | null, to: string | null) {
  return useQuery({
    queryKey: purchasingKeys.buy(from, to ?? ""),
    enabled: Boolean(to),
    queryFn: async () => (await unwrap(supabase.rpc("get_buy_list", { p_from: from, p_to: to }))) as BuyList,
  });
}

export type PurchasingHome = { date: string; awaiting_buying: number; awaiting_packing: number };

/** Requirement HD-03: today's counters on Purchasing Home, worked out by the server from the saved bought quantities. */
export function usePurchasingHome(enabled = true) {
  return useQuery({
    queryKey: purchasingKeys.home(),
    enabled,
    queryFn: async () => (await unwrap(supabase.rpc("get_purchasing_today"))) as PurchasingHome,
  });
}

type Progress = { order_id: string; order_number: string; status: string; packed_count: number; item_count: number; packing_version?: number; removals_to_confirm?: number; replayed?: boolean };

export function useStartPacking() {
  const ids = useRequestIds();
  return useAppMutation(async (orderId: string) => {
    const key = `start:${orderId}`;
    const result = await mutate<Progress>("start_packing", { p_order_id: orderId }, ids.idFor(key));
    ids.done(key);
    return result;
  }, [purchasingKeys.all, ["orders"]]);
}

export function useCancelPacking() {
  const ids = useRequestIds();
  return useAppMutation(async (orderId: string) => {
    const key = `cancel:${orderId}`;
    const result = await mutate<Progress>("cancel_packing", { p_order_id: orderId }, ids.idFor(key));
    ids.done(key);
    return result;
  }, [purchasingKeys.all, ["orders"]]);
}

/**
 * Tick or untick a line. The tick shows straight away; if the server refuses
 * (for example the order was cancelled on another phone) it is undone and the
 * board reloads. Offline, the tick is saved and sent later (Phase 10) with
 * what the packer saw, so a line whose quantity changed or that someone else
 * ticked meanwhile is held for review instead of being overwritten.
 */
export function useSetItemPacked() {
  const client = useQueryClient();
  const ids = useRequestIds();
  const offline = useOffline();
  return useMutation({
    mutationFn: async ({ line, orderNumber, packingVersion, packed }: { line: PackLine; orderNumber: string; packingVersion: number; packed: boolean }): Promise<{ queued: true } | ({ queued: false } & Progress)> => {
      const key = `pack:${line.id}:${packed}:${packingVersion}`;
      const outcome = await offline.run<Progress>({
        id: ids.idFor(key),
        rpc: "offline_set_item_packed",
        args: { p_item_id: line.id, p_packed: packed },
        // The packing version is checked by the server: a tick made on a list
        // that was changed since it loaded is refused, never applied to the new list.
        seen: { packed: !packed, quantity: line.quantity, unit: line.unit_of_measurement, packing_version: packingVersion },
        label: `${packed ? "Packed" : "Unticked"} ${line.products?.product_name ?? "item"} · ${orderNumber}`,
        targetId: line.id,
      });
      ids.done(key);
      return outcome.queued ? { queued: true } : { queued: false, ...outcome.result };
    },
    onMutate: async ({ line, packed }) => {
      await client.cancelQueries({ queryKey: purchasingKeys.board() });
      const before = client.getQueryData<PackOrder[]>(purchasingKeys.board());
      if (before) client.setQueryData(purchasingKeys.board(), withLinePacked(before, line.id, packed));
      return { before };
    },
    onError: (_error, _vars, context) => {
      if (context?.before) client.setQueryData(purchasingKeys.board(), context.before);
    },
    onSettled: async (result) => {
      // Queued: keep the tick on screen; the board reloads after it syncs.
      if (result?.queued) return;
      await client.invalidateQueries({ queryKey: purchasingKeys.all });
      if (result?.status === "for_delivery") await client.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/**
 * A packed item was removed by an edit: packing staff confirm it was taken
 * out of the prepared order. Other ticks stay; when nothing else is left the
 * server moves the order back to For delivery. Online only.
 */
export function useConfirmRemoval() {
  const ids = useRequestIds();
  return useAppMutation(async ({ removal, packingVersion }: { removal: PackRemoval; packingVersion: number }) => {
    const key = `removed:${removal.id}:${packingVersion}`;
    const result = await mutate<Progress>("confirm_item_removed", { p_removal_id: removal.id, p_packing_version: packingVersion }, ids.idFor(key));
    ids.done(key);
    return result;
  }, [purchasingKeys.all, ["orders"], ["deliveries"]]);
}

/** Task 5.5: To buy as a PDF, through the share sheet (print dialog on web). */
export async function exportBuyList(list: BuyList, label: string): Promise<boolean> {
  const head = buyListHeaders().map((cell, index) => `<th${index > 0 ? ' class="num"' : ""}>${escapeHtml(cell)}</th>`).join("");
  const rows = buyListRows(list)
    .map((cells) => `<tr>${cells.map((cell, index) => `<td${index > 0 ? ' class="num"' : ""}>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const overdue = list.overdue_orders ? `<p class="muted">Includes ${list.overdue_orders} late ${list.overdue_orders === 1 ? "order" : "orders"} not yet delivered.</p>` : "";
  const body = `<h1>To buy</h1><p class="muted">${escapeHtml(label)} · Orders for verification, confirmed and packing · Printed ${escapeHtml(new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" }))}</p>${overdue}
<p class="muted">${list.short_lines} of ${list.total_lines} lines short of stock</p>
<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  return sharePdf(pdfPage("MEAH To buy", body), "Share To buy list");
}
