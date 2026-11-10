import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { ReportsScreen } from "@/features/reports";

/** Reports are administrator-only; the server checks it too. */
export default function ReportsRoute() {
  return <PermissionGate permission={PERMISSIONS.viewReports}><ReportsScreen /></PermissionGate>;
}
