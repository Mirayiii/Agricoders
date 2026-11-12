import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Card, Chip, EmptyState, ErrorState, Icon, LoadingState, Pagination, SearchBar, StaleNotice } from "@/components";
import { PAGE_SIZE, pageSlice } from "@/utils/pagination";
import { usePage } from "@/utils/usePage";
import { QueuedNotice } from "@/features/sync/QueuedNotice";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, radii, shadows, spacing } from "@/constants/theme";
import { usePermission } from "@/features/auth";
import { customerName } from "@/utils/customer";
import { OrderCard } from "../components/OrderCard";
import { itemCount, orderSearchText, type OrderListRow, useOrdersList } from "../ordersData";
import { ORDER_FILTERS, isOrderFilter, type OrderFilter } from "../status";

function matches(order: OrderListRow, filter: OrderFilter) {
  if (filter === "all") return true;
  return order.status === filter;
}

/** Figma "Orders": search, status chips with counts, Order Cards, and the + button. */
export function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const canCreate = usePermission(PERMISSIONS.manageOrders);
  const params = useLocalSearchParams<{ filter?: string }>();
  const asked: OrderFilter = isOrderFilter(params.filter) ? params.filter : "all";
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
  // Prototype: the To verify chip only shows while an order needs verifying.
  const toVerify = (list.data ?? []).filter((order) => order.status === "for_verification").length;
  const filter: OrderFilter = asked === "for_verification" && toVerify === 0 && list.data ? "all" : asked;
  const chips = ORDER_FILTERS.filter((item) => item.key !== "for_verification" || toVerify > 0);
  const visible = searched.filter((order) => matches(order, filter));
  // Prototype: 15 orders per page; a new search or filter starts at page 1.
  const [page, setPage] = usePage(`${query.trim()}|${filter}`);
  const scroller = useRef<ScrollViewInstance>(null);
  const goTo = (next: number) => { setPage(next); scroller.current?.scrollTo({ y: 0, animated: false }); };

  return (
    <View style={styles.page}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <View style={styles.filters}>
          <SearchBar tone="muted" value={query} onChangeText={setQuery} placeholder="Search order, SI#, DR# or customer" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {chips.map((item) => (
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
        ) : visible.length ? pageSlice(visible, page, PAGE_SIZE).map((order) => (
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
              sales_invoice_number: order.sales_invoice_number,
            }}
            onPress={() => router.push({ pathname: "/orders/[id]", params: { id: order.id } })}
          />
        )).concat(<Pagination key="pages" page={page} total={visible.length} pageSize={PAGE_SIZE} onChange={goTo} label="orders" />) : (
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
