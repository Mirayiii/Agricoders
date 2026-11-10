import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomSheet, Button, Card, EmptyState, ErrorState, Icon, InlineAlert, LoadingState, Screen, SearchBar, StatusBadge, useToast } from "@/components";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { addDaysIso, manilaToday } from "@/features/purchasing/purchasingLogic";
import { formatMoney } from "@/utils/format";
import { problemText, useBatchSheet, useBatchUpdatePrices } from "../productsData";
import { batchEditsFrom, batchRows, changeVsLast, formatPercent, marginPercent, marginTone, parsePrice, type BatchEdit, type BatchSheetRow } from "../productsLogic";

const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/** Figma "Daily Price Batch Update": every product's price for one date, saved together. */
export function BatchPriceScreen({ initialDate }: { initialDate?: string }) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const today = manilaToday();
  const [priceDate, setPriceDate] = useState(initialDate ?? today);
  const [compareDate, setCompareDate] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<"date" | "compare" | null>(null);
  const [search, setSearch] = useState("");
  const sheet = useBatchSheet(priceDate, compareDate);
  const save = useBatchUpdatePrices();
  const products = useMemo(() => sheet.data?.products ?? [], [sheet.data]);
  // Typed prices belong to the sheet they were typed on; a newly loaded sheet
  // starts from the prices already set for that date.
  const [typed, setTyped] = useState<{ source: BatchSheetRow[] | null; values: Record<string, BatchEdit> }>({ source: null, values: {} });
  const edits = typed.source === products ? typed.values : batchEditsFrom(products);
  const setEdits = (next: (current: Record<string, BatchEdit>) => Record<string, BatchEdit>) => setTyped({ source: products, values: next(edits) });

  const term = search.trim().toLowerCase();
  const visible = products.filter((row) => !term || `${row.name} ${row.sku ?? ""}`.toLowerCase().includes(term));
  const pending = batchRows(products, edits);
  const edit = (id: string, key: keyof BatchEdit) => (value: string) => setEdits((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  const dates = Array.from({ length: 7 }, (_, index) => addDaysIso(today, index));

  function apply() {
    if (pending.problem || !pending.rows.length) return;
    save.mutate({ priceDate, rows: pending.rows }, {
      onSuccess: (result) => {
        toast(priceDate === today ? `${result.updated} price${result.updated === 1 ? "" : "s"} updated. New orders use them now.` : `${result.updated} price${result.updated === 1 ? "" : "s"} set for ${usDate(priceDate)}`);
        void sheet.refetch();
      },
    });
  }

  return (
    <Screen title="Daily Price Batch Update" showBackButton scroll={false}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search product or SKU..." />
        <Card style={styles.dates}>
          <View style={styles.dateRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Price date ${usDate(priceDate)}. Change`} onPress={() => setChoosing("date")} style={styles.priceDate}>
              <Icon name="calendar" size={20} color={colors.primary} />
              <View>
                <Text style={styles.overline}>PRICE DATE</Text>
                <Text style={styles.dateValue}>{usDate(priceDate)}</Text>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setChoosing("compare")} style={styles.compareButton}>
              <Text style={styles.compareButtonText}>Compare Prices</Text>
            </Pressable>
          </View>
          <View style={styles.comparing}>
            <Icon name="clock" size={20} color={colors.text} />
            <Text style={styles.comparingText}>
              Comparing vs: <Text style={styles.comparingDate}>{sheet.data?.compare_date ? `${usDate(sheet.data.compare_date)}${compareDate ? "" : " (Last Batch)"}` : "no earlier prices"}</Text>
            </Text>
          </View>
          <Text style={styles.caption}>
            {priceDate === today
              ? "Today’s prices apply to orders saved from now on."
              : `These prices apply to orders saved from ${usDate(priceDate)}. Until then, today’s prices stay. You can change them again before that day.`}
            {" "}Past orders keep their prices.
          </Text>
        </Card>
        {sheet.isPending ? <LoadingState message="Loading prices..." /> : sheet.isError && !sheet.data ? (
          <ErrorState description="Prices couldn’t be loaded." onRetry={() => void sheet.refetch()} />
        ) : visible.length ? visible.map((row) => (
          <BatchCard key={row.product_id} row={row} edit={edits[row.product_id] ?? { cost: "", selling: "" }} onCost={edit(row.product_id, "cost")} onSelling={edit(row.product_id, "selling")} />
        )) : <Card><EmptyState icon="pricetag-outline" title={search ? "No products found" : "No products to price"} description={search ? "Try another name or SKU code." : "Add products on Products & stock first."} /></Card>}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {pending.problem ? <Text style={styles.problem}>{pending.problem}</Text> : null}
        {save.isError ? <InlineAlert title="No prices saved" message={`${problemText(save.error)} Nothing in this batch was saved.`} /> : null}
        <View style={styles.footerRow}>
          <View style={styles.flex}>
            <Button label={pending.rows.length ? `Save & Apply (${pending.rows.length})` : "Save & Apply"} icon="check" size="lg" disabled={Boolean(pending.problem) || !pending.rows.length} loading={save.isPending} onPress={apply} />
          </View>
          <Button label="Cancel" type="muted" size="lg" onPress={() => (router.canGoBack() ? router.back() : setTyped({ source: null, values: {} }))} />
        </View>
      </View>

      <BottomSheet visible={choosing !== null} onClose={() => setChoosing(null)}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{choosing === "date" ? "Price date" : "Compare against"}</Text>
        <Text style={styles.caption}>{choosing === "date" ? "Prices can be set for today or a later day, not backdated." : "Prices in force at the end of that day."}</Text>
        <View style={styles.choices}>
          {choosing === "date"
            ? dates.map((date, index) => (
              <Choice key={date} label={index === 0 ? `${usDate(date)} (Today)` : index === 1 ? `${usDate(date)} (Tomorrow)` : usDate(date)} selected={date === priceDate}
                onPress={() => { setPriceDate(date); setCompareDate(null); setChoosing(null); save.reset(); }} />
            ))
            : [<Choice key="last" label="Last batch" selected={compareDate === null} onPress={() => { setCompareDate(null); setChoosing(null); }} />,
              ...(sheet.data?.compare_dates ?? []).map((date) => (
                <Choice key={date} label={usDate(date)} selected={compareDate === date} onPress={() => { setCompareDate(date); setChoosing(null); }} />
              ))]}
        </View>
      </BottomSheet>
    </Screen>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceOn]}>
      <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{label}</Text>
      {selected ? <Icon name="check" size={18} color={colors.primary} /> : null}
    </Pressable>
  );
}

function BatchCard({ row, edit, onCost, onSelling }: { row: BatchSheetRow; edit: BatchEdit; onCost: (value: string) => void; onSelling: (value: string) => void }) {
  const change = changeVsLast(row, edit);
  const cost = parsePrice(edit.cost);
  const selling = parsePrice(edit.selling);
  const newMargin = cost === null || selling === null || Number.isNaN(cost) || Number.isNaN(selling) ? null : marginPercent(cost, selling);
  const lastMargin = marginPercent(row.last_cost, row.last_selling);
  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.name} numberOfLines={1}>{row.name} <Text style={styles.code}>({[row.sku, row.unit].filter(Boolean).join(" · ")})</Text></Text>
        <Text style={[styles.change, change.direction === "down" && styles.down, change.direction === "up" && styles.up]}>
          {change.direction === "down" ? "▼ " : change.direction === "up" ? "▲ " : ""}{change.text}
        </Text>
      </View>
      <View style={styles.columns}>
        <View style={[styles.column, styles.newColumn]}>
          <View style={styles.columnHead}>
            <Text style={styles.newLabel}>NEW PRICES</Text>
            {newMargin === null ? <Text style={styles.noCost}>{cost === 0 ? "No cost" : ""}</Text> : <StatusBadge label={formatPercent(newMargin)} tone={marginTone(newMargin)} />}
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Cost (₱)</Text>
            <TextInput value={edit.cost} onChangeText={onCost} keyboardType="decimal-pad" style={styles.input} accessibilityLabel={`${row.name} cost`} selectTextOnFocus />
          </View>
          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, styles.srp]}>SRP (₱)</Text>
            <TextInput value={edit.selling} onChangeText={onSelling} keyboardType="decimal-pad" style={[styles.input, styles.inputStrong]} accessibilityLabel={`${row.name} selling price`} selectTextOnFocus />
          </View>
        </View>
        <View style={styles.column}>
          <View style={styles.columnHead}>
            <Text style={styles.lastLabel}>LAST BATCH</Text>
            {lastMargin === null ? null : <StatusBadge label={formatPercent(lastMargin)} tone={marginTone(lastMargin)} />}
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Cost</Text>
            <Text style={styles.lastValue}>{row.last_cost === null ? "—" : Number(row.last_cost) === 0 ? "Not recorded" : formatMoney(Number(row.last_cost))}</Text>
          </View>
          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, styles.srpLast]}>SRP</Text>
            <Text style={styles.lastStrong}>{row.last_selling === null ? "—" : formatMoney(Number(row.last_selling))}</Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  caption: { ...text.caption, color: colors.textSecondary },
  dates: { gap: spacing.md },
  dateRow: { flexDirection: "row", gap: spacing.sm },
  priceDate: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  overline: { ...text.micro, color: colors.primary },
  dateValue: { ...text.heading, color: colors.primary },
  compareButton: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  compareButtonText: { ...text.label, color: colors.primary },
  comparing: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  comparingText: { ...text.captionStrong, color: colors.text, flex: 1 },
  comparingDate: { color: colors.primary },
  card: { gap: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...text.heading, color: colors.text, flex: 1 },
  code: { ...text.caption, color: colors.textSecondary },
  change: { ...text.overline, color: colors.textSecondary },
  down: { color: colors.danger },
  up: { color: colors.primary },
  columns: { flexDirection: "row", gap: spacing.sm },
  column: { flex: 1, gap: spacing.sm, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  newColumn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  columnHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 22 },
  newLabel: { ...text.micro, color: colors.primary },
  lastLabel: { ...text.micro, color: colors.textSecondary },
  noCost: { ...text.micro, color: colors.textMuted },
  inputRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs, minHeight: 36 },
  inputLabel: { ...text.caption, color: colors.textSecondary },
  srp: { ...text.captionStrong, color: colors.primary },
  srpLast: { ...text.captionStrong, color: colors.text },
  input: { ...text.bodyStrong, color: colors.text, width: 72, height: 36, textAlign: "right", paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  inputStrong: { borderColor: colors.primary, borderWidth: 1.5 },
  lastValue: { ...text.caption, color: colors.textSecondary },
  lastStrong: { ...text.bodyStrong, color: colors.text },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, ...shadows.card },
  footerRow: { flexDirection: "row", gap: spacing.sm },
  problem: { ...text.caption, color: colors.danger },
  sheetTitle: { ...text.title, color: colors.text },
  choices: { gap: spacing.sm },
  choice: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceText: { ...text.bodyStrong, color: colors.text },
  choiceTextOn: { color: colors.primary },
});
