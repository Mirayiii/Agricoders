import { useLocalSearchParams } from "expo-router";
import { PermissionGate } from "@/features/auth/PermissionGate";
import { PERMISSIONS } from "@/constants/permissions";
import { OrderDetailsScreen } from "@/features/orders/OrderDetailsScreen";

export default function OrderDetailsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PermissionGate permission={PERMISSIONS.viewOrderDetails}><OrderDetailsScreen orderId={id} /></PermissionGate>;
}
