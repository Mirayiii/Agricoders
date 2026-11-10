import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet, Button, Icon } from "@/components";
import { colors, radii, spacing, text } from "@/constants/theme";
import { daysBetween, longDate, monthGrid, monthTitle, pickRangeDay, type DateRange } from "./purchasingLogic";

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Props = {
  visible: boolean;
  initial: DateRange | null;
  today: string;
  onApply: (range: DateRange) => void;
  onClose: () => void;
  /** Longest range allowed; a later end date starts a new range. Defaults to the To buy limit. */
  maxDays?: number;
  /** Shown before any date is tapped. */
  emptyHint?: string;
};

/** Figma "Select Date Range": tap a start date, then an end date. Used by To buy and Reports. */
export function DateRangeSheet({ visible, ...props }: Props) {
  return (
    <BottomSheet visible={visible} onClose={props.onClose}>
      {/* Remount on open so it starts from the range in use. */}
      {visible ? <RangePicker {...props} /> : null}
    </BottomSheet>
  );
}

function RangePicker({ initial, today, onApply, onClose, maxDays, emptyHint = "Choose the first day to buy for." }: Omit<Props, "visible">) {
  const start = initial?.from ?? today;
  const [month, setMonth] = useState(() => ({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 }));
  const [range, setRange] = useState<{ from: string | null; to: string | null }>(initial ?? { from: null, to: null });
  const days = range.from && range.to ? daysBetween(range.from, range.to) + 1 : 0;
  const daysLabel = `${days} ${days === 1 ? "day" : "days"}`;
  const shift = (delta: number) => setMonth((current) => {
    const index = current.year * 12 + current.month + delta;
    return { year: Math.floor(index / 12), month: index % 12 };
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.title} accessibilityRole="header">Select Date Range</Text>
          <Text style={styles.caption}>Tap start date, then tap end date</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close} hitSlop={8}>
          <Icon name="x" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.monthRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => shift(-1)} style={styles.monthButton}>
          <Icon name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.month} accessibilityLiveRegion="polite">{monthTitle(month.year, month.month)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => shift(1)} style={styles.monthButton}>
          <Icon name="chevron-right" size={18} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.week}>
        {WEEKDAYS.map((day) => <Text key={day} style={styles.weekday} importantForAccessibility="no">{day}</Text>)}
      </View>
      {monthGrid(month.year, month.month).map((week, index) => (
        <View key={index} style={styles.week}>
          {week.map((day, column) => {
            if (!day) return <View key={column} style={styles.cell} />;
            const isEnd = day === range.from || day === range.to;
            const inside = Boolean(range.from && range.to && day > range.from && day < range.to);
            const bandLeft = Boolean(range.from && range.to && day > range.from && day <= range.to);
            const bandRight = Boolean(range.from && range.to && day >= range.from && day < range.to);
            return (
              <Pressable
                key={column}
                accessibilityRole="button"
                accessibilityLabel={`${WEEKDAY_NAMES[column]}, ${longDate(day)}${day === today ? ", today" : ""}`}
                accessibilityState={{ selected: isEnd || inside }}
                onPress={() => setRange((current) => pickRangeDay(current, day, maxDays))}
                style={styles.cell}
              >
                {bandLeft ? <View style={[styles.band, styles.bandLeft]} /> : null}
                {bandRight ? <View style={[styles.band, styles.bandRight]} /> : null}
                <View style={[styles.dayCircle, isEnd && styles.dayEnd, day === today && !isEnd && styles.dayToday]}>
                  <Text style={[styles.day, inside && styles.dayInside, isEnd && styles.dayEndText]}>{Number(day.slice(8))}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      {range.from && range.to ? (
        <View style={styles.cycle} accessibilityLiveRegion="polite">
          <View style={styles.flex}>
            <Text style={styles.cycleLabel}>CYCLE ACTIVE ({daysLabel.toUpperCase()})</Text>
            <Text style={styles.cycleRange}>{longDate(range.from)} – {longDate(range.to)}</Text>
          </View>
          <View style={styles.cyclePill}><Text style={styles.cyclePillText}>{days === 1 ? "1 Day" : `${days} Days`}</Text></View>
        </View>
      ) : (
        <Text style={styles.hint}>{range.from ? `Start: ${longDate(range.from)}. Now tap the end date.` : emptyHint}</Text>
      )}

      <View style={styles.actions}>
        <Button
          label={days ? `Apply range (${daysLabel})` : "Apply range"}
          icon="check-circle"
          size="lg"
          disabled={!range.from || !range.to}
          onPress={() => { if (range.from && range.to) onApply({ from: range.from, to: range.to }); }}
        />
        <Button label="Cancel" type="muted" size="lg" onPress={onClose} />
      </View>
    </View>
  );
}

const CELL = 44;
const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  title: { ...text.title, color: colors.text },
  caption: { ...text.caption, color: colors.textSecondary, marginTop: 2 },
  close: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  monthButton: { width: 36, height: 36, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  month: { ...text.heading, color: colors.text },
  week: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", ...text.captionStrong, color: colors.textSecondary, paddingVertical: spacing.sm },
  cell: { flex: 1, height: CELL + 4, alignItems: "center", justifyContent: "center" },
  band: { position: "absolute", top: 2, bottom: 2, width: "51%", backgroundColor: colors.primarySoft },
  bandLeft: { left: 0 },
  bandRight: { right: 0 },
  dayCircle: { width: CELL - 6, height: CELL - 6, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  dayEnd: { backgroundColor: colors.primary },
  dayToday: { borderWidth: 1, borderColor: colors.borderStrong },
  day: { ...text.body, color: colors.text },
  dayInside: { ...text.label, color: colors.primary },
  dayEndText: { ...text.label, color: colors.onBrand },
  cycle: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryMuted, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.sm },
  cycleLabel: { ...text.captionStrong, fontSize: 11, color: colors.primary, letterSpacing: 0.3 },
  cycleRange: { ...text.label, color: colors.text, marginTop: 2 },
  cyclePill: { backgroundColor: colors.primary, borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 3 },
  cyclePillText: { ...text.captionStrong, fontSize: 12, color: colors.onBrand },
  hint: { ...text.caption, color: colors.textSecondary, textAlign: "center", marginTop: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
