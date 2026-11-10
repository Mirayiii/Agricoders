import { useLocalSearchParams } from "expo-router";

import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { NewOrderScreen } from "@/features/orders/new/NewOrderScreen";

export default function DuplicateOrderRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <PermissionGate permission={PERMISSIONS.manageOrders}><NewOrderScreen duplicateOrderId={id} /></PermissionGate>;
}
