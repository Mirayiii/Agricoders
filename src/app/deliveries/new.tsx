import { useLocalSearchParams } from "expo-router";
import { PermissionGate } from "@/features/auth/PermissionGate";
import { PERMISSIONS } from "@/constants/permissions";
import { DeliveryFormScreen } from "@/features/deliveries/screens/DeliveryFormScreen";

export default function CreateDeliveryRoute() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  return <PermissionGate permission={PERMISSIONS.manageDeliveries}><DeliveryFormScreen initialOrderId={orderId} /></PermissionGate>;
}
