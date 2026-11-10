import type { IconName } from "@/constants/icons";
import { hasPermission, PERMISSIONS } from "@/constants/permissions";
import type { ProfileRole } from "@/types/auth";

export type MainTabKey =
  | "index"
  | "orders"
  | "purchasing"
  | "deliveries"
  | "more";

export type MainTabConfig = {
  key: MainTabKey;
  label: string;
  /** Figma tab icon. Active and inactive use the same icon in a different colour. */
  icon: IconName;
  permission: keyof typeof PERMISSIONS;
};

export const MAIN_TABS: MainTabConfig[] = [
  {
    key: "index",
    label: "Home",
    icon: "grid",
    permission: "viewDashboard",
  },
  {
    key: "orders",
    label: "Orders",
    icon: "cart",
    permission: "viewOrders",
  },
  {
    // Figma renames Fulfillment to Purchasing. The permission and the database
    // role value (fulfillment_staff) keep their names (D-R1: label only).
    key: "purchasing",
    label: "Purchasing",
    icon: "package",
    permission: "viewFulfillment",
  },
  {
    key: "deliveries",
    label: "Deliveries",
    icon: "car",
    permission: "viewDeliveries",
  },
  {
    key: "more",
    label: "More",
    icon: "more",
    permission: "viewDashboard",
  },
];

export function isTabVisible(tab: MainTabConfig, role: ProfileRole | null): boolean {
  return hasPermission(role, PERMISSIONS[tab.permission]);
}
