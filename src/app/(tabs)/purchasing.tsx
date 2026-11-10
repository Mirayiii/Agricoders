import { useLocalSearchParams } from "expo-router";

import { PurchasingScreen } from "@/features/purchasing";
import { PermissionGate } from "@/features/auth";
import { PERMISSIONS } from "@/constants/permissions";

export default function PurchasingRoute() {
  // A "Ready to buy" notification opens To buy on that order's delivery day.
  const params = useLocalSearchParams<{ tab?: string; order?: string }>();
  return (
    <PermissionGate permission={PERMISSIONS.viewFulfillment}>
      <PurchasingScreen openTab={params.tab === "buy" ? "buy" : undefined} focusOrderId={params.order || undefined} />
    </PermissionGate>
  );
}
