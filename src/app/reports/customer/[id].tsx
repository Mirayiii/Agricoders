import { useLocalSearchParams } from "expo-router";

import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { CustomerAnalyticsScreen } from "@/features/reports";
import { isPeriod, parseRange } from "@/features/reports/reportsLogic";

/** Customer analytics and the customer statement. Administrators only. */
export default function CustomerStatementRoute() {
  const { id, period, back, start, end } = useLocalSearchParams<{ id: string; period?: string; back?: string; start?: string; end?: string }>();
  return (
    <PermissionGate permission={PERMISSIONS.viewReports}>
      <CustomerAnalyticsScreen customerId={id} initialPeriod={isPeriod(period) ? period : "month"} initialBack={Math.max(0, Number(back) || 0)} initialRange={parseRange(start, end)} />
    </PermissionGate>
  );
}
