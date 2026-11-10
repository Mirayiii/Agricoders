import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

import { useAuth } from "@/features/auth/useAuth";
import { unwrapCount } from "@/services/data";
import { supabase } from "@/services/supabase";

export const unreadNotificationsKey = ["notifications", "unread"] as const;

/** Unread notifications for the signed-in user. Shared by the bell on every header. */
export function useUnreadNotifications() {
  const { profile } = useAuth();
  const userId = profile?.id;
  const query = useQuery({
    queryKey: unreadNotificationsKey,
    enabled: Boolean(userId),
    queryFn: () => unwrapCount(
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId!).eq("is_read", false),
    ),
  });
  const { refetch } = query;
  // Re-check whenever a screen with a bell comes into view.
  useFocusEffect(useCallback(() => { if (userId) void refetch(); }, [refetch, userId]));
  return query.data ?? 0;
}
