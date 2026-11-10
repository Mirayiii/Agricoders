import { useState } from "react";
import { useIsOnline } from "@/services/offline";
import { ReportsOffline } from "../ReportsOffline";
import { StyleSheet, Text } from "react-native";
import { router } from "expo-router";

import { Card, ErrorState, LoadingState, Screen, SearchBar, SegmentedControl, StaleNotice } from "@/components";
import { colors, spacing, text } from "@/constants/theme";
import { formatMoney } from "@/utils/format";
import { BarRow, ListCard, PeriodPicker, SectionHead, StatBox, StatGrid, usePeriod } from "../reportParts";
import { useSalesReport, type ProductTotals } from "../reportsData";
import { costNote, formatPercentOrDash, profitLine, share, volumeText, type Period, type Range } from "../reportsLogic";

type Sort = "most" | "least" | "zero";
const qty = (value: number) => String(Math.round(Number(value) * 100) / 100);

/** Figma "Reports · Product volume report". Volume is in each product's own unit. */
export function ProductVolumeScreen({ initialPeriod = "week", initialBack = 0, initialRange = null }: { initialPeriod?: Period; initialBack?: number; initialRange?: Range | null }) {
  const period = usePeriod(initialPeriod, initialBack, initialRange);
  const report = useSalesReport(period.range);
  const online = useIsOnline();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("most");
  const data = report.data;
  const products = data?.products ?? [];
  const ordered = products.filter((p) => p.orders > 0).length;
  const term = search.trim().toLowerCase();
  let rows: ProductTotals[] = products.filter((p) => !term || p.name.toLowerCase().includes(term));
  if (sort === "zero") rows = rows.filter((p) => !p.orders);
  else if (sort === "least") rows = rows.filter((p) => p.orders > 0).sort((a, b) => a.orders - b.orders || Number(a.main_volume) - Number(b.main_volume));
  const max = Math.max(0, ...rows.map((p) => Number(p.main_volume)));

  return (
    <Screen title="Product Volume Report" showBackButton contentStyle={styles.content} refreshing={report.isRefetching} onRefresh={() => void report.refetch()}>
      <StaleNotice query={report} />
      <PeriodPicker state={period} />
      {!online ? <ReportsOffline updatedAt={report.dataUpdatedAt} /> : report.isPending ? <LoadingState message="Loading report..." /> : !data ? (
        <ErrorState description="This report couldn’t be loaded." onRetry={() => void report.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatBox label="Total volume" value={volumeText(data.totals.volume, 1)} sub={data.totals.volume.length > 1 ? volumeText(data.totals.volume.slice(1), 2) : "Weight delivered"} icon="package" />
            <StatBox label="Items ordered" value={`${ordered} / ${data.products_total} SKUs`} sub="Products with orders" icon="tag" />
            <StatBox label="Total orders" value={String(data.totals.orders)} sub="Confirmed & delivered" icon="file-text" />
            <StatBox label="Avg margin" value={formatPercentOrDash(data.totals.margin_percent)} sub={profitLine(data.totals, formatMoney)} icon="trending-up" tone="brand" />
          </StatGrid>
          {costNote(data.totals) ? <Text style={styles.caption}>{costNote(data.totals)}</Text> : null}
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search products..." />
          <SegmentedControl options={[{ key: "most", label: "Most volume" }, { key: "least", label: "Least ordered" }, { key: "zero", label: "Zero orders" }]} value={sort} onChange={setSort} />
          <SectionHead title="Products & volume" />
          {rows.length ? (
            <ListCard>
              {rows.map((p, index) => (
                <BarRow
                  key={p.product_id}
                  title={p.name}
                  sub={`${p.orders} order${p.orders === 1 ? "" : "s"} · ${p.clients} client${p.clients === 1 ? "" : "s"}`}
                  value={`${qty(Number(p.main_volume))} ${p.unit ?? ""}`.trim()}
                  valueSub={<Text style={styles.money}>{formatMoney(Number(p.sales))}</Text>}
                  level={share(Number(p.main_volume), max)}
                  last={index === rows.length - 1}
                  onPress={() => router.push({ pathname: "/reports/item/[id]", params: { id: p.product_id, ...period.params } })}
                />
              ))}
            </ListCard>
          ) : <Card><Text style={styles.caption}>{sort === "zero" ? "Every product was ordered in this period." : "No products match."}</Text></Card>}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  caption: { ...text.caption, color: colors.textSecondary },
  money: { ...text.captionStrong, color: colors.primary },
});
