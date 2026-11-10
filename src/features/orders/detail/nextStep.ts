import type { OrderStatus } from "@/types/orders";
import type { IconName } from "@/components";
import type { DeliveryStatus } from "@/features/deliveries/shared";

export type NextAction = "confirm" | "startPacking" | "openPacking" | "scheduleDelivery" | "markDelivered" | "orderAgain";

export type NextStep = { text: string; action?: { key: NextAction; label: string; icon: IconName } };

export type NextStepInput = {
  status: OrderStatus;
  flagged: boolean;
  packed: number;
  itemCount: number;
  delivery?: { status: DeliveryStatus; when: string; driver: string | null; receivedBy: string | null } | null;
  can: { manage: boolean; prepare: boolean; viewPurchasing: boolean; manageDeliveries: boolean; viewDeliveries: boolean; completeDelivery?: boolean };
};

/** The "Next step" box and footer button for each status (Figma DR-1048, 1047, 1046, 1045, 1043). */
export function nextStepFor({ status, flagged, packed, itemCount, delivery, can }: NextStepInput): NextStep {
  switch (status) {
    case "for_verification":
      return can.manage
        ? { text: flagged ? "Resolve the flag above, then confirm the order." : "Check items and prices with the customer, then confirm.", action: { key: "confirm", label: "Confirm order", icon: "check-circle" } }
        : { text: "Waiting for the office to verify this order." };
    case "confirmed":
      return can.prepare
        ? { text: "This order is confirmed and ready to pack.", action: { key: "startPacking", label: "Start packing", icon: "package" } }
        : { text: "This order is confirmed and waiting for the warehouse." };
    case "for_preparation": {
      const text = `Warehouse is packing — ${packed} of ${itemCount} packed.`;
      return can.viewPurchasing ? { text, action: { key: "openPacking", label: "Open packing checklist", icon: "clipboard" } } : { text };
    }
    case "for_delivery":
      if (!delivery) {
        return can.manageDeliveries
          ? { text: "Packed and ready. Schedule the delivery next.", action: { key: "scheduleDelivery", label: "Schedule delivery", icon: "calendar" } }
          : { text: "Packed and waiting for a delivery schedule." };
      }
      if (delivery.status === "cancelled") return { text: "The delivery for this order was cancelled. An administrator needs to arrange it again." };
      {
        // Requirement DE-04: a driver must be assigned before anyone completes the stop.
        if (!delivery.driver) return { text: `Scheduled ${delivery.when}. Assign a driver before it can be marked delivered.` };
        const text = `Out ${delivery.when} with ${delivery.driver}.`;
        return can.completeDelivery ? { text, action: { key: "markDelivered", label: "Mark delivered", icon: "check-check" } } : { text };
      }
    case "completed": {
      const text = `Delivered${delivery?.receivedBy ? ` · received by ${delivery.receivedBy}` : ""}. This order is locked.`;
      return can.manage ? { text, action: { key: "orderAgain", label: "Order again", icon: "repeat" } } : { text };
    }
    default:
      return { text: "This order was cancelled and is locked." };
  }
}

/** Who may change what on an order. The server checks the same rules. */
/**
 * What can still change on an order. SI# on a completed order: office staff
 * may add a missing one; replacing or clearing it needs an administrator and a
 * reason (the server enforces the same rule).
 */
export function orderEditing(status: OrderStatus, canManage: boolean, opts: { isAdministrator?: boolean; hasSalesInvoice?: boolean } = {}) {
  const closed = status === "completed" || status === "cancelled";
  const lockedInvoice = status === "completed" && Boolean(opts.hasSalesInvoice);
  return {
    closed,
    canEditItems: canManage && status === "for_verification",
    canChangeDiscount: canManage && !closed,
    canSetSalesInvoice: canManage && status !== "cancelled" && (!lockedInvoice || Boolean(opts.isAdministrator)),
    salesInvoiceNeedsReason: lockedInvoice,
  };
}
