import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/services/supabase";
import { unwrap } from "@/services/data";
import { toISODate } from "@/utils/format";
import type { HomeDelivery, HomeKind, HomeOrder } from "./homeLogic";

export { homeCounts, homeKindFor, type HomeDelivery, type HomeKind, type HomeOrder } from "./homeLogic";

export const homeQueryKey = (kind: HomeKind) => ["home", kind] as const;

/** Open orders and today's deliveries; RLS limits both to what the role may see. */
export function useHomeData(kind: HomeKind) {
  return useQuery({
    queryKey: homeQueryKey(kind),
    queryFn: async () => {
      const [orders, deliveries] = await Promise.all([
        kind === "delivery"
          ? Promise.resolve([] as HomeOrder[])
          : unwrap<HomeOrder[]>(
            supabase
              .from("orders")
              .select("id,order_number,status,requested_delivery_date,requires_attention,attention_reason,customers(business_name,brand_name),order_items(id,preparation_status)")
              .not("status", "in", "(completed,cancelled)")
              .order("requested_delivery_date", { ascending: true })
              .returns<HomeOrder[]>(),
          ),
        kind === "purchasing"
          ? Promise.resolve([] as HomeDelivery[])
          : unwrap<HomeDelivery[]>(
            supabase
              .from("deliveries")
              .select("id,order_id,scheduled_time,status,orders(order_number,status,customers(business_name,brand_name,delivery_address))")
              .eq("scheduled_date", toISODate(new Date()))
              .order("scheduled_time", { ascending: true, nullsFirst: false })
              .returns<HomeDelivery[]>(),
          ),
      ]);
      return { orders, deliveries };
    },
  });
}

