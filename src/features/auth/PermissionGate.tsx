import type { ReactNode } from "react";

import { Card, ErrorState, Screen } from "@/components";
import type { Permission } from "@/constants/permissions";
import { usePermission } from "./useAuth";

export function PermissionGate({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const allowed = usePermission(permission);
  if (allowed) return <>{children}</>;

  return (
    <Screen title="MEAH Trading">
      <Card>
        <ErrorState
          title="Access restricted"
          description="Your account does not have permission to open this area."
        />
      </Card>
    </Screen>
  );
}
