import { useState } from "react";
import { useIsOnline } from "@/services/offline";
import { ReportsOffline } from "../ReportsOffline";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Button, Card, ErrorState, InlineAlert, LoadingState, Screen, SearchBar, StaleNotice, StatusBadge, useToast } from "@/components";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { ORDER_STATUS_META } from "@/features/orders/status";
import { formatMoney } from "@/utils/format";
import { PeriodPicker, usePeriod } from "../reportParts";
import { shareCsv, useOrderReport } from "../reportsData";
import { toCsv, type Period, type Range } from "../reportsLogic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const OPTIONS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "quarter", label: "Quarter" }, { key: "year", label: "Year" },
];

/** Figma "Reports · Order report": every order in the period with status and total, plus CSV. */
export function OrderReportScreen({ initialPeriod = "week", initialBack = 0, initialRange = null }: { initialPeriod?: Period; initialBack?: number; initialRange?: Range | null }) {
  const toast = useToast();
  const period = usePeriod(initialPeriod, initialBack, initialRange);
  const report = useOrderReport(period.range);
  const online = useIsOnline();
  const [search, setSearch] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const term = search.trim().toLowerCase();
  const rows = (report.data ?? []).filter((row) => !term || `${row.order_number} ${row.customer_name}`.toLowerCase().includes(term));

  async function exportCsv() {
    setExportError(null);
    try {
      const csv = toCsv(["Order", "Customer", "Status", "Delivery date", "Items", "Total"],
        rows.map((row) => [row.order_number, row.customer_name, ORDER_STATUS_META[row.status].label, row.requested_delivery_date, row.item_count, row.total.toFixed(2)]));
      await shareCsv(csv, `Order report ${period.range.start} to ${period.range.end}.csv`);
      toast("Order report CSV ready");
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "The CSV couldn’t be shared.");
    }
  }

  return (
    <Screen title="Order report" showBackButton contentStyle={styles.content} refreshing={report.isRefetching} onRefresh={() => void report.refetch()}>
      <StaleNotice query={report} />
      <PeriodPicker state={period} options={OPTIONS} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search order ID or customer..." />
      {!online ? <ReportsOffline updatedAt={report.dataUpdatedAt} /> : report.isPending ? <LoadingState message="Loading orders..." /> : report.isError && !report.data ? (
        <ErrorState description="This report couldn’t be loaded." onRetry={() => void report.refetch()} />
      ) : rows.length ? (
        <>
          <View style={styles.list}>
            {rows.map((row, index) => {
              const meta = ORDER_STATUS_META[row.status];
              return (
                <Pressable key={row.order_id} accessibilityRole="button" onPress={() => router.push({ pathname: "/orders/[id]", params: { id: row.order_id } })}
                  style={({ pressed }) => [styles.row, index < rows.length - 1 && styles.line, pressed && styles.pressed]}>
                  <View style={styles.flex}>
                    <Text style={styles.title} numberOfLines={1}>{row.order_number} · {row.customer_name}</Text>
                    <Text style={styles.caption}>{short(row.requested_delivery_date)} · {row.item_count} item{row.item_count === 1 ? "" : "s"}</Text>
                  </View>
                  <View style={styles.right}>
                    <StatusBadge label={meta.label} tone={meta.tone} />
                    <Text style={styles.total}>{formatMoney(row.total)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Button label={`Export CSV (${rows.length})`} icon="download" type="brandOutline" size="lg" onPress={() => void exportCsv()} />
          {exportError ? <InlineAlert title="Not exported" message={exportError} /> : null}
        </>
      ) : <Card><Text style={styles.caption}>{search ? "No orders match." : "No orders in this period."}</Text></Card>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  caption: { ...text.caption, color: colors.textSecondary },
  list: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...shadows.card },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  line: { borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { opacity: 0.7 },
  title: { ...text.bodyStrong, color: colors.text },
  right: { alignItems: "flex-end", gap: 4 },
  total: { ...text.bodyStrong, color: colors.text },
});
