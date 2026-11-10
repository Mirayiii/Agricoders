import { useLocalSearchParams } from "expo-router";

import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth/PermissionGate";
import { ReceiptScreen } from "@/features/deliveries/receipt/ReceiptScreen";

export default function ReceiptRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PermissionGate permission={PERMISSIONS.viewOrderDetails}><ReceiptScreen orderId={id} /></PermissionGate>;
}
