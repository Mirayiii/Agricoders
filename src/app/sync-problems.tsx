import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { SyncProblemsScreen } from "@/features/sync";

export default function SyncProblemsRoute() {
  return <PermissionGate permission={PERMISSIONS.manageUsers}><SyncProblemsScreen /></PermissionGate>;
}
