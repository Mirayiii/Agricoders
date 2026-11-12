import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import { supabase } from "@/services/supabase";
import { DataError } from "./supabaseQuery";

/** A fresh id for one user action. Retrying the same action reuses it. */
export function newClientRequestId(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * RPCs that accept p_client_request_id and use mutation_requests to return
 * the first result on a retry. Each phase adds its RPCs here as the server
 * side gains duplicate protection (Phase 3 onwards).
 */
const IDEMPOTENT_RPCS = new Set<string>([
  // Phase 3
  "apply_order_discount",
  "remove_order_discount",
  "set_sales_invoice_number",
  // Phase 4
  "create_order",
  // Phase 5
  "start_packing",
  "cancel_packing",
  "set_item_packed",
  "confirm_item_removed",
  // Phase 6
  "reorder_route",
  "assign_delivery_driver",
  "complete_delivery",
  "issue_delivery_receipt",
  // Phase 7
  "save_customer",
  "set_customer_archived",
  // Phase 8
  "create_product",
  "update_product",
  "set_product_archived",
  "delete_product",
  "set_product_price",
  "batch_update_prices",
]);

/** Calls a write RPC. Adds the client request id when the RPC supports it. */
export async function mutate<T = unknown>(rpcName: string, args: Record<string, unknown>, clientRequestId = newClientRequestId()): Promise<T> {
  const payload = IDEMPOTENT_RPCS.has(rpcName) ? { ...args, p_client_request_id: clientRequestId } : args;
  const { data, error } = await supabase.rpc(rpcName, payload);
  if (error) throw new DataError(error.message, error.code);
  return data as T;
}

/**
 * useMutation with the app's defaults: on success, refresh the listed queries
 * so every screen showing that data updates.
 */
export function useAppMutation<TArgs, TResult>(run: (args: TArgs) => Promise<TResult>, invalidates: QueryKey[] = []) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all(invalidates.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}

/**
 * One request id per attempt at an action. It stays the same while `key`
 * (the action's details) is unchanged, so retrying after a lost response is
 * not done twice; changing the details or calling reset() starts a new one.
 */
export function useRequestId() {
  const current = useRef<{ key: string; id: string } | null>(null);
  const idFor = useCallback((key: string) => {
    if (current.current?.key !== key) current.current = { key, id: newClientRequestId() };
    return current.current.id;
  }, []);
  const reset = useCallback(() => { current.current = null; }, []);
  return { idFor, reset };
}

/**
 * Like useRequestId, for screens with many actions at once (one per checklist
 * line). An action keeps its id until done(key) is called after it succeeds,
 * so a retry after a lost response reuses it and the server acts only once.
 */
export function useRequestIds() {
  const ids = useRef(new Map<string, string>());
  const idFor = useCallback((key: string) => {
    let id = ids.current.get(key);
    if (!id) {
      id = newClientRequestId();
      ids.current.set(key, id);
    }
    return id;
  }, []);
  const done = useCallback((key: string) => { ids.current.delete(key); }, []);
  return { idFor, done };
}
