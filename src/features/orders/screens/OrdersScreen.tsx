import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Card, Chip, EmptyState, ErrorState, Icon, LoadingState, SearchBar, StaleNotice } from "@/components";
import { QueuedNotice } from "@/features/sync/QueuedNotice";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, radii, shadows, spacing } from "@/constants/theme";
import { usePermission } from "@/features/auth";
import { customerName } from "@/utils/customer";
import { OrderCard } from "../components/OrderCard";
import { itemCount, orderSearchText, type OrderListRow, useOrdersList } from "../ordersData";
import { ORDER_FILTERS, isFlagged, isOrderFilter, type OrderFilter } from "../status";

function matches(order: OrderListRow, filter: OrderFilter) {
  if (filter === "all") return true;
  if (filter === "flagged") return isFlagged(order);
  return order.status === filter;
}

/** Figma "Orders": search, status chips with counts, Order Cards, and the + button. */
export function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const canCreate = usePermission(PERMISSIONS.manageOrders);
  const params = useLocalSearchParams<{ filter?: string }>();
  const filter: OrderFilter = isOrderFilter(params.filter) ? params.filter : "all";
  const list = useOrdersList();
  const { refetch } = list;
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  async function refresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  const searched = useMemo(() => {
    const orders = list.data ?? [];
    const term = query.trim().toLowerCase();
    return term ? orders.filter((order) => orderSearchText(order).includes(term)) : orders;
  }, [list.data, query]);
  const visible = searched.filter((order) => matches(order, filter));

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <View style={styles.filters}>
          <SearchBar tone="muted" value={query} onChangeText={setQuery} placeholder="Search order, DR# or customer" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {ORDER_FILTERS.map((item) => (
              <Chip
                key={item.key}
                variant="status"
                label={item.label}
                count={searched.filter((order) => matches(order, item.key)).length}
                selected={filter === item.key}
                onPress={() => router.setParams({ filter: item.key })}
              />
            ))}
          </ScrollView>
        </View>
        <StaleNotice query={list} />
        <QueuedNotice rpc="offline_create_order" noun={["new order", "new orders"]} />
        {list.isPending ? <LoadingState message="Loading orders..." /> : !list.data ? (
          <Card><ErrorState description="We couldn’t load orders. Pull down to try again." onRetry={() => void refetch()} /></Card>
        ) : visible.length ? visible.map((order) => (
          <OrderCard
            key={order.id}
            order={{
              order_number: order.order_number,
              customer: customerName(order.customers) ?? "Customer",
              status: order.status,
              requested_delivery_date: order.requested_delivery_date,
              item_count: itemCount(order),
              total: Number(order.order_total),
              requires_attention: order.requires_attention,
              attention_reason: order.attention_reason,
            }}
            onPress={() => router.push({ pathname: "/orders/[id]", params: { id: order.id } })}
          />
        )) : (
          <Card style={styles.empty}>
            <EmptyState icon="search-outline" title="No orders match" description={query.trim() ? "Try another search or filter." : "Try another filter."} />
          </Card>
        )}
      </ScrollView>
      {canCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New order"
          onPress={() => router.push("/orders/new")}
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        >
          <Icon name="plus" size={26} color={colors.onBrand} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 112, gap: spacing.md },
  filters: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chips: { gap: spacing.sm },
  empty: { paddingVertical: spacing.xxl },
  fab: { position: "absolute", right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, ...shadows.raised },
  fabPressed: { backgroundColor: colors.primaryPressed },
});
