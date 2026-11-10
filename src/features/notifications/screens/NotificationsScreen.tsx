import { router } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, EmptyState, ErrorState, Icon, LoadingState, NotificationItem, SegmentedControl, StaleNotice, useToast } from "@/components";
import { colors, radii, spacing, text } from "@/constants/theme";
import { useAuth } from "@/features/auth";
import { daysFromToday, relativeTime, toISODate } from "@/utils/format";
import { type AppNotification, DEFAULT_NOTIFICATION_STYLE, NOTIFICATION_STYLE, useMarkNotificationsRead, useNotifications } from "../notificationsData";

/** Figma "Notifications": Today and Earlier groups, All / Unread, and Mark all as read. */
export function NotificationsScreen() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const list = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [refreshing, setRefreshing] = useState(false);

  const items = list.data ?? [];
  const unread = items.filter((item) => !item.is_read).length;
  const visible = tab === "unread" ? items.filter((item) => !item.is_read) : items;
  const isToday = (item: AppNotification) => daysFromToday(toISODate(new Date(item.created_at))) === 0;
  const groups = [
    { title: "Today", rows: visible.filter(isToday) },
    { title: "Earlier", rows: visible.filter((item) => !isToday(item)) },
  ].filter((group) => group.rows.length);

  function open(item: AppNotification) {
    if (!item.is_read && profile) markRead.mutate({ userId: profile.id, ids: [item.id] });
    // AS-02: "Ready to buy" opens To buy on that order's delivery day.
    if (item.type === "ready_to_buy") router.push({ pathname: "/purchasing", params: { tab: "buy", order: item.related_order_id ?? "" } });
    else if (item.related_order_id) router.push({ pathname: "/orders/[id]", params: { id: item.related_order_id } });
  }

  function markAll() {
    if (!profile) return;
    markRead.mutate({ userId: profile.id }, {
      onSuccess: () => toast({ title: "All caught up", message: "Every notification is marked as read." }),
      onError: () => toast({ title: "Not marked as read", message: "Check your connection and try again.", tone: "error" }),
    });
  }

  async function refresh() {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  }

  return (
    <View style={styles.page}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={4} style={styles.back}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Notifications</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <SegmentedControl options={[{ key: "all", label: "All" }, { key: "unread", label: `Unread · ${unread}` }]} value={tab} onChange={setTab} />
        <StaleNotice query={list} />
        {list.isPending ? <LoadingState message="Loading notifications..." /> : !list.data ? (
          <Card><ErrorState description="Unable to load notifications." onRetry={() => void list.refetch()} /></Card>
        ) : groups.length ? groups.map((group, index) => (
          <View key={group.title} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>{group.title}</Text>
              {index === 0 && unread ? (
                <Pressable accessibilityRole="button" onPress={markAll} disabled={markRead.isPending} hitSlop={10} style={styles.markAll}>
                  <Icon name="check-check" size={14} color={colors.primary} />
                  <Text style={styles.markAllText}>Mark all as read</Text>
                </Pressable>
              ) : null}
            </View>
            {group.rows.map((item) => {
              const style = NOTIFICATION_STYLE[item.type] ?? DEFAULT_NOTIFICATION_STYLE;
              return (
                <NotificationItem
                  key={item.id}
                  title={item.title}
                  body={item.message}
                  time={relativeTime(item.created_at)}
                  unread={!item.is_read}
                  icon={style.icon}
                  tone={style.tone}
                  onPress={() => open(item)}
                />
              );
            })}
          </View>
        )) : (
          <Card>
            <EmptyState
              icon="notifications-outline"
              title={tab === "unread" ? "No unread notifications" : "You’re all caught up"}
              description="Verification, attention and delivery alerts appear here."
            />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.lg, paddingBottom: 4 },
  back: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { ...text.title, color: colors.text, flex: 1 },
  spacer: { width: 40 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  group: { gap: spacing.md },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 },
  groupTitle: { ...text.captionStrong, color: colors.textSecondary },
  markAll: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 24 },
  markAllText: { ...text.captionStrong, color: colors.primary },
});
