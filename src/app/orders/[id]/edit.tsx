import { useLocalSearchParams } from "expo-router";
import { PermissionGate } from "@/features/auth/PermissionGate";
import { PERMISSIONS } from "@/constants/permissions";
import { OrderEditScreen } from "@/features/orders/OrderEditScreen";

export default function OrderEditRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PermissionGate permission={PERMISSIONS.manageOrders}><OrderEditScreen orderId={id} /></PermissionGate>;
}
