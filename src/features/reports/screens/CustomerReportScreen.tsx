import { Text, StyleSheet } from "react-native";
import { useIsOnline } from "@/services/offline";
import { ReportsOffline } from "../ReportsOffline";
import { router } from "expo-router";

import { ErrorState, LoadingState, Screen, StaleNotice } from "@/components";
import { colors, spacing, text } from "@/constants/theme";
import { formatMoney } from "@/utils/format";
import { BarRow, ListCard, PeriodPicker, SectionHead, StatBox, StatGrid, usePeriod } from "../reportParts";
import { useSalesReport } from "../reportsData";
import { costNote, formatPercentOrDash, profitLine, share, volumeText, type Period, type Range } from "../reportsLogic";

/** Figma "Reports · Customer report". */
export function CustomerReportScreen({ initialPeriod = "week", initialBack = 0, initialRange = null }: { initialPeriod?: Period; initialBack?: number; initialRange?: Range | null }) {
  const period = usePeriod(initialPeriod, initialBack, initialRange);
  const report = useSalesReport(period.range);
  const online = useIsOnline();
  const data = report.data;
  const customers = data?.customers ?? [];
  const max = Math.max(0, ...customers.map((c) => Number(c.sales)));
  const ordering = customers.filter((c) => c.orders > 0).length;

  return (
    <Screen title="Customer report" showBackButton contentStyle={styles.content} refreshing={report.isRefetching} onRefresh={() => void report.refetch()}>
      <StaleNotice query={report} />
      <PeriodPicker state={period} />
      {!online ? <ReportsOffline updatedAt={report.dataUpdatedAt} /> : report.isPending ? <LoadingState message="Loading report..." /> : !data ? (
        <ErrorState description="This report couldn’t be loaded." onRetry={() => void report.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatBox label="Total sales" value={formatMoney(Number(data.totals.sales))} sub="Confirmed & delivered" icon="trending-up" />
            <StatBox label="Total cost" value={formatMoney(Number(data.totals.cost))} sub="Capital cost delivered" icon="tag" tone="danger" />
            <StatBox label="Total volume" value={volumeText(data.totals.volume, 1)} sub="Weight delivered" icon="package" />
            <StatBox label="Margin" value={formatPercentOrDash(data.totals.margin_percent)} sub={profitLine(data.totals, formatMoney)} icon="bar-chart" tone="brand" />
          </StatGrid>
          {costNote(data.totals) ? <Text style={styles.note}>{costNote(data.totals)}</Text> : null}
          <SectionHead title="Customers & totals" right={`${ordering} / ${data.active_customers} active clients`} />
          <ListCard>
            {customers.map((c, index) => (
              <BarRow
                key={c.customer_id}
                title={c.name}
                sub={c.orders ? `${c.orders} order${c.orders === 1 ? "" : "s"}` : "No orders in period"}
                value={formatMoney(Number(c.sales))}
                valueSub={<Text style={c.orders ? styles.link : styles.dash}>{c.orders ? "Analytics & orders ›" : "—"}</Text>}
                level={share(Number(c.sales), max)}
                dim={!c.orders}
                last={index === customers.length - 1}
                onPress={() => router.push({ pathname: "/reports/customer/[id]", params: { id: c.customer_id, ...period.params } })}
              />
            ))}
          </ListCard>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  note: { ...text.caption, color: colors.textSecondary },
  link: { ...text.overline, color: colors.primary },
  dash: { ...text.overline, color: colors.textMuted },
});
