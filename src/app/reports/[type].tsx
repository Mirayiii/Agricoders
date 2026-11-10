import { Redirect, useLocalSearchParams } from "expo-router";

import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { CustomerReportScreen, DailyPricesScreen, OrderReportScreen, ProductVolumeScreen } from "@/features/reports";
import { isPeriod, parseRange } from "@/features/reports/reportsLogic";

export default function ReportRoute() {
  const { type, period, back, start, end } = useLocalSearchParams<{ type: string; period?: string; back?: string; start?: string; end?: string }>();
  const props = { initialPeriod: isPeriod(period) ? period : "week" as const, initialBack: Math.max(0, Number(back) || 0), initialRange: parseRange(start, end) };
  const screen = type === "customers" ? <CustomerReportScreen {...props} />
    : type === "products" ? <ProductVolumeScreen {...props} />
    : type === "orders" ? <OrderReportScreen {...props} />
    : type === "prices" ? <DailyPricesScreen />
    : null;
  if (!screen) return <Redirect href="/reports" />;
  return <PermissionGate permission={PERMISSIONS.viewReports}>{screen}</PermissionGate>;
}
