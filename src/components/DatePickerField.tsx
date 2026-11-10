import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "@/constants/theme";
import { fullDateLabel, parseISODate, toISODate } from "@/utils/format";
import { BottomSheet } from "./BottomSheet";
import { monthGrid, relativeDayText } from "./datePickerLogic";

type DatePickerFieldProps = {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Earliest day that can be picked (YYYY-MM-DD). Days before it are greyed out. */
  minDate?: string;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Prototype delivery date: one card showing the picked day ("Mon, 27 Apr 2026",
 * "In 3 days") with Change, which opens a month calendar.
 */
export function DatePickerField({ label, value, onChange, minDate }: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const today = toISODate(new Date());
  const shown = value ? parseISODate(value) : new Date();
  const [cursor, setCursor] = useState({ year: shown.getFullYear(), month: shown.getMonth() });

  const openCalendar = () => {
    const base = value ? parseISODate(value) : new Date();
    setCursor({ year: base.getFullYear(), month: base.getMonth() });
    setOpen(true);
  };
  const moveMonth = (step: number) => {
    const next = new Date(cursor.year, cursor.month + step, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
  };
  const pick = (iso: string | null) => {
    onChange(iso);
    setOpen(false);
  };
  const earliest = minDate ?? null;
  const prevDisabled = earliest !== null && toISODate(new Date(cursor.year, cursor.month, 0)) < earliest;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}: ${fullDateLabel(value)}. Change` : `Select ${label.toLowerCase()}`}
        onPress={openCalendar}
        style={({ pressed }) => [styles.card, value && styles.cardSet, pressed && styles.pressed]}
      >
        <View style={[styles.icon, value && styles.iconSet]}>
          <Ionicons name="calendar-outline" size={19} color={value ? colors.primary : colors.textSecondary} />
        </View>
        <View style={styles.text}>
          <Text style={[styles.value, !value && styles.placeholder]}>{value ? fullDateLabel(value) : "Select delivery date"}</Text>
          <Text style={styles.sub}>{relativeDayText(value)}</Text>
        </View>
        {value ? <Text style={styles.change}>Change</Text> : null}
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)}>
        <View style={styles.calHeader}>
          <Text style={styles.calTitle} accessibilityRole="header">{MONTHS[cursor.month]} {cursor.year}</Text>
          <View style={styles.calNav}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} disabled={prevDisabled} onPress={() => moveMonth(-1)} style={styles.navButton}>
              <Ionicons name="chevron-back" size={22} color={prevDisabled ? colors.border : colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" hitSlop={8} onPress={() => moveMonth(1)} style={styles.navButton}>
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>
        <View style={styles.week}>
          {WEEKDAYS.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}
        </View>
        <View style={styles.grid}>
          {monthGrid(cursor.year, cursor.month).map((day) => {
            const iso = toISODate(day);
            const inMonth = day.getMonth() === cursor.month;
            const disabled = earliest !== null && iso < earliest;
            const selected = iso === value;
            const isToday = iso === today;
            return (
              <Pressable
                key={iso}
                accessibilityRole="button"
                accessibilityLabel={fullDateLabel(iso)}
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => pick(iso)}
                style={styles.cell}
              >
                <View style={[styles.dayDot, isToday && styles.todayDot, selected && styles.selectedDot]}>
                  <Text style={[styles.dayText, !inMonth && styles.outside, disabled && styles.disabledText, selected && styles.selectedText]}>{day.getDate()}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.calFooter}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => pick(null)}>
            <Text style={styles.footerLink}>Clear</Text>
          </Pressable>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => pick(today)}>
            <Text style={styles.footerLink}>Today</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  card: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14 },
  cardSet: { backgroundColor: colors.surfacePressed, borderColor: colors.primaryMuted },
  pressed: { opacity: 0.85 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  iconSet: { backgroundColor: colors.primarySoft },
  text: { flex: 1, minWidth: 0 },
  value: { ...typography.bodyMedium, color: colors.text },
  placeholder: { color: colors.textSecondary },
  sub: { fontSize: 12, color: colors.textSecondary },
  change: { fontSize: 13, fontWeight: "700", color: colors.primary },
  calHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  calTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  calNav: { flexDirection: "row", gap: spacing.md },
  navButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  week: { flexDirection: "row" },
  weekday: { width: `${100 / 7}%`, textAlign: "center", fontSize: 12, fontWeight: "600", color: colors.textSecondary, paddingVertical: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, height: 44, alignItems: "center", justifyContent: "center" },
  dayDot: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  todayDot: { borderWidth: 1.5, borderColor: colors.primaryMuted },
  selectedDot: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { fontSize: 15, fontWeight: "500", color: colors.text },
  outside: { color: colors.textMuted },
  disabledText: { color: colors.border },
  selectedText: { color: colors.onBrand, fontWeight: "700" },
  calFooter: { flexDirection: "row", justifyContent: "space-between", paddingTop: spacing.md },
  footerLink: { fontSize: 15, fontWeight: "700", color: colors.primary },
});
