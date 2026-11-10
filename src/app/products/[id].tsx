import { useLocalSearchParams } from "expo-router";

import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { ProductDetailScreen, isProductTab } from "@/features/products/screens/ProductDetailScreen";

export default function ProductDetailRoute() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  return <PermissionGate permission={PERMISSIONS.viewInventory}><ProductDetailScreen productId={id} initialTab={isProductTab(tab) ? tab : "details"} /></PermissionGate>;
}
