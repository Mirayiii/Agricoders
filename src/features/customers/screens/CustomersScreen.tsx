import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar, Card, Chip, EmptyState, ErrorState, Icon, LoadingState, Screen, SearchBar, StaleNotice, StatusBadge, useToast } from "@/components";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { OfflineReadOnly } from "@/features/sync/OfflineReadOnly";
import { useIsOnline } from "@/services/offline";
import { CustomerFormSheet } from "../CustomerFormSheet";
import { useCustomers } from "../customersData";
import { codeLine, contactLine, customerName, searchCustomers, statusCounts, type CustomerRow, type CustomerStatus } from "../customersLogic";

/** Figma "More · Customers". Only administrators and administrative staff reach it (route gate and server). */
export function CustomersScreen() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const query = useCustomers();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CustomerStatus>("active");
  const [adding, setAdding] = useState(false);

  const searched = useMemo(() => searchCustomers(query.data ?? [], search), [query.data, search]);
  const counts = statusCounts(searched);
  const visible = searched.filter((row) => row.status === filter);
  const online = useIsOnline();

  return (
    <Screen title="Customers" showBackButton scroll={false}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 112 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
      >
        <View style={styles.filters}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, code or contact" />
          <View style={styles.chips}>
            <Chip label="Active" count={counts.active} selected={filter === "active"} onPress={() => setFilter("active")} />
            <Chip label="Archived" count={counts.archived} selected={filter === "archived"} onPress={() => setFilter("archived")} />
          </View>
        </View>
        <StaleNotice query={query} />
        <OfflineReadOnly what="customers" />
        {query.isPending ? (
          <LoadingState message="Loading customers..." />
        ) : query.isError && !query.data ? (
          <ErrorState description="Customers couldn’t be loaded." onRetry={() => void query.refetch()} />
        ) : visible.length ? (
          visible.map((row) => <CustomerRowCard key={row.id} row={row} />)
        ) : (
          <Card>
            <EmptyState
              icon="people-outline"
              title={search ? "No customers found" : filter === "archived" ? "No archived customers" : "No customers yet"}
              description={search ? "Try a different name, code, contact or phone number." : filter === "archived" ? "Archived customers appear here. Their orders are kept." : "Add your first business customer with the + button."}
            />
          </Card>
        )}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add customer"
        accessibilityHint={online ? undefined : "Requires a connection"}
        accessibilityState={{ disabled: !online }}
        disabled={!online}
        onPress={() => setAdding(true)}
        style={({ pressed }) => [styles.fab, { bottom: insets.bottom + spacing.lg }, pressed && styles.fabPressed, !online && styles.fabDisabled]}
      >
        <Icon name="plus" size={26} color={colors.onBrand} />
      </Pressable>
      <CustomerFormSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onSaved={(id, name) => {
          setAdding(false);
          toast(`${name} added`);
          router.push({ pathname: "/customers/[id]", params: { id } });
        }}
      />
    </Screen>
  );
}

/** Figma "Person Row" for a customer. */
function CustomerRowCard({ row }: { row: CustomerRow }) {
  const archived = row.status === "archived";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${customerName(row)}, ${codeLine(row)}${archived ? ", archived" : ""}`}
      onPress={() => router.push({ pathname: "/customers/[id]", params: { id: row.id } })}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Avatar name={customerName(row) ?? ""} size={44} />
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>{customerName(row)}</Text>
        <Text style={styles.contact} numberOfLines={1}>{contactLine(row)}</Text>
        <Text style={styles.code} numberOfLines={1}>{codeLine(row)}</Text>
      </View>
      <StatusBadge label={archived ? "Archived" : "Active"} tone={archived ? "neutral" : "success"} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  filters: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md, ...shadows.card },
  chips: { flexDirection: "row", gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingVertical: 14, paddingHorizontal: 14, ...shadows.card },
  rowPressed: { backgroundColor: colors.surfacePressed },
  name: { ...text.bodyStrong, color: colors.text },
  contact: { ...text.caption, color: colors.textSecondary, marginTop: 2 },
  code: { ...text.captionStrong, color: colors.primary, marginTop: 2 },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", ...shadows.card, elevation: 6 },
  fabPressed: { backgroundColor: colors.primaryPressed },
  fabDisabled: { opacity: 0.4 },
});
