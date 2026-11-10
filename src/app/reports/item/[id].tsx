import { useLocalSearchParams } from "expo-router";

import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { ItemAnalyticsScreen } from "@/features/reports";
import { isPeriod, parseRange } from "@/features/reports/reportsLogic";

export default function ItemAnalyticsRoute() {
  const { id, period, back, start, end } = useLocalSearchParams<{ id: string; period?: string; back?: string; start?: string; end?: string }>();
  return (
    <PermissionGate permission={PERMISSIONS.viewReports}>
      <ItemAnalyticsScreen productId={id} initialPeriod={isPeriod(period) ? period : "week"} initialBack={Math.max(0, Number(back) || 0)} initialRange={parseRange(start, end)} />
    </PermissionGate>
  );
}
