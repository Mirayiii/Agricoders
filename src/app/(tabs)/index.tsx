import { DashboardScreen } from "@/features/dashboard";
import { PermissionGate } from "@/features/auth";
import { PERMISSIONS } from "@/constants/permissions";

export default function DashboardRoute() {
  return <PermissionGate permission={PERMISSIONS.viewDashboard}><DashboardScreen /></PermissionGate>;
}
