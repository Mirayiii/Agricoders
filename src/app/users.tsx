import { PermissionGate } from "@/features/auth";
import { PERMISSIONS } from "@/constants/permissions";
import { UserManagementScreen } from "@/features/users";

export default function UsersRoute() {
  return <PermissionGate permission={PERMISSIONS.manageUsers}><UserManagementScreen /></PermissionGate>;
}
