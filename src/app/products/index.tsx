import { useLocalSearchParams } from "expo-router";

import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { ProductsScreen } from "@/features/products";

export default function ProductsRoute() {
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  return <PermissionGate permission={PERMISSIONS.viewInventory}><ProductsScreen initialFilter={filter === "stocked" || filter === "low" || filter === "out" ? filter : "all"} /></PermissionGate>;
}
