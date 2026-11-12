import type { OrderStatus } from "@/types/orders";
import type { IconName } from "@/components";
import type { DeliveryStatus } from "@/features/deliveries/shared";

export type NextAction = "confirm" | "startPacking" | "openPacking" | "markDelivered" | "orderAgain";

export type NextStep = { text: string; action?: { key: NextAction; label: string; icon: IconName } };

export type NextStepInput = {
  status: OrderStatus;
  flagged: boolean;
  packed: number;
  itemCount: number;
  /** Packed items an edit removed that packing staff haven't confirmed as taken out yet. */
  removalsToConfirm?: number;
  delivery?: { status: DeliveryStatus; when: string; driver: string | null; receivedBy: string | null } | null;
  can: { manage: boolean; prepare: boolean; viewPurchasing: boolean; manageDeliveries: boolean; viewDeliveries: boolean; completeDelivery?: boolean };
};

/** The "Next step" box and footer button for each status (Figma DR-1048, 1047, 1046, 1045, 1043). */
export function nextStepFor({ status, flagged, packed, itemCount, removalsToConfirm = 0, delivery, can }: NextStepInput): NextStep {
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
      const removed = removalsToConfirm ? ` ${removalsToConfirm} removed ${removalsToConfirm === 1 ? "item needs" : "items need"} to be taken out.` : "";
      // Sent back to Packing by an edit: the booked delivery stays and goes ahead once packed.
      const repacking = delivery && (delivery.status === "scheduled" || delivery.status === "for_delivery");
      const text = repacking
        ? `Changed after packing — warehouse is repacking, ${packed} of ${itemCount} packed.${removed} The delivery ${delivery.when} stays booked.`
        : `Warehouse is packing — ${packed} of ${itemCount} packed.${removed}`;
      return can.viewPurchasing ? { text, action: { key: "openPacking", label: "Open packing checklist", icon: "clipboard" } } : { text };
    }
    case "for_delivery":
      // Prototype: a packed order goes straight to Deliveries; the server creates its delivery.
      if (!delivery) return { text: "Packed and ready for delivery." };
      if (delivery.status === "cancelled") return { text: "The delivery for this order was cancelled. An administrator needs to arrange it again." };
      {
        // Only the server's "Out for delivery" stop status means it has left; a driver assignment alone doesn't.
        const text = delivery.status === "for_delivery"
          ? `Out for delivery ${delivery.when}${delivery.driver ? ` with ${delivery.driver}` : ""}.`
          : `Packed. Delivery ${delivery.when}${delivery.driver ? ` with ${delivery.driver}` : ""}.`;
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
    // Prototype: orders can be edited at any open status. Changed lines go back to Packing (server rules).
    canEditItems: canManage && !closed,
    canChangeDiscount: canManage && !closed,
    canSetSalesInvoice: canManage && status !== "cancelled" && (!lockedInvoice || Boolean(opts.isAdministrator)),
    salesInvoiceNeedsReason: lockedInvoice,
  };
}
