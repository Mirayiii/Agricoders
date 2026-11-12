import type { ProfileRole } from "@/types/auth";

/**
 * Settings switches (MEAH-Prototype 2.html; Figma "Settings" 25:2115).
 * - Push notifications: one switch for all of this person's push alerts.
 * - Delivery reminders: the "Upcoming order" and "Upcoming delivery"
 *   reminders in Notifications. A driver's are only about their own stops.
 * - Low-stock alerts: when a product reaches its alert level.
 * Each role only sees the switches the prototype gives it. The server keeps
 * the same list (settings_switches_for_role) and refuses others.
 *
 * Push sending and low-stock alerts aren't built yet, so those switches show
 * "Not available yet", stay disabled and keep the saved choice (Jac, 5 Nov,
 * approved exception to Figma). The server refuses changes to them too
 * (setting_available).
 */
export type SettingKey = "push" | "delivery" | "stock";
export type SettingSwitch = { key: SettingKey; title: string; description: string; available: boolean };

/** Switches whose feature works today. Keep in step with setting_available() on the server. */
export const AVAILABLE_SETTINGS: readonly SettingKey[] = ["delivery"];

export const SETTINGS_BY_ROLE: Record<ProfileRole, readonly SettingKey[]> = {
  administrator: ["push", "delivery", "stock"],
  administrative_staff: ["push", "delivery"],
  fulfillment_staff: ["push", "stock"],
  delivery_staff: ["push", "delivery"],
};

const TEXT: Record<SettingKey, [string, string]> = {
  push: ["Push notifications", "Alerts on this phone"],
  delivery: ["Delivery reminders", "Day before and morning of"],
  stock: ["Low-stock alerts", "When stock reaches its alert level"],
};

/** The column each switch is saved in. */
export const SETTING_COLUMN = { push: "push_enabled", delivery: "delivery_reminders", stock: "low_stock_alerts" } as const;

export function notificationSettings(role: ProfileRole | null | undefined): SettingSwitch[] {
  if (!role) return [];
  return SETTINGS_BY_ROLE[role].map((key) => ({ key, title: TEXT[key][0], description: TEXT[key][1], available: AVAILABLE_SETTINGS.includes(key) }));
}
