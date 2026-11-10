import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";
import { Icon, type IconName } from "./Icon";
import type { StatusTone } from "@/types/ui";
import { StatusBadge } from "./StatusBadge";

type ReviewCardProps = {
  orderNumber: string;
  /** "Today", "Tomorrow" or a short date. */
  day: string;
  customer: string;
  status: { label: string; tone: StatusTone };
  note: string;
  noteIcon: IconName;
  /** Danger for orders that need attention; the badge still shows the real status. */
  noteTone?: "neutral" | "danger";
  onPress: () => void;
};

/** Figma "Review Card": an order that needs action, with the reason underneath. */
export function ReviewCard({ orderNumber, day, customer, status, note, noteIcon, noteTone = "neutral", onPress }: ReviewCardProps) {
  const noteColor = noteTone === "danger" ? colors.danger : colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${orderNumber}, ${day}, ${customer}, ${status.label}. ${note}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.body}>
        <View style={styles.header}>
          <View style={styles.title}>
            <Text style={styles.meta}>{orderNumber} · {day}</Text>
            <Text style={styles.customer}>{customer}</Text>
          </View>
          <StatusBadge label={status.label} tone={status.tone} />
        </View>
        <View style={styles.noteRow}>
          <View style={styles.noteIcon}><Icon name={noteIcon} size={16} color={noteColor} /></View>
          <Text style={[styles.note, { color: noteColor }]}>{note}</Text>
        </View>
      </View>
      <Icon name="chevron-right" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
  },
  pressed: { backgroundColor: colors.surfacePressed },
  body: { flex: 1, minWidth: 0, gap: 4 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, minWidth: 0, gap: 2 },
  meta: { ...text.overline, color: colors.primary },
  customer: { ...text.bodyStrong, color: colors.text },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  noteIcon: { paddingTop: 1 },
  note: { ...text.caption, flex: 1 },
});
