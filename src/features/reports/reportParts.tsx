import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card, Icon, SegmentedControl, useToast, type IconName } from "@/components";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { DateRangeSheet } from "@/features/purchasing/DateRangeSheet";
import { manilaToday } from "@/features/purchasing/purchasingLogic";
import {
  MAX_REPORT_DAYS, PERIOD_NOUN, PERIODS, chartPeriodFor, compact, customRangeLabel, matchPeriod, periodRange, rangeDays, rangeLabel,
  type Bar, type Period, type Range,
} from "./reportsLogic";

/**
 * The dates on every report: a Week, Month, Quarter or Year tab (and which
 * one), or a range picked on the calendar.
 */
export function usePeriod(initial: Period = "week", initialBack = 0, initialRange: Range | null = null) {
  const [period, setPeriod] = useState<Period>(initial);
  const [back, setBack] = useState(initialBack);
  const [custom, setCustom] = useState<Range | null>(initialRange);
  const today = manilaToday();
  const range = custom ?? periodRange(period, today, back);
  return {
    /** The tab that is lit, or null for a picked range that matches none. */
    selected: custom ? null : period,
    /** How the chart groups days. */
    period: custom ? chartPeriodFor(custom) : period,
    back,
    custom,
    range,
    today,
    label: custom ? customRangeLabel(custom) : rangeLabel(period, range),
    noun: custom ? customRangeLabel(custom) : PERIOD_NOUN[period],
    /** Route params that keep these dates when opening a detailed report. */
    params: custom ? { start: custom.start, end: custom.end } : { period, back: String(back) },
    setPeriod: (value: Period) => { setPeriod(value); setBack(0); setCustom(null); },
    setBack,
    /** Apply a range from the calendar; it lights a tab when it is exactly one of them. */
    applyRange: (picked: Range, periods: Period[]) => {
      const match = matchPeriod(picked, today, periods);
      if (match) { setPeriod(match.period); setBack(match.back); setCustom(null); } else setCustom(picked);
    },
  };
}

export function PeriodPicker({ state, options = PERIODS }: { state: ReturnType<typeof usePeriod>; options?: { key: Period; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      <View style={styles.viewing}>
        <View style={styles.viewingIcon}><Icon name="calendar" size={18} color={colors.onBrand} /></View>
        <Text style={styles.viewingText}>Viewing: {state.label}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Select date range" onPress={() => setOpen(true)} style={styles.calendar}>
          <Icon name="calendar" size={20} color={colors.primary} />
        </Pressable>
      </View>
      {/* No tab is lit while a picked range matches none of them. */}
      <SegmentedControl options={options} value={(state.selected ?? "") as Period} onChange={state.setPeriod} compact={options.length > 4} />
      <DateRangeSheet
        visible={open}
        initial={{ from: state.range.start, to: state.range.end }}
        today={state.today}
        maxDays={MAX_REPORT_DAYS}
        emptyHint="Choose the first day of the report."
        onClose={() => setOpen(false)}
        onApply={({ from, to }) => {
          const picked = { start: from, end: to };
          state.applyRange(picked, options.map((option) => option.key));
          setOpen(false);
          toast(`Reports date range: ${customRangeLabel(picked)} (${rangeDays(picked)}D)`);
        }}
      />
    </>
  );
}

/** Figma report stat tile: label, value, a line under, and an icon. */
export function StatBox({ label, value, sub, icon, tone = "default" }: { label: string; value: string; sub?: string; icon?: IconName; tone?: "default" | "danger" | "brand" }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ""}`}>
      <View style={styles.statHead}>
        <Text style={styles.statLabel} numberOfLines={1}>{label.toUpperCase()}</Text>
        {icon ? <Icon name={icon} size={14} color={tone === "danger" ? colors.danger : colors.primary} /> : null}
      </View>
      <Text style={[styles.statValue, tone === "danger" && styles.danger, tone === "brand" && styles.brand]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={styles.statSub} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/** Simple tile for the overview row ("Total Sales ₱34.6k"). */
export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.mini}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.miniValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

type ChartProps = {
  title: string;
  subtitle: string;
  total: string;
  bars: Bar[];
  suffix?: string;
  mode: "period" | "trend";
  onMode: (mode: "period" | "trend") => void;
  measure: "sales" | "volume";
  onMeasure: (measure: "sales" | "volume") => void;
};

/** Figma daily chart: Period/Trend and Sales/Volume switches, bars with values, the highest bar dark. */
export function BarChart({ title, subtitle, total, bars, suffix = "", mode, onMode, measure, onMeasure }: ChartProps) {
  const max = Math.max(0, ...bars.map((bar) => bar.value));
  const dense = bars.length > 12;
  return (
    <Card style={styles.chart}>
      <View style={styles.switches}>
        <Switcher options={[["period", "Period"], ["trend", "Trend"]]} value={mode} onChange={onMode} />
        <Switcher options={[["sales", "Sales"], ["volume", "Volume"]]} value={measure} onChange={onMeasure} />
      </View>
      <View style={styles.chartHead}>
        <View style={styles.flex}>
          <Text style={styles.chartTitle}>{title}</Text>
          <Text style={styles.statSub}>{subtitle}</Text>
        </View>
        <Text style={styles.chartTotal}>{total}</Text>
      </View>
      <View style={styles.bars} accessibilityLabel={`${title}: ${bars.map((bar) => `${bar.label} ${compact(bar.value, suffix)}`).join(", ")}`}>
        {bars.map((bar) => {
          const top = max > 0 && bar.value === max;
          return (
            <View key={bar.key} style={styles.barColumn}>
              {!dense || top ? <Text style={[styles.barValue, top && styles.barValueTop]} numberOfLines={1}>{compact(bar.value, suffix)}</Text> : null}
              <View style={[styles.bar, { height: Math.max(3, max > 0 ? (bar.value / max) * 112 : 3) }, top && styles.barTop, !bar.value && styles.barEmpty]} />
              {!dense || bars.indexOf(bar) % 5 === 0 ? <Text style={[styles.barLabel, top && styles.barLabelTop]} numberOfLines={1}>{bar.label}</Text> : <Text style={styles.barLabel}> </Text>}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function Switcher<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.switcher} accessibilityRole="tablist">
      {options.map(([key, label]) => (
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: key === value }} onPress={() => onChange(key)} style={[styles.switch, key === value && styles.switchOn]}>
          <Text style={[styles.switchText, key === value && styles.switchTextOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A list row with a value on the right and a share bar underneath. */
export function BarRow({ title, sub, value, valueSub, level, onPress, dim = false, last = false }: { title: string; sub: string; value: string; valueSub?: ReactNode; level: number; onPress?: () => void; dim?: boolean; last?: boolean }) {
  return (
    <Pressable disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} onPress={onPress} style={({ pressed }) => [styles.barRow, !last && styles.barRowLine, pressed && styles.pressed]}>
      <View style={styles.barRowTop}>
        <View style={styles.flex}>
          <Text style={[styles.rowTitle, dim && styles.dim]} numberOfLines={1}>{title}</Text>
          <Text style={styles.statSub}>{sub}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.rowValue, dim && styles.dim]}>{value}</Text>
          {valueSub}
        </View>
      </View>
      {!dim ? <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(level * 100)}%` }]} /></View> : null}
    </Pressable>
  );
}

export function ListCard({ children }: { children: ReactNode }) {
  return <View style={styles.listCard}>{children}</View>;
}

export function SectionHead({ title, right }: { title: string; right?: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  viewing: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  viewingIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  viewingText: { ...text.bodyStrong, color: colors.primary, flex: 1 },
  calendar: { width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { flexBasis: "47%", flexGrow: 1, gap: 2, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...shadows.card },
  statHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  statLabel: { ...text.micro, color: colors.textSecondary, flex: 1 },
  statValue: { fontSize: 22, lineHeight: 28, fontWeight: "700", color: colors.text },
  statSub: { ...text.caption, color: colors.textSecondary },
  danger: { color: colors.danger },
  brand: { color: colors.primary },
  mini: { flex: 1, gap: 4, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...shadows.card },
  miniLabel: { ...text.caption, color: colors.textSecondary },
  miniValue: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text },
  chart: { gap: spacing.md },
  switches: { flexDirection: "row", justifyContent: "space-between" },
  switcher: { flexDirection: "row", padding: 3, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  switch: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  switchOn: { backgroundColor: colors.primary },
  switchText: { ...text.overline, color: colors.textSecondary },
  switchTextOn: { color: colors.onBrand },
  chartHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  chartTitle: { ...text.heading, color: colors.text },
  chartTotal: { ...text.heading, color: colors.primary },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 160 },
  barColumn: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  bar: { width: "100%", borderRadius: 4, backgroundColor: "#B9DCC5" },
  barTop: { backgroundColor: colors.primary },
  barEmpty: { backgroundColor: colors.surfaceMuted },
  barValue: { ...text.micro, color: colors.textSecondary },
  barValueTop: { color: colors.text },
  barLabel: { ...text.overline, color: colors.textSecondary },
  barLabelTop: { color: colors.text, fontWeight: "700" },
  listCard: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...shadows.card },
  barRow: { paddingVertical: spacing.md, gap: spacing.sm },
  barRowLine: { borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { opacity: 0.7 },
  barRowTop: { flexDirection: "row", gap: spacing.sm },
  rowTitle: { ...text.bodyStrong, color: colors.text },
  rowRight: { alignItems: "flex-end", gap: 2 },
  rowValue: { ...text.bodyStrong, color: colors.text },
  dim: { color: colors.textMuted },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: "hidden" },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.primary },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  sectionTitle: { ...text.heading, color: colors.text },
  sectionRight: { ...text.captionStrong, color: colors.primary },
});
