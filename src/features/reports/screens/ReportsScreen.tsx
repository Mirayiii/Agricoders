import { useState } from "react";
import { useIsOnline } from "@/services/offline";
import { ReportsOffline } from "../ReportsOffline";
import { StyleSheet, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import type { Ionicons } from "@expo/vector-icons";

import { ErrorState, ListGroup, ListRow, LoadingState, Screen, StaleNotice } from "@/components";
import { colors, spacing, text } from "@/constants/theme";
import { formatMoney } from "@/utils/format";
import { BarChart, MiniStat, PeriodPicker, usePeriod } from "../reportParts";
import { useSalesReport } from "../reportsData";
import { chartBars, compactMoney, volumeText } from "../reportsLogic";

const LINKS: { title: string; description: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
  { title: "Customer report", description: "Orders and totals by customer", icon: "people-outline", route: "/reports/customers" },
  { title: "Product Volume Report", description: "Volume and margins by product", icon: "cube-outline", route: "/reports/products" },
  { title: "Order report", description: "Every order with status and total", icon: "document-text-outline", route: "/reports/orders" },
  { title: "Daily Price Updates", description: "Historical price log & margins", icon: "pricetag-outline", route: "/reports/prices" },
];

/** Figma "More · Reports". Administrators only (route gate and server). */
export function ReportsScreen() {
  const period = usePeriod();
  const report = useSalesReport(period.range);
  const online = useIsOnline();
  const [mode, setMode] = useState<"period" | "trend">("period");
  const [measure, setMeasure] = useState<"sales" | "volume">("sales");
  const data = report.data;
  const bars = data ? chartBars(period.period, data.daily, measure, mode) : [];

  return (
    <Screen title="Reports" showBackButton contentStyle={styles.content} refreshing={report.isRefetching} onRefresh={() => void report.refetch()}>
      <StaleNotice query={report} />
      <PeriodPicker state={period} />
      {!online ? <ReportsOffline updatedAt={report.dataUpdatedAt} /> : report.isPending ? <LoadingState message="Loading report..." /> : !data ? (
        <ErrorState description="This report couldn’t be loaded." onRetry={() => void report.refetch()} />
      ) : (
        <>
          <View style={styles.row}>
            <MiniStat label="Total Sales" value={compactMoney(Number(data.totals.sales))} />
            <MiniStat label="Total Orders" value={String(data.totals.orders)} />
            <MiniStat label="Total Volume" value={volumeText(data.totals.volume, 1)} />
          </View>
          <BarChart
            title={measure === "sales" ? "Daily sales" : "Daily volume (kg)"}
            subtitle={`${period.noun} · ${measure === "sales" ? formatMoney(Number(data.totals.sales)) : volumeText(data.totals.volume)}`}
            total={measure === "sales" ? formatMoney(Number(data.totals.sales)) : volumeText(data.totals.volume, 1)}
            bars={bars}
            suffix={measure === "volume" ? "kg" : ""}
            mode={mode} onMode={setMode} measure={measure} onMeasure={setMeasure}
          />
          <Text style={styles.note}>Sales count Confirmed, Preparing, For delivery and Completed orders by delivery date, after discounts.</Text>
        </>
      )}
      <Text style={styles.section}>Reports</Text>
      <ListGroup>
        {LINKS.map((link, index) => (
          <ListRow key={link.route} title={link.title} description={link.description} icon={link.icon} last={index === LINKS.length - 1}
            onPress={() => router.push({ pathname: link.route, params: period.params } as unknown as Href)} />
        ))}
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm },
  section: { ...text.heading, color: colors.text, marginTop: spacing.sm },
  note: { ...text.caption, color: colors.textSecondary },
});
