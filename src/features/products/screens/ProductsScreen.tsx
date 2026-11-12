import { useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { PAGE_SIZE, pageSlice } from "@/utils/pagination";
import { usePage } from "@/utils/usePage";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, EmptyState, ErrorState, Icon, IconButton, LoadingState, Pagination, Screen, SearchBar, SegmentedControl, StaleNotice, StockCard, useToast } from "@/components";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, shadows, spacing } from "@/constants/theme";
import { usePermission } from "@/features/auth";
import { OfflineReadOnly } from "@/features/sync/OfflineReadOnly";
import { useIsOnline } from "@/services/offline";
import { formatMoney } from "@/utils/format";
import { ProductFormSheet } from "../ProductFormSheet";
import { problemText, useProductsOverview, useSetProductArchived } from "../productsData";
import {
  STOCK_META, STOCK_UNAVAILABLE, filterProducts, formatQty, marginLabel, productDetailLine, stockLevel, stockUnknown,
  type ProductFilter, type ProductOverview,
} from "../productsLogic";

/**
 * Figma "More · Products & stock". As in the prototype: All / Stocked tabs, and
 * an archive button in the header that opens the Archived products page.
 */
export function ProductsScreen({ initialFilter = "all", archivedOnly = false }: { initialFilter?: ProductFilter; archivedOnly?: boolean }) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  // Offline the list is read-only (plan 10.6).
  const canManage = usePermission(PERMISSIONS.manageProducts);
  const canPrice = usePermission(PERMISSIONS.managePricing);
  const query = useProductsOverview();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "stocked">(initialFilter === "stocked" ? "stocked" : "all");
  const filter: ProductFilter = archivedOnly ? "archived" : tab;
  const [adding, setAdding] = useState(false);
  const restore = useSetProductArchived();

  const visible = useMemo(() => filterProducts(query.data ?? [], filter, search), [query.data, filter, search]);
  // Prototype: 15 products per page; a new search or tab starts at page 1.
  const [page, setPage] = usePage(`${search.trim()}|${filter}`);
  const scroller = useRef<ScrollViewInstance>(null);
  const goTo = (next: number) => { setPage(next); scroller.current?.scrollTo({ y: 0, animated: false }); };

  function restoreProduct(row: ProductOverview) {
    restore.mutate({ productId: row.id, archived: false }, {
      onSuccess: () => toast({ title: `${row.product_name} restored`, message: "Available for new orders again" }),
      onError: (error) => toast({ title: "Not restored", message: problemText(error), tone: "error" }),
    });
  }

  return (
    <Screen
      title={archivedOnly ? "Archived products" : "Products & stock"}
      showBackButton
      scroll={false}
      headerRight={archivedOnly ? undefined : (
        <View style={styles.headerActions}>
          {/* Batch prices moved here from the More menu (Phase 9, as in Figma). */}
          {/* Offline these stay visible but disabled (Figma; Jac, 4 Nov). */}
          {canPrice ? <IconButton icon="pricetag-outline" variant="round" size={40} iconSize={20} accessibilityLabel={online ? "Batch update prices" : "Batch update prices. Requires a connection"} disabled={!online} onPress={() => router.push("/pricing")} /> : null}
          {canManage ? <IconButton icon="add" variant="round" size={40} iconSize={20} accessibilityLabel={online ? "Add product" : "Add product. Requires a connection"} disabled={!online} onPress={() => setAdding(true)} /> : null}
          {/* Prototype: archived products open from a header button (not in Figma; same IconButton). */}
          <IconButton icon="archive-outline" variant="round" size={40} iconSize={20} accessibilityLabel="Archived products" onPress={() => router.push("/products/archived")} />
        </View>
      )}
    >
      <ScrollView
        ref={scroller}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 112 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
      >
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search product or SKU" />
        {archivedOnly ? null : (
          <SegmentedControl
            tone="light"
            options={[{ key: "all", label: "All" }, { key: "stocked", label: "Stocked" }]}
            value={tab}
            onChange={(key) => setTab(key as "all" | "stocked")}
          />
        )}
        <StaleNotice query={query} />
        <OfflineReadOnly what="products" />
        {query.isPending ? (
          <LoadingState message="Loading products..." />
        ) : query.isError && !query.data ? (
          <ErrorState description="Products couldn’t be loaded." onRetry={() => void query.refetch()} />
        ) : visible.length ? (
          pageSlice(visible, page, PAGE_SIZE).map((row) => (
            <View key={row.id} style={archivedOnly ? styles.archivedRow : undefined}>
              <ProductCard row={row} showPrice={canPrice} />
              {archivedOnly && canManage ? (
                <Button label="Restore" type="brandOutline" size="md" icon="refresh" disabled={!online || restore.isPending} onPress={() => restoreProduct(row)} />
              ) : null}
            </View>
          )).concat(<Pagination key="pages" page={page} total={visible.length} pageSize={PAGE_SIZE} onChange={goTo} label="products" />)
        ) : (
          <Card>
            <EmptyState
              icon="leaf-outline"
              title={search ? "No products found" : filter === "stocked" ? "No stocked products" : filter === "archived" ? "No archived products" : "No products yet"}
              description={search ? "Try another filter or search." : filter === "stocked" ? "Turn on Track inventory on a product to count its stock here." : filter === "archived" ? "Archived products appear here. Past orders keep them." : "Add your first product with the + button."}
            />
          </Card>
        )}
      </ScrollView>
      {canManage && !archivedOnly ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add product"
          accessibilityHint={online ? undefined : "Requires a connection"}
          accessibilityState={{ disabled: !online }}
          disabled={!online}
          onPress={() => setAdding(true)}
          style={({ pressed }) => [styles.fab, { bottom: insets.bottom + spacing.lg }, pressed && styles.fabPressed, !online && styles.fabDisabled]}
        >
          <Icon name="plus" size={26} color={colors.onBrand} />
        </Pressable>
      ) : null}
      <ProductFormSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onSaved={(id, name) => {
          setAdding(false);
          toast(`${name} added`);
          router.push({ pathname: "/products/[id]", params: { id } });
        }}
      />
    </Screen>
  );
}

/** Figma "Stock Card": Tracked when stock is counted, Simple otherwise. */
function ProductCard({ row, showPrice }: { row: ProductOverview; showPrice: boolean }) {
  const price = !showPrice ? undefined : row.selling_price === null ? "No price" : formatMoney(row.selling_price);
  const tracked = row.track_stock && row.stock_status && row.stock_quantity !== null;
  const meta = tracked ? STOCK_META[row.stock_status!] : null;
  const archived = row.status === "archived";
  const quantity = row.stock_quantity ?? 0;
  return (
    <View>
      <StockCard
        name={archived ? `${row.product_name} · Archived` : row.product_name}
        detail={productDetailLine(row)}
        price={price}
        margin={marginLabel(row.margin_percent) ?? undefined}
        muted={archived}
        accessibilityLabel={`${row.product_name}${meta ? `, ${meta.label}, ${formatQty(quantity)} ${row.unit ?? ""} in stock` : stockUnknown(row) ? `, ${STOCK_UNAVAILABLE.label}` : ""}`}
        stock={stockUnknown(row) ? { badge: STOCK_UNAVAILABLE, value: "No stock count", level: 0, tone: "neutral" } : tracked && meta ? {
          badge: meta,
          value: `${formatQty(quantity)} ${row.unit ?? ""}`.trim(),
          level: stockLevel(quantity, row.low_stock_threshold),
          tone: row.stock_status === "available" ? "success" : "danger",
        } : undefined}
        onPress={() => router.push({ pathname: "/products/[id]", params: { id: row.id } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", gap: spacing.sm },
  archivedRow: { gap: spacing.sm },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", ...shadows.card, elevation: 6 },
  fabPressed: { backgroundColor: colors.primaryPressed },
  fabDisabled: { opacity: 0.4 },
});
