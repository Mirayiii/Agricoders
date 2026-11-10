import { useState } from "react";
import { useIsOnline } from "@/services/offline";
import { ReportsOffline } from "../ReportsOffline";
import { StyleSheet, Text, View } from "react-native";

import { Card, ErrorState, LoadingState, Screen, StaleNotice } from "@/components";
import { colors, spacing, text } from "@/constants/theme";
import { formatMoney } from "@/utils/format";
import { BarChart, BarRow, ListCard, PeriodPicker, SectionHead, StatBox, StatGrid, usePeriod } from "../reportParts";
import { useItemAnalytics } from "../reportsData";
import { chartBars, costNote, formatPercentOrDash, profitLine, share, type Period, type Range } from "../reportsLogic";

const qty = (value: number) => String(Math.round(Number(value) * 100) / 100);

/** Figma "Reports · Item analytics": one product's volume, sales and customers. */
export function ItemAnalyticsScreen({ productId = "", initialPeriod = "week", initialBack = 0, initialRange = null }: { productId?: string; initialPeriod?: Period; initialBack?: number; initialRange?: Range | null }) {
  const period = usePeriod(initialPeriod, initialBack, initialRange);
  const query = useItemAnalytics(productId, period.range);
  const online = useIsOnline();
  const [mode, setMode] = useState<"period" | "trend">("period");
  const [measure, setMeasure] = useState<"sales" | "volume">("volume");
  const data = query.data;
  const unit = data?.product.unit ?? "";
  const mainVolume = data ? data.customers.reduce((sum, c) => sum + Number(c.main_volume), 0) : 0;
  const max = Math.max(0, ...(data?.customers ?? []).map((c) => Number(c.main_volume)));

  return (
    <Screen title="Item Analytics" showBackButton contentStyle={styles.content} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <StaleNotice query={query} />
      {data ? (
        <Card style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.name}>{data.product.name}</Text>
            {data.product.selling_sku ?? data.product.buying_sku ? <View style={styles.codePill}><Text style={styles.codeText}>{data.product.selling_sku ?? data.product.buying_sku}</Text></View> : null}
          </View>
          <Text style={styles.caption}>
            Selling price: {data.product.selling_price === null ? "not set" : `${formatMoney(Number(data.product.selling_price))}/${unit}`} · Cost: {data.product.cost_price === null || Number(data.product.cost_price) === 0 ? "not recorded" : `${formatMoney(Number(data.product.cost_price))}/${unit}`}
          </Text>
        </Card>
      ) : null}
      <PeriodPicker state={period} />
      {!online ? <ReportsOffline updatedAt={query.dataUpdatedAt} /> : query.isPending ? <LoadingState message="Loading analytics..." /> : !data ? (
        <ErrorState description="These analytics couldn’t be loaded." onRetry={() => void query.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatBox label="Item volume" value={`${qty(mainVolume)} ${unit}`} sub={`${data.totals.orders} order${data.totals.orders === 1 ? "" : "s"} delivered`} icon="package" />
            <StatBox label="Item sales" value={formatMoney(Number(data.totals.sales))} sub="Total item sales" icon="trending-up" />
            <StatBox label="Item cost" value={formatMoney(Number(data.totals.cost))} sub="Capital cost" icon="tag" tone="danger" />
            <StatBox label="Item margin" value={formatPercentOrDash(data.totals.margin_percent)} sub={profitLine(data.totals, formatMoney)} icon="bar-chart" tone="brand" />
          </StatGrid>
          {costNote(data.totals) ? <Text style={styles.caption}>{costNote(data.totals)}</Text> : null}
          <BarChart
            title={measure === "sales" ? "Daily sales" : "Daily volume"}
            subtitle={`${period.noun} · ${measure === "sales" ? formatMoney(Number(data.totals.sales)) : `${qty(mainVolume)} ${unit}`}`}
            total={measure === "sales" ? formatMoney(Number(data.totals.sales)) : `${qty(mainVolume)} ${unit}`}
            bars={chartBars(period.period, data.daily, measure, mode)}
            suffix={measure === "volume" ? unit : ""}
            mode={mode} onMode={setMode} measure={measure} onMeasure={setMeasure}
          />
          <SectionHead title="Customers who ordered" right={`${data.customers.length} client${data.customers.length === 1 ? "" : "s"}`} />
          {data.customers.length ? (
            <ListCard>
              {data.customers.map((c, index) => (
                <BarRow key={c.customer_id} title={c.name} sub={c.orders === 1 ? "1 order only" : `${c.orders} orders`}
                  value={`${qty(Number(c.main_volume))} ${unit}`} valueSub={<Text style={styles.money}>{formatMoney(Number(c.sales))}</Text>}
                  level={share(Number(c.main_volume), max)} last={index === data.customers.length - 1} />
              ))}
            </ListCard>
          ) : <Card><Text style={styles.caption}>No orders for this product in the period.</Text></Card>}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  caption: { ...text.caption, color: colors.textSecondary },
  header: { gap: 4 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...text.heading, color: colors.text, flex: 1 },
  codePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.primarySoft },
  codeText: { ...text.overline, color: colors.primary },
  money: { ...text.captionStrong, color: colors.primary },
});
