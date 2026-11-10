import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";

type SegmentedControlProps<T extends string> = {
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Smaller text and padding, for four short options (Figma To buy horizons). */
  compact?: boolean;
};

export function SegmentedControl<T extends string>({ options, value, onChange, compact = false }: SegmentedControlProps<T>) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.key)}
            style={[styles.segment, compact && styles.segmentCompact, selected && styles.selected]}
          >
            <Text style={[styles.label, compact && styles.labelCompact, selected && styles.labelSelected]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Figma "Segmented control": muted track, selected segment filled in brand green.
const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  segmentCompact: {
    minHeight: 34,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  labelCompact: {
    fontSize: 13,
  },
  selected: {
    backgroundColor: colors.primary,
  },
  label: {
    ...text.label,
    color: colors.textSecondary,
  },
  labelSelected: {
    color: colors.onBrand,
  },
});
