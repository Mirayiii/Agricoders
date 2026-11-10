import type { Href } from "expo-router";

import type { Ionicons } from "@expo/vector-icons";
import type { ProfileRole } from "@/types/auth";

export type MoreItem = { key: string; title: string; description: string; icon: keyof typeof Ionicons.glyphMap; route: Href };

const ITEMS = {
  users: { key: "users", title: "User management", description: "Staff accounts and roles", icon: "shield-outline", route: "/users" },
  customers: { key: "customers", title: "Customers", description: "Business accounts and contacts", icon: "people-outline", route: "/customers" },
  products: { key: "products", title: "Products & stock", description: "Prices, stock levels, SKUs and units", icon: "leaf-outline", route: "/products" },
  reports: { key: "reports", title: "Reports", description: "Sales, costs, margins and volume", icon: "bar-chart-outline", route: "/reports" },
  notifications: { key: "notifications", title: "Notifications", description: "Alerts and reminders", icon: "notifications-outline", route: "/notifications" },
  settings: { key: "settings", title: "Settings", description: "Account and app preferences", icon: "settings-outline", route: "/settings" },
} satisfies Record<string, MoreItem>;

/**
 * The More menu for each role, as in requirement SI-02: administrative staff
 * get Customers, Notifications and Settings; Products & stock is for the
 * administrator only. Batch update prices opens from Products & stock.
 */
const MENUS: Record<ProfileRole, MoreItem[]> = {
  administrator: [ITEMS.users, ITEMS.customers, ITEMS.products, ITEMS.reports, ITEMS.notifications, ITEMS.settings],
  administrative_staff: [ITEMS.customers, ITEMS.notifications, ITEMS.settings],
  fulfillment_staff: [ITEMS.notifications, ITEMS.settings],
  delivery_staff: [ITEMS.notifications, ITEMS.settings],
};

export function moreMenu(role: ProfileRole | null | undefined): MoreItem[] {
  return role ? MENUS[role] : [ITEMS.notifications, ITEMS.settings];
}

/** Role descriptions on the Switch role (preview) sheet, from Figma. */
export const PREVIEW_ROLE_TEXT: Record<ProfileRole, string> = {
  administrator: "Full access to orders, purchasing, deliveries, reports, pricing & staff",
  administrative_staff: "Manage orders, customer accounts & delivery updates",
  fulfillment_staff: "View the buy list, packing list & purchase requirements",
  delivery_staff: "View assigned delivery routes, stops & log completed drop-offs",
};
