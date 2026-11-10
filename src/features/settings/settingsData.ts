import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/features/auth";
import { unwrap, useAppMutation } from "@/services/data";
import { supabase } from "@/services/supabase";

import type { PushCategory } from "./settingsLogic";

export type NotificationPreferences = { delivery_reminders: boolean; push_new_orders: boolean; push_flagged_orders: boolean; push_delivery_reminders: boolean; push_ready_to_buy: boolean };
const DEFAULTS: NotificationPreferences = { delivery_reminders: true, push_new_orders: true, push_flagged_orders: true, push_delivery_reminders: true, push_ready_to_buy: true };

export const notificationPreferencesKey = ["settings", "notification-preferences"] as const;

/** No saved row means the defaults: everything on. */
export function useNotificationPreferences() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: [...notificationPreferencesKey, profile?.id ?? null],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const rows = await unwrap<NotificationPreferences[]>(
        supabase.from("notification_preferences").select("delivery_reminders,push_new_orders,push_flagged_orders,push_delivery_reminders,push_ready_to_buy").eq("user_id", profile?.id ?? "").limit(1).returns<NotificationPreferences[]>(),
      );
      return { ...DEFAULTS, ...rows[0] };
    },
  });
}

export function useSetDeliveryReminders() {
  return useAppMutation(
    (on: boolean) => unwrap<NotificationPreferences>(supabase.rpc("set_my_notification_preferences", { p_delivery_reminders: on })),
    [notificationPreferencesKey],
  );
}

/** AS-03: one push switch. The server refuses a category the role does not receive. */
export function useSetPushPreference() {
  return useAppMutation(
    ({ category, on }: { category: PushCategory; on: boolean }) => unwrap(supabase.rpc("set_my_push_preference", { p_category: category, p_on: on })),
    [notificationPreferencesKey],
  );
}
