import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { CustomersScreen } from "@/features/customers";

export default function CustomersRoute() {
  return <PermissionGate permission={PERMISSIONS.manageCustomers}><CustomersScreen /></PermissionGate>;
}
