import { OrdersScreen } from "@/features/orders";
import { PermissionGate } from "@/features/auth";
import { PERMISSIONS } from "@/constants/permissions";

export default function OrdersRoute() {
  return <PermissionGate permission={PERMISSIONS.viewOrders}><OrdersScreen /></PermissionGate>;
}
