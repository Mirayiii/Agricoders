import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, EmptyState, ErrorState, LoadingState, ReviewCard, StaleNotice, StatCard } from "@/components";
import type { IconName } from "@/components/Icon";
import { colors, radii, spacing, text } from "@/constants/theme";
import { useAuth } from "@/features/auth";
import { ORDER_STATUS_META, isFlagged, type OrderFilter } from "@/features/orders/status";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import type { StatusTone } from "@/types/ui";
import { dayLabel, firstName, formatTime, greeting, longTodayLabel } from "@/utils/format";
import { customerName } from "@/utils/customer";
import { HomeHeader } from "../HomeHeader";
import { homeCounts, homeKindFor, type HomeDelivery, type HomeOrder, useHomeData } from "../homeData";

type Tile = { label: string; value: number; icon: IconName; tone: StatusTone; onPress: () => void };
type Item = {
  key: string; orderId: string; orderNumber: string; day: string; customer: string;
  status: HomeOrder["status"]; note: string; noteIcon: IconName; urgent: boolean;
};

const openOrders = (filter: OrderFilter) => router.navigate({ pathname: "/orders", params: { filter } });

/**
 * Home for every role (Figma Home Dashboard and Role Views). Administrators and
 * administrative staff get the office Home; purchasing and delivery staff get
 * their own focused version.
 */
export function DashboardScreen() {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const kind = homeKindFor(profile?.role);
  const home = useHomeData(kind);
  const unread = useUnreadNotifications();
  const [refreshing, setRefreshing] = useState(false);
  const { refetch } = home;

  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  async function refresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  const orders = home.data?.orders ?? [];
  const deliveries = home.data?.deliveries ?? [];
  const counts = homeCounts(orders, deliveries);
  const isAdmin = profile?.role === "administrator";
  const content = buildHome(kind, orders, deliveries, counts, isAdmin);
  const name = firstName(profile?.full_name) || profile?.username || "";

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
    >
      <HomeHeader unread={unread} />

      <View style={styles.greeting}>
        <View style={styles.greetingText}>
          <Text style={styles.date}>{longTodayLabel()}</Text>
          <Text style={styles.hello} accessibilityRole="header">{greeting()}{name ? `, ${name}` : ""}</Text>
          <Text style={styles.date}>{content.subtitle}</Text>
        </View>
        <Button label={content.action.label} icon={content.action.icon} size="lg" onPress={content.action.onPress} />
      </View>

      {/* Last loaded data stays on screen if a refresh fails, marked as not current. */}
      <StaleNotice query={home} />
      {home.isPending ? <LoadingState message="Loading your work..." /> : !home.data ? (
        <Card><ErrorState description="We couldn’t load your work. Pull down to try again." onRetry={() => void refetch()} /></Card>
      ) : (
        <>
          <View style={styles.stats}>
            {pairs(content.tiles).map((row) => (
              <View key={row[0].label} style={styles.row}>
                {row.map((tile) => <StatCard key={tile.label} {...tile} />)}
                {row.length === 1 ? <View style={styles.spacer} /> : null}
              </View>
            ))}
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{content.listTitle}</Text>
            {content.items.length ? content.items.map((item) => (
              <ReviewCard
                key={item.key}
                orderNumber={item.orderNumber}
                day={item.day}
                customer={item.customer}
                status={ORDER_STATUS_META[item.status]}
                note={item.note}
                noteIcon={item.noteIcon}
                noteTone={item.urgent ? "danger" : "neutral"}
                onPress={() => router.push({ pathname: "/orders/[id]", params: { id: item.orderId } })}
              />
            )) : (
              <Card><EmptyState icon="checkmark-circle-outline" tone="success" title="All caught up" description={content.emptyText} /></Card>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function buildHome(kind: ReturnType<typeof homeKindFor>, orders: HomeOrder[], deliveries: HomeDelivery[], counts: ReturnType<typeof homeCounts>, isAdmin: boolean) {
  const toItem = (order: HomeOrder, note: string, noteIcon: IconName, urgent = false): Item => ({
    key: order.id, orderId: order.id, orderNumber: order.order_number, day: dayLabel(order.requested_delivery_date),
    customer: customerName(order.customers) ?? "Customer", status: order.status, note, noteIcon, urgent,
  });

  if (kind === "purchasing") {
    const packing = orders.filter((order) => order.status === "for_preparation");
    const ready = orders.filter((order) => order.status === "confirmed");
    return {
      subtitle: "Pack confirmed orders and hand them off.",
      action: { label: "Open packing list", icon: "clipboard" as IconName, onPress: () => router.navigate("/purchasing") },
      tiles: [
        { label: "Ready to start", value: counts.readyToStart, icon: "play-circle", tone: "info", onPress: () => router.navigate("/purchasing") },
        { label: "Items left to pack", value: counts.itemsLeftToPack, icon: "package", tone: "success", onPress: () => router.navigate("/purchasing") },
      ] as Tile[],
      listTitle: "Your packing queue",
      emptyText: "Confirmed orders to pack will appear here.",
      items: [
        ...packing.map((order) => {
          const done = order.order_items.filter((item) => item.preparation_status === "completed").length;
          return toItem(order, `${done} of ${order.order_items.length} packed`, "package");
        }),
        ...ready.map((order) => toItem(order, "Ready to start packing", "play-circle")),
      ],
    };
  }

  if (kind === "delivery") {
    const stops = deliveries.filter((d) => d.status === "scheduled" || d.status === "for_delivery");
    return {
      subtitle: "Your deliveries, in order.",
      action: { label: "Start today’s route", icon: "navigation" as IconName, onPress: () => router.navigate("/deliveries") },
      tiles: [
        { label: "Stops left today", value: counts.stopsLeft, icon: "navigation", tone: "info", onPress: () => router.navigate("/deliveries") },
        { label: "Delivered", value: counts.deliveredToday, icon: "check-check", tone: "success", onPress: () => router.navigate("/deliveries") },
      ] as Tile[],
      listTitle: "Today’s stops",
      emptyText: "Deliveries assigned to you for today will appear here.",
      items: stops.flatMap((delivery): Item[] => {
        const order = delivery.orders;
        if (!order) return [];
        const time = formatTime(delivery.scheduled_time) || "Any time";
        return [{
          key: delivery.id, orderId: delivery.order_id, orderNumber: order.order_number, day: "Today",
          customer: customerName(order.customers) ?? "Customer", status: order.status,
          note: `${time} · ${order.customers?.delivery_address ?? "No address recorded"}`, noteIcon: "clock", urgent: false,
        }];
      }),
    };
  }

  // Administrators and administrative staff. Only administrators have the Purchasing tab.
  return {
    subtitle: "Here’s what needs you today.",
    action: { label: "New order", icon: "plus-circle" as IconName, onPress: () => router.push("/orders/new") },
    tiles: [
      { label: "To verify", value: counts.toVerify, icon: "shield-check", tone: "warning", onPress: () => openOrders("for_verification") },
      { label: "Confirmed", value: counts.confirmed, icon: "check-circle", tone: "success", onPress: () => openOrders("confirmed") },
      { label: "Being packed", value: counts.beingPacked, icon: "package", tone: "success", onPress: () => (isAdmin ? router.navigate("/purchasing") : openOrders("for_preparation")) },
      { label: "Deliveries today", value: counts.deliveriesToday, icon: "car", tone: "info", onPress: () => router.navigate("/deliveries") },
    ] as Tile[],
    listTitle: "Needs your review",
    emptyText: "Orders to verify and orders that need attention will appear here.",
    // Needs attention is shown beside the real status, never instead of it (D-UI2).
    items: orders
      .filter((order) => order.status === "for_verification" || isFlagged(order))
      .map((order) => (isFlagged(order)
        ? toItem(order, order.attention_reason ?? "Needs checking", "alert-circle", true)
        : toItem(order, "Check items and prices, then confirm.", "shield-check"))),
  };
}

function pairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  greeting: { gap: spacing.lg, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.xl },
  greetingText: { gap: 4 },
  date: { ...text.caption, color: colors.textSecondary },
  hello: { ...text.display, color: colors.text },
  stats: { gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.md },
  spacer: { flex: 1 },
  section: { gap: spacing.md },
  sectionTitle: { ...text.heading, color: colors.text },
});
