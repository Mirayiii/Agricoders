import { useContext } from "react";

import { hasPermission, type Permission } from "@/constants/permissions";
import { AuthContext } from "./AuthProvider";

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider.");
  return context;
}

export function usePermission(permission: Permission): boolean {
  const { profile, isActive } = useAuth();
  return isActive && hasPermission(profile?.role, permission);
}
