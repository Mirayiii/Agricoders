import { useState } from "react";
import { useIsOnline } from "@/services/offline";
import { ReportsOffline } from "../ReportsOffline";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Button, Card, ErrorState, LoadingState, Screen, SearchBar, StaleNotice, StatusBadge } from "@/components";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { usePermission } from "@/features/auth";
import { formatPercent, marginTone } from "@/features/products/productsLogic";
import { manilaToday } from "@/features/purchasing/purchasingLogic";
import { formatMoney } from "@/utils/format";
import { useDailyPrices } from "../reportsData";

const us = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
const usFull = (iso: string) => `${us(iso)}/${iso.slice(0, 4)}`;

/** Figma "Reports · Daily price updates": the prices in force on a chosen day. */
export function DailyPricesScreen() {
  const today = manilaToday();
  const canPrice = usePermission(PERMISSIONS.managePricing);
  const [date, setDate] = useState(today);
  const [search, setSearch] = useState("");
  const query = useDailyPrices(date);
  const online = useIsOnline();
  const data = query.data;
  const dates = [today, ...(data?.dates ?? []).filter((d) => d !== today)].slice(0, 10);
  const term = search.trim().toLowerCase();
  const rows = (data?.products ?? []).filter((p) => !term || `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(term));
  const priced = (data?.products ?? []).filter((p) => p.selling_price !== null);
  const margins = priced.map((p) => p.margin_percent).filter((m): m is number => m !== null).map(Number);
  const average = margins.length ? Math.round((margins.reduce((a, b) => a + b, 0) / margins.length) * 10) / 10 : null;

  return (
    <Screen title="Daily Price Updates" showBackButton contentStyle={styles.content} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      {canPrice ? <Button label="Batch update prices" icon="edit" size="lg" onPress={() => router.push("/pricing")} /> : null}
      <Text style={styles.overline}>SELECT DATE COLUMN</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dates}>
        {dates.map((d) => (
          <Pressable key={d} accessibilityRole="radio" accessibilityState={{ selected: d === date }} onPress={() => setDate(d)} style={[styles.date, d === date && styles.dateOn]}>
            <Text style={[styles.dateText, d === date && styles.dateTextOn]}>{us(d)}{d === today ? " (Today)" : ""}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <StaleNotice query={query} />
      {!online ? <ReportsOffline updatedAt={query.dataUpdatedAt} /> : query.isPending ? <LoadingState message="Loading prices..." /> : !data ? (
        <ErrorState description="Prices couldn’t be loaded." onRetry={() => void query.refetch()} />
      ) : (
        <>
          <View style={styles.stats}>
            <View style={styles.stat}><Text style={styles.statLabel}>Average margin</Text><Text style={styles.statValue}>{average === null ? "—" : formatPercent(average)}</Text></View>
            <View style={styles.stat}><Text style={styles.statLabel}>Products priced</Text><Text style={styles.statValue}>{priced.length}</Text></View>
            <View style={styles.stat}><Text style={styles.statLabel}>Active date</Text><Text style={[styles.statValue, styles.brand]}>{usFull(date)}</Text></View>
          </View>
          {average !== null && margins.length < priced.length ? <Text style={styles.caption}>{priced.length - margins.length} product{priced.length - margins.length === 1 ? " has" : "s have"} no cost recorded and {priced.length - margins.length === 1 ? "is" : "are"} left out of the average.</Text> : null}
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search product or SKU..." />
          {rows.map((p) => (
            <Card key={p.product_id} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.name} numberOfLines={1}>{p.name} <Text style={styles.caption}>({[p.sku, p.unit].filter(Boolean).join(" · ")})</Text></Text>
                {p.margin_percent === null ? (p.selling_price === null ? null : <StatusBadge label="No cost" tone="neutral" />) : <StatusBadge label={formatPercent(Number(p.margin_percent))} tone={marginTone(Number(p.margin_percent))} />}
              </View>
              <View style={styles.prices}>
                <View style={[styles.price, styles.srp]}><Text style={styles.srpValue}>{p.selling_price === null ? "Not priced" : formatMoney(Number(p.selling_price))}</Text><Text style={styles.tag}>SRP</Text></View>
                <View style={styles.price}><Text style={styles.costValue}>{p.cost_price === null || Number(p.cost_price) === 0 ? "—" : formatMoney(Number(p.cost_price))}</Text><Text style={styles.tag}>COST</Text></View>
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  caption: { ...text.caption, color: colors.textSecondary },
  overline: { ...text.micro, color: colors.textSecondary },
  dates: { gap: spacing.sm },
  date: { paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: "center" },
  dateOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateText: { ...text.captionStrong, color: colors.text },
  dateTextOn: { color: colors.onBrand },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, gap: 2, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...shadows.card },
  statLabel: { ...text.micro, color: colors.textSecondary },
  statValue: { ...text.bodyStrong, color: colors.text },
  brand: { color: colors.primary },
  card: { gap: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...text.bodyStrong, color: colors.text, flex: 1 },
  prices: { flexDirection: "row", gap: spacing.sm },
  price: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  srp: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  srpValue: { ...text.bodyStrong, color: colors.primary },
  costValue: { ...text.bodyStrong, color: colors.text },
  tag: { ...text.micro, color: colors.textMuted },
});
