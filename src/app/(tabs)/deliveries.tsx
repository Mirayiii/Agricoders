import { DeliveriesScreen } from "@/features/deliveries";
import { PermissionGate } from "@/features/auth";
import { PERMISSIONS } from "@/constants/permissions";

export default function DeliveriesRoute() {
  return <PermissionGate permission={PERMISSIONS.viewDeliveries}><DeliveriesScreen /></PermissionGate>;
}
