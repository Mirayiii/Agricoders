import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { BatchPriceScreen } from "@/features/products/screens/BatchPriceScreen";

/** Daily price batch update (administrators and administrative staff). */
export default function PricingRoute() {
  return <PermissionGate permission={PERMISSIONS.managePricing}><BatchPriceScreen /></PermissionGate>;
}
