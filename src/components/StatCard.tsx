import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";
import { Icon, type IconName } from "./Icon";
import type { StatusTone } from "@/types/ui";
import { STATUS_TONE_COLORS } from "./StatusBadge";

type StatCardProps = {
  label: string;
  value: number | string;
  icon: IconName;
  /** Colour of the icon circle: warning, success (brand), info, danger or neutral. */
  tone: StatusTone;
  onPress: () => void;
};

/** Figma "Stat Card": a count with a tinted icon. Tapping opens the matching filtered list. */
export function StatCard({ label, value, icon, tone, onPress }: StatCardProps) {
  const palette = STATUS_TONE_COLORS[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <View style={[styles.iconBg, { backgroundColor: palette.background }]}>
          <Icon name={icon} size={18} color={palette.foreground} />
        </View>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
        <Icon name="chevron-right" size={16} color={colors.textMuted} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 94,
    gap: 10,
    padding: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
  },
  pressed: { backgroundColor: colors.surfacePressed },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBg: { width: 36, height: 36, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  value: { ...text.display, color: colors.text, flex: 1 },
  label: { ...text.label, color: colors.text },
});
