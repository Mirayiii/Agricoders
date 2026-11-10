import type { ProfileRole } from "@/types/auth";

/**
 * Notification preferences on Settings (requirement AS-03, Jac 4 Nov).
 * - Delivery reminders (in the app) turn the "Upcoming order" and "Upcoming
 *   delivery" reminders in Notifications on or off. Independent of push.
 * - Push switches use the app's existing notification events, and each role
 *   only gets switches for events it already receives (AS-02). A driver's
 *   delivery reminders are only ever about their own stops. Choices are saved
 *   per person now; phones start getting pushes once push is set up (D-A1).
 * The server keeps the same list (push_categories_for_role) and refuses others.
 */
export type PushCategory = "new_orders" | "flagged_orders" | "delivery_reminders" | "ready_to_buy";
export type NotificationSetting =
  | { key: "delivery_reminders"; kind: "in_app"; title: string; description: string }
  | { key: `push_${PushCategory}`; kind: "push"; category: PushCategory; title: string; description: string };

export const PUSH_CATEGORIES_BY_ROLE: Record<ProfileRole, readonly PushCategory[]> = {
  administrator: ["new_orders", "flagged_orders", "delivery_reminders"],
  administrative_staff: ["new_orders", "flagged_orders", "delivery_reminders"],
  fulfillment_staff: ["ready_to_buy"],
  delivery_staff: ["delivery_reminders"],
};

const REMINDER_ROLES: readonly ProfileRole[] = ["administrator", "administrative_staff", "delivery_staff"];

function pushRow(category: PushCategory, role: ProfileRole): NotificationSetting {
  const text: Record<PushCategory, [string, string]> = {
    new_orders: ["Push: new orders to verify", "When an order is saved and waits for verification"],
    flagged_orders: ["Push: flagged orders", "When an order is flagged as needing attention"],
    delivery_reminders: [
      "Push: delivery reminders",
      role === "delivery_staff" ? "The day before and on the day of your own stops" : "The day before and on the day of each order and delivery",
    ],
    ready_to_buy: ["Push: ready to buy", "When an order is confirmed and added to To buy"],
  };
  return { key: `push_${category}`, kind: "push", category, title: text[category][0], description: text[category][1] };
}

export function notificationSettings(role: ProfileRole | null | undefined): NotificationSetting[] {
  if (!role) return [];
  const rows: NotificationSetting[] = [];
  if (REMINDER_ROLES.includes(role)) {
    rows.push({
      key: "delivery_reminders",
      kind: "in_app",
      title: "Delivery reminders in the app",
      description: role === "delivery_staff" ? "In Notifications, the day before and on the day of your deliveries" : "In Notifications, the day before and on the day of each order and delivery",
    });
  }
  return [...rows, ...PUSH_CATEGORIES_BY_ROLE[role].map((category) => pushRow(category, role))];
}

/** The role-to-switch list, as shown in the PR description. */
export function pushSwitchTitles(role: ProfileRole): string[] {
  return PUSH_CATEGORIES_BY_ROLE[role].map((category) => pushRow(category, role).title);
}
