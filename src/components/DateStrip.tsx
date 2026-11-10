import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "@/constants/theme";
import { addDays, daysFromToday, fullDateLabel, shortDayLabel, toISODate } from "@/utils/format";
import { Chip } from "./Chip";

const DAY_CHOICES = 14;

type DateStripProps = {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
};

// A two-week strip of tappable days. If the current value falls outside the
// strip (e.g. an existing past date being edited), it is still shown first.
export function DateStrip({ label, value, onChange }: DateStripProps) {
  const today = new Date();
  const days = Array.from({ length: DAY_CHOICES }, (_, index) => toISODate(addDays(today, index)));
  const choices = value && !days.includes(value) ? [value, ...days] : days;
  const offset = value ? daysFromToday(value) : null;
  const sub = offset === null ? "Required · pick a day below" : offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset < 0 ? `${-offset} day${offset === -1 ? "" : "s"} ago` : `In ${offset} days`;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.card, value && styles.cardSet]}>
        <View style={[styles.icon, value && styles.iconSet]}>
          <Ionicons name="calendar-outline" size={19} color={value ? colors.primary : colors.textSecondary} />
        </View>
        <View style={styles.text}>
          <Text style={[styles.value, !value && styles.placeholder]}>{value ? fullDateLabel(value) : "Select a date"}</Text>
          <Text style={styles.sub}>{sub}</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {choices.map((iso) => {
          const dayOffset = daysFromToday(iso);
          const chipLabel = dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : shortDayLabel(addDays(today, dayOffset));
          return <Chip key={iso} variant="choice" label={chipLabel} selected={value === iso} onPress={() => onChange(iso)} />;
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  card: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14 },
  cardSet: { backgroundColor: colors.surfacePressed, borderColor: colors.primaryMuted },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  iconSet: { backgroundColor: colors.primarySoft },
  text: { flex: 1, minWidth: 0 },
  value: { ...typography.bodyMedium, color: colors.text },
  placeholder: { color: colors.textSecondary },
  sub: { fontSize: 12, color: colors.textSecondary },
  days: { gap: spacing.sm },
});
