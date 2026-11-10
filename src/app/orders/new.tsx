import { useLocalSearchParams } from "expo-router";

import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { NewOrderScreen } from "@/features/orders/new/NewOrderScreen";

export default function NewOrderRoute() {
  const { customerId } = useLocalSearchParams<{ customerId?: string }>();
  return <PermissionGate permission={PERMISSIONS.manageOrders}><NewOrderScreen customerId={customerId} /></PermissionGate>;
}
