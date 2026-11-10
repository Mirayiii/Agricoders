import { isFlagged } from "@/features/orders/status";
import type { ProfileRole } from "@/types/auth";
import type { OrderStatus } from "@/types/orders";

export type HomeOrder = {
  id: string;
  order_number: string;
  status: OrderStatus;
  requested_delivery_date: string;
  requires_attention: boolean;
  attention_reason: string | null;
  customers: { business_name: string; brand_name?: string | null } | null;
  order_items: { id: string; preparation_status: string }[];
};

export type HomeDelivery = {
  id: string;
  order_id: string;
  scheduled_time: string | null;
  status: string;
  orders: { order_number: string; status: OrderStatus; customers: { business_name: string; brand_name?: string | null; delivery_address: string | null } | null } | null;
};

/** Which Home a role gets (Role Views in Figma). Administrative staff share the admin Home. */
export type HomeKind = "office" | "purchasing" | "delivery";

export function homeKindFor(role: ProfileRole | undefined): HomeKind {
  if (role === "fulfillment_staff") return "purchasing";
  if (role === "delivery_staff") return "delivery";
  return "office";
}

/** The counts on each Home, computed from the same rows the lists show so they always agree. */
export function homeCounts(orders: HomeOrder[], deliveries: HomeDelivery[]) {
  const byStatus = (status: OrderStatus) => orders.filter((order) => order.status === status);
  const packing = byStatus("for_preparation");
  return {
    toVerify: byStatus("for_verification").length,
    confirmed: byStatus("confirmed").length,
    beingPacked: packing.length,
    flagged: orders.filter(isFlagged).length,
    readyToStart: byStatus("confirmed").length,
    itemsLeftToPack: packing.reduce((sum, order) => sum + order.order_items.filter((item) => item.preparation_status !== "completed").length, 0),
    stopsLeft: deliveries.filter((d) => d.status === "scheduled" || d.status === "for_delivery").length,
    deliveredToday: deliveries.filter((d) => d.status === "completed").length,
    deliveriesToday: deliveries.filter((d) => d.status !== "cancelled").length,
  };
}
