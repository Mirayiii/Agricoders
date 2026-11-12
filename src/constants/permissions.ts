import type { ProfileRole } from "@/types/auth";

export const PERMISSIONS = {
  viewDashboard: "viewDashboard",
  viewOrders: "viewOrders",
  viewOrderDetails: "viewOrderDetails",
  viewFulfillment: "viewFulfillment",
  viewDeliveries: "viewDeliveries",
  viewInventory: "viewInventory",
  manageUsers: "manageUsers",
  manageCustomers: "manageCustomers",
  archiveCustomers: "archiveCustomers",
  manageProducts: "manageProducts",
  managePricing: "managePricing",
  manageOrders: "manageOrders",
  manageFulfillment: "manageFulfillment",
  manageDeliveries: "manageDeliveries",
  manageInventory: "manageInventory",
  viewReports: "viewReports",
} as const;

// MEAH-Prototype 2.html (the logic reference since 5 Nov 2026): Products &
// stock is for the administrator, administrative staff and purchasing staff;
// prices and customer archive are for the administrator and administrative
// staff; Reports and User management stay with the administrator.
// The server checks the same rules.

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const rolePermissions: Record<ProfileRole, readonly Permission[]> = {
  administrator: Object.values(PERMISSIONS),
  administrative_staff: [
    PERMISSIONS.viewDashboard,
    PERMISSIONS.viewOrders,
    PERMISSIONS.viewOrderDetails,
    PERMISSIONS.viewDeliveries,
    PERMISSIONS.viewInventory,
    PERMISSIONS.manageCustomers,
    PERMISSIONS.archiveCustomers,
    PERMISSIONS.manageProducts,
    PERMISSIONS.managePricing,
    PERMISSIONS.manageOrders,
    PERMISSIONS.manageFulfillment,
    PERMISSIONS.manageDeliveries,
    PERMISSIONS.manageInventory,
  ],
  fulfillment_staff: [
    PERMISSIONS.viewDashboard,
    PERMISSIONS.viewOrderDetails,
    PERMISSIONS.viewFulfillment,
    PERMISSIONS.viewInventory,
    PERMISSIONS.manageFulfillment,
    PERMISSIONS.manageProducts,
    PERMISSIONS.manageInventory,
  ],
  delivery_staff: [PERMISSIONS.viewDashboard, PERMISSIONS.viewOrderDetails, PERMISSIONS.viewDeliveries, PERMISSIONS.manageDeliveries],
};

export function hasPermission(
  role: ProfileRole | null | undefined,
  permission: Permission,
): boolean {
  return Boolean(role && rolePermissions[role].includes(permission));
}
