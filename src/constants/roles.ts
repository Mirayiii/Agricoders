import type { ProfileRole } from "@/types/auth";

export const ROLE_META: Record<ProfileRole, { label: string; short: string; description: string }> = {
  administrator: { label: "Administrator", short: "Admin", description: "Full access, including reports and staff accounts" },
  administrative_staff: { label: "Administrative staff", short: "Admin Staff", description: "Orders, customers, and delivery scheduling" },
  // D-R1: shown as Purchasing staff; the database value stays fulfillment_staff.
  fulfillment_staff: { label: "Purchasing staff", short: "Purchasing", description: "Consolidated buy list and packing" },
  delivery_staff: { label: "Delivery staff", short: "Delivery", description: "Assigned delivery routes and drop-off completion" },
};
