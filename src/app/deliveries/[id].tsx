import { useLocalSearchParams } from "expo-router";
import { PermissionGate } from "@/features/auth/PermissionGate";
import { PERMISSIONS } from "@/constants/permissions";
import { DeliveryDetailsScreen } from "@/features/deliveries/screens/DeliveryDetailsScreen";

export default function DeliveryDetailsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PermissionGate permission={PERMISSIONS.viewDeliveries}><DeliveryDetailsScreen deliveryId={id} /></PermissionGate>;
}
