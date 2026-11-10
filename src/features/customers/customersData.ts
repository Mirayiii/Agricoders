import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { mutate, unwrap, useAppMutation, useRequestIds } from "@/services/data";
import { supabase } from "@/services/supabase";
import type { OrderStatus } from "@/types/orders";
import { draftPayload, type CustomerDraft, type CustomerProfile, type CustomerRow } from "./customersLogic";

export const customersKeys = {
  all: ["customers"] as const,
  list: () => ["customers", "list"] as const,
  profile: (id: string) => ["customers", "profile", id] as const,
  history: (id: string) => ["customers", "history", id] as const,
};

/** Every customer with their order count (administrators and administrative staff). */
export function useCustomers() {
  return useQuery({
    queryKey: customersKeys.list(),
    queryFn: async () => {
      const rows = (await unwrap(supabase.rpc("get_customers"))) as CustomerRow[];
      return rows.map((row) => ({ ...row, order_count: Number(row.order_count) }));
    },
  });
}

export function useCustomerProfile(customerId: string) {
  return useQuery({
    queryKey: customersKeys.profile(customerId),
    enabled: Boolean(customerId),
    queryFn: async () => (await unwrap(supabase.rpc("get_customer_profile", { p_customer_id: customerId }))) as CustomerProfile,
  });
}

export type HistoryRow = { order_id: string; order_number: string; status: OrderStatus; requested_delivery_date: string; total: number; total_rows: number };
export const HISTORY_PAGE = 20;

/** The customer's orders, newest first, 20 at a time. */
export function useCustomerHistory(customerId: string) {
  return useInfiniteQuery({
    queryKey: customersKeys.history(customerId),
    enabled: Boolean(customerId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (await unwrap(supabase.rpc("get_customer_order_history", { p_customer_id: customerId, p_limit: HISTORY_PAGE, p_offset: pageParam }))) as HistoryRow[],
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.length, 0);
      return last.length === HISTORY_PAGE && loaded < Number(last[0]?.total_rows ?? 0) ? loaded : undefined;
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

// New order reads the active customer list, so it refreshes too.
const AFFECTED = [customersKeys.all, ["new-order"], ["orders"]];

export function useSaveCustomer() {
  const once = useOnce();
  return useAppMutation(
    (args: { customerId: string | null; draft: CustomerDraft }) => {
      const payload = draftPayload(args.draft);
      return once(`save:${args.customerId ?? "new"}:${JSON.stringify(payload)}`, (id) =>
        mutate<{ customer_id: string; business_name: string; brand_name: string | null }>("save_customer", { p_customer_id: args.customerId, p_customer: payload }, id));
    },
    AFFECTED,
  );
}

export function useSetCustomerArchived() {
  const once = useOnce();
  return useAppMutation(
    (args: { customerId: string; archived: boolean }) =>
      once(`archive:${args.customerId}:${args.archived}`, (id) =>
        mutate<{ customer_id: string; business_name: string; status: string }>("set_customer_archived", { p_customer_id: args.customerId, p_archived: args.archived }, id)),
    AFFECTED,
  );
}
