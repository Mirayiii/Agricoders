import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { ProductsScreen } from "@/features/products";

export default function ArchivedProductsRoute() {
  return <PermissionGate permission={PERMISSIONS.viewInventory}><ProductsScreen archivedOnly /></PermissionGate>;
}
