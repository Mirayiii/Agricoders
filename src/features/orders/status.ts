import type { OrderSource, OrderStatus } from "@/types/orders";
import type { StatusTone } from "@/types/ui";
import { formatMoney, titleCase } from "@/utils/format";

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: StatusTone }> = {
  for_verification: { label: "For verification", tone: "pending" },
  confirmed: { label: "Confirmed", tone: "info" },
  for_preparation: { label: "Preparing", tone: "info" },
  for_delivery: { label: "For delivery", tone: "success" },
  completed: { label: "Completed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const SOURCE_LABELS: Record<OrderSource, string> = {
  viber: "Viber",
  messenger: "Messenger",
  phone: "Phone",
  purchase_order: "Purchase order",
  other: "Other",
};

export const ORDER_FLOW: OrderStatus[] = ["for_verification", "confirmed", "for_preparation", "for_delivery", "completed"];
export const ORDER_FLOW_LABELS = ["Verify", "Confirm", "Pack", "Deliver", "Done"];

export type OrderFilter = "all" | OrderStatus;

export const ORDER_FILTERS: { key: OrderFilter; label: string }[] = [
  // Prototype chips. "To verify" is hidden while no order needs verifying.
  { key: "all", label: "All" },
  { key: "for_verification", label: "To verify" },
  { key: "confirmed", label: "Confirmed" },
  { key: "for_preparation", label: "Preparing" },
  { key: "for_delivery", label: "For delivery" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export function isOrderFilter(value: unknown): value is OrderFilter {
  return typeof value === "string" && ORDER_FILTERS.some((filter) => filter.key === value);
}

// "Flagged" means an open order someone marked as needing a check; closed
// orders keep their historical flag but no longer need action.
export function isFlagged(order: { requires_attention: boolean; status: OrderStatus }) {
  return order.requires_attention && order.status !== "completed" && order.status !== "cancelled";
}

const STATUS_ACTIVITY: Partial<Record<OrderStatus, string>> = {
  confirmed: "Confirmed",
  for_preparation: "Packing started",
  for_delivery: "Ready for delivery",
  completed: "Delivered",
  cancelled: "Cancelled",
};

export function describeActivity(action: string, details: Record<string, unknown>, source?: OrderSource) {
  const toStatus = typeof details.to_status === "string" ? details.to_status : undefined;
  const reason = typeof details.reason === "string" ? details.reason : undefined;
  switch (action) {
    case "created":
      return source ? `Created from ${SOURCE_LABELS[source]}` : "Order created";
    case "created_by_duplication":
      return "Copied from a previous order";
    case "status_changed":
      if (reason === "repack_required") return "Sent back to Packing after a change";
      return (toStatus && STATUS_ACTIVITY[toStatus as OrderStatus]) ?? "Status updated";
    case "cancelled":
      return (toStatus && STATUS_ACTIVITY[toStatus as OrderStatus]) ?? "Status updated";
    case "requires_attention":
      return reason ? `Flagged: ${reason}` : "Flagged for checking";
    case "attention_cleared":
      return "Flag resolved";
    case "preparation_status_changed":
      return toStatus === "completed" ? "Item packed" : "Item packing started";
    case "preparation_notes_updated":
      return "Packing note updated";
    case "discount_applied": {
      const amount = Number(details.amount);
      const label = Number.isFinite(amount) ? `Discount of ${formatMoney(amount)} applied` : "Discount applied";
      return reason ? `${label} · ${reason}` : label;
    }
    case "discount_removed":
      return typeof details.reason === "string" && details.reason ? `Discount removed: ${details.reason}` : "Discount removed";
    case "sales_invoice_set": {
      const to = typeof details.to === "string" ? details.to : "";
      const from = typeof details.from === "string" ? details.from : "";
      const why = typeof details.reason === "string" && details.reason ? ` (${details.reason})` : "";
      if (!to) return `SI# ${from ? `${from} ` : ""}removed${why}`;
      return from && from !== to ? `SI# changed from ${from} to ${to}${why}` : `SI# set to ${to}${why}`;
    }
    case "order_edited": {
      const count = (key: string) => (Array.isArray(details[key]) ? (details[key] as unknown[]).length : 0);
      const parts = [
        count("changed_lines") ? `${count("changed_lines")} changed` : "",
        count("added_lines") ? `${count("added_lines")} added` : "",
        count("removed_lines") ? `${count("removed_lines")} removed` : "",
      ].filter(Boolean);
      const items = parts.length ? ` · items ${parts.join(", ")}` : "";
      return `Order edited${items}${details.repack_required ? " · repack needed" : ""}`;
    }
    case "removed_item_confirmed": {
      const what = typeof details.description === "string" ? details.description : "Removed item";
      return `${what} confirmed taken out of the packed order`;
    }
    case "delivery_created":
      return "Delivery scheduled";
    case "delivery_rescheduled":
      return "Delivery rescheduled";
    case "delivery_status_changed":
      return toStatus === "completed" ? "Delivery completed" : toStatus === "for_delivery" ? "Out for delivery" : toStatus === "cancelled" ? "Delivery cancelled" : "Delivery updated";
    default:
      return titleCase(action);
  }
}
