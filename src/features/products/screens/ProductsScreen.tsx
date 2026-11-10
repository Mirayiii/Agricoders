import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Chip, EmptyState, ErrorState, Icon, IconButton, LoadingState, Screen, SearchBar, StaleNotice, StockCard, useToast } from "@/components";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, shadows, spacing } from "@/constants/theme";
import { usePermission } from "@/features/auth";
import { OfflineReadOnly } from "@/features/sync/OfflineReadOnly";
import { useIsOnline } from "@/services/offline";
import { formatMoney } from "@/utils/format";
import { ProductFormSheet } from "../ProductFormSheet";
import { useProductsOverview } from "../productsData";
import {
  STOCK_META, filterCounts, filterProducts, formatQty, marginLabel, productDetailLine, stockLevel,
  type ProductFilter, type ProductOverview,
} from "../productsLogic";

/** Figma "More · Products & stock". */
export function ProductsScreen({ initialFilter = "all" }: { initialFilter?: ProductFilter }) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  // Offline the list is read-only (plan 10.6).
  const canManage = usePermission(PERMISSIONS.manageProducts);
  const canPrice = usePermission(PERMISSIONS.managePricing);
  const query = useProductsOverview();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProductFilter>(initialFilter);
  const [adding, setAdding] = useState(false);

  const rows = query.data ?? [];
  const counts = filterCounts(rows);
  const visible = useMemo(() => filterProducts(query.data ?? [], filter, search), [query.data, filter, search]);
  const options: { key: ProductFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "stocked", label: "Stocked", count: counts.stocked },
    { key: "low", label: "Low stock", count: counts.low },
    { key: "out", label: "Out of stock", count: counts.out },
    ...(counts.archived || filter === "archived" ? [{ key: "archived" as const, label: "Archived", count: counts.archived }] : []),
  ];

  return (
    <Screen
      title="Products & stock"
      showBackButton
      scroll={false}
      headerRight={canManage || canPrice ? (
        <View style={styles.headerActions}>
          {/* Batch prices moved here from the More menu (Phase 9, as in Figma). */}
          {/* Offline these stay visible but disabled (Figma; Jac, 4 Nov). */}
          {canPrice ? <IconButton icon="pricetag-outline" size={40} iconSize={20} accessibilityLabel={online ? "Batch update prices" : "Batch update prices. Requires a connection"} disabled={!online} onPress={() => router.push("/pricing")} /> : null}
          {canManage ? <IconButton icon="add" size={40} iconSize={20} accessibilityLabel={online ? "Add product" : "Add product. Requires a connection"} disabled={!online} onPress={() => setAdding(true)} /> : null}
        </View>
      ) : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 112 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
      >
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search product or SKU" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {options.map((option) => <Chip key={option.key} label={option.label} count={option.count} selected={filter === option.key} onPress={() => setFilter(option.key)} />)}
        </ScrollView>
        <StaleNotice query={query} />
        <OfflineReadOnly what="products" />
        {query.isPending ? (
          <LoadingState message="Loading products..." />
        ) : query.isError && !query.data ? (
          <ErrorState description="Products couldn’t be loaded." onRetry={() => void query.refetch()} />
        ) : visible.length ? (
          visible.map((row) => <ProductCard key={row.id} row={row} showPrice={canPrice} />)
        ) : (
          <Card>
            <EmptyState
              icon="leaf-outline"
              title={search ? "No products found" : filter === "stocked" ? "No stocked products" : filter === "low" ? "No low-stock products" : filter === "out" ? "Nothing is out of stock" : filter === "archived" ? "No archived products" : "No products yet"}
              description={search ? "Try another name or SKU code." : filter === "stocked" ? "Turn on Track inventory on a product to count its stock here." : filter === "low" || filter === "out" ? "Tracked products below their minimum stock show here." : filter === "archived" ? "Archived products appear here. Past orders keep them." : "Add your first product with the + button."}
            />
          </Card>
        )}
      </ScrollView>
      {canManage ? (
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
        accessibilityLabel={`${row.product_name}${meta ? `, ${meta.label}, ${formatQty(quantity)} ${row.unit ?? ""} in stock` : ""}`}
        stock={tracked && meta ? {
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
  chips: { flexDirection: "row", gap: spacing.sm },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", ...shadows.card, elevation: 6 },
  fabPressed: { backgroundColor: colors.primaryPressed },
  fabDisabled: { opacity: 0.4 },
});
