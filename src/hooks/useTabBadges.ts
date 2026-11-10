import { useEffect, useState } from "react";
import { AppState } from "react-native";

import type { MainTabKey } from "@/constants/navigation";
import { supabase } from "@/services/supabase";
import { toISODate } from "@/utils/format";

type Badges = Partial<Record<MainTabKey, number>>;

async function countOrders(statuses: string[]) {
  const { count } = await supabase.from("orders").select("id", { count: "exact", head: true }).in("status", statuses);
  return count ?? 0;
}

async function countTodayDeliveries() {
  const { count } = await supabase
    .from("deliveries")
    .select("id", { count: "exact", head: true })
    .eq("scheduled_date", toISODate(new Date()))
    .in("status", ["scheduled", "for_delivery"]);
  return count ?? 0;
}

// Counts are scoped by RLS, so each role only sees work it can act on.
// They refresh whenever the focused tab changes or the app returns to the foreground.
export function useTabBadges(visibleTabs: MainTabKey[], refreshKey: number) {
  const [badges, setBadges] = useState<Badges>({});
  const [foregroundKey, setForegroundKey] = useState(0);
  const tabsKey = visibleTabs.join(",");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setForegroundKey((key) => key + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let active = true;
    const tabs = tabsKey.split(",");
    void Promise.all([
      tabs.includes("orders") ? countOrders(["for_verification"]) : Promise.resolve(0),
      tabs.includes("purchasing") ? countOrders(["confirmed", "for_preparation"]) : Promise.resolve(0),
      tabs.includes("deliveries") ? countTodayDeliveries() : Promise.resolve(0),
    ]).then(([orders, purchasing, deliveries]) => {
      if (active) setBadges({ orders, purchasing, deliveries });
    });
    return () => {
      active = false;
    };
  }, [tabsKey, refreshKey, foregroundKey]);

  return badges;
}
