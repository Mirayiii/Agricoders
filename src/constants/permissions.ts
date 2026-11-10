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

// Requirements SI-02, PS-01 to PS-03, RE-05 and CU-01: only the administrator
// manages products, prices and stock, sees Reports and archives customers.
// The server checks the same rules.

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const rolePermissions: Record<ProfileRole, readonly Permission[]> = {
  administrator: Object.values(PERMISSIONS),
  administrative_staff: [
    PERMISSIONS.viewDashboard,
    PERMISSIONS.viewOrders,
    PERMISSIONS.viewOrderDetails,
    PERMISSIONS.viewDeliveries,
    PERMISSIONS.manageCustomers,
    PERMISSIONS.manageOrders,
    PERMISSIONS.manageFulfillment,
    PERMISSIONS.manageDeliveries,
  ],
  fulfillment_staff: [PERMISSIONS.viewDashboard, PERMISSIONS.viewOrderDetails, PERMISSIONS.viewFulfillment, PERMISSIONS.manageFulfillment],
  delivery_staff: [PERMISSIONS.viewDashboard, PERMISSIONS.viewOrderDetails, PERMISSIONS.viewDeliveries, PERMISSIONS.manageDeliveries],
};

export function hasPermission(
  role: ProfileRole | null | undefined,
  permission: Permission,
): boolean {
  return Boolean(role && rolePermissions[role].includes(permission));
}
