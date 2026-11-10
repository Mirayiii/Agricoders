import { useLocalSearchParams } from "expo-router";

import { PERMISSIONS } from "@/constants/permissions";
import { PermissionGate } from "@/features/auth";
import { CustomerDetailScreen } from "@/features/customers/screens/CustomerDetailScreen";

export default function CustomerDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PermissionGate permission={PERMISSIONS.manageCustomers}><CustomerDetailScreen customerId={id} /></PermissionGate>;
}
