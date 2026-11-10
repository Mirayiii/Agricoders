import { useQuery } from "@tanstack/react-query";

import type { IconName } from "@/components/Icon";
import { unreadNotificationsKey } from "@/hooks/useUnreadNotifications";
import { unwrap, useAppMutation } from "@/services/data";
import { supabase } from "@/services/supabase";
import type { StatusTone } from "@/types/ui";

export type AppNotification = { id: string; type: string; title: string; message: string; is_read: boolean; created_at: string; related_order_id: string | null };

export const notificationsKey = ["notifications", "list"] as const;

/** Icon and colour per notification type, as in the Figma Notifications screen. */
export const NOTIFICATION_STYLE: Record<string, { icon: IconName; tone: StatusTone }> = {
  order_attention: { icon: "alert-circle", tone: "danger" },
  order_requires_verification: { icon: "shield-check", tone: "warning" },
  order_for_verification: { icon: "shield-check", tone: "warning" },
  upcoming_delivery: { icon: "car", tone: "info" },
  upcoming_order: { icon: "calendar", tone: "success" },
  order_delivered: { icon: "check-circle", tone: "success" },
  ready_to_buy: { icon: "cart", tone: "info" },
  low_stock: { icon: "package", tone: "warning" },
  out_of_stock: { icon: "package", tone: "danger" },
};
export const DEFAULT_NOTIFICATION_STYLE = { icon: "bell" as IconName, tone: "neutral" as StatusTone };

export function useNotifications() {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: async () => {
      // Upcoming reminders are generated on demand, so they appear the first time the list opens each day.
      await supabase.rpc("generate_upcoming_notifications");
      return unwrap<AppNotification[]>(
        supabase.from("notifications").select("id,type,title,message,is_read,created_at,related_order_id")
          .order("created_at", { ascending: false }).limit(50).returns<AppNotification[]>(),
      );
    },
  });
}

async function markRead(input: { userId: string; ids?: string[] }) {
  let request = supabase.from("notifications").update({ is_read: true }).eq("user_id", input.userId).eq("is_read", false);
  if (input.ids) request = request.in("id", input.ids);
  const { error } = await request;
  if (error) throw new Error(error.message);
}

/** Marks one, several or all notifications read, then refreshes the list and every bell. */
export function useMarkNotificationsRead() {
  return useAppMutation(markRead, [notificationsKey, unreadNotificationsKey]);
}
