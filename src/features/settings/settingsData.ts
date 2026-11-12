import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/features/auth";
import { unwrap, useAppMutation } from "@/services/data";
import { supabase } from "@/services/supabase";

import type { SettingKey } from "./settingsLogic";

export type NotificationPreferences = { push_enabled: boolean; delivery_reminders: boolean; low_stock_alerts: boolean };
const DEFAULTS: NotificationPreferences = { push_enabled: true, delivery_reminders: true, low_stock_alerts: true };

export const notificationPreferencesKey = ["settings", "notification-preferences"] as const;

/** No saved row means the defaults: everything on. */
export function useNotificationPreferences() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: [...notificationPreferencesKey, profile?.id ?? null],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const rows = await unwrap<NotificationPreferences[]>(
        supabase.from("notification_preferences").select("push_enabled,delivery_reminders,low_stock_alerts").eq("user_id", profile?.id ?? "").limit(1).returns<NotificationPreferences[]>(),
      );
      return { ...DEFAULTS, ...rows[0] };
    },
  });
}

/** One Settings switch. The server refuses a switch the role doesn't have. */
export function useSetSetting() {
  return useAppMutation(
    ({ key, on }: { key: SettingKey; on: boolean }) => unwrap<NotificationPreferences>(supabase.rpc("set_my_setting", { p_key: key, p_on: on })),
    [notificationPreferencesKey],
  );
}
