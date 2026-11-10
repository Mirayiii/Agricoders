import { Pressable, StyleSheet, Text } from "react-native";

import { colors, radii, spacing, text, typography } from "@/constants/theme";

type ChipProps = {
  label: string;
  selected?: boolean;
  count?: number;
  onPress: () => void;
  // "filter" chips sit in scrolling filter rows; "choice" chips are form options
  // and use a stronger selected border; "outline" choices have no fill until selected.
  // "status" is the Figma Orders filter chip: solid green when selected.
  variant?: "filter" | "choice" | "outline" | "status";
};

export function Chip({ label, selected = false, count, onPress, variant = "filter" }: ChipProps) {
  if (variant === "status") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
        onPress={onPress}
        style={({ pressed }) => [styles.status, selected && styles.statusSelected, pressed && styles.pressed]}
      >
        <Text style={[styles.statusLabel, selected && styles.statusLabelSelected]}>{label}</Text>
        {count !== undefined ? <Text style={[styles.statusCount, selected && styles.statusCountSelected]}>{count}</Text> : null}
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        variant !== "filter" && styles.choice,
        variant === "outline" && styles.outline,
        selected && (variant === "filter" ? styles.selected : styles.choiceSelected),
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, variant === "choice" && styles.choiceLabel, selected && styles.labelSelected]}>{label}</Text>
      {count !== undefined ? <Text style={[styles.count, selected && styles.labelSelected]}>{count}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Figma Orders "Chip": 34 high, 12 across, radius full.
  status: {
    minHeight: 34,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  statusLabel: { ...text.label, color: colors.text },
  statusLabelSelected: { color: colors.onBrand },
  statusCount: { ...text.caption, color: colors.textSecondary },
  statusCountSelected: { color: colors.primaryMuted },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  choice: {
    minHeight: 40,
    paddingHorizontal: 14,
  },
  outline: {
    backgroundColor: "transparent",
  },
  selected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryMuted,
  },
  choiceSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  choiceLabel: {
    color: colors.text,
  },
  labelSelected: {
    color: colors.primary,
  },
  count: {
    ...typography.captionMedium,
    color: colors.textSecondary,
    opacity: 0.75,
  },
});
