import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";

type SwitchProps = {
  value: boolean;
  onChange?: (value: boolean) => void;
  accessibilityLabel?: string;
  disabled?: boolean;
};

/** Figma "Toggle" (On=True, On=False): 51x31 track, 27px knob. */
export function Switch({ value, onChange, accessibilityLabel, disabled }: SwitchProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled || !onChange}
      hitSlop={8}
      onPress={() => onChange?.(!value)}
      style={[styles.track, value ? styles.trackOn : styles.trackOff, disabled && styles.disabled]}
    >
      <View style={styles.knob} />
    </Pressable>
  );
}

type ToggleRowProps = {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  // "card" renders a bordered row; "plain" is for rows inside an existing card.
  variant?: "card" | "plain";
};

export function ToggleRow({ label, description, value, onChange, variant = "card" }: ToggleRowProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={[styles.row, variant === "card" && styles.card]}
    >
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {/* The row handles the press, so the switch itself is display-only here. */}
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 51,
    height: 31,
    borderRadius: 16,
    padding: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  trackOn: {
    backgroundColor: colors.primary,
    justifyContent: "flex-end",
  },
  trackOff: {
    backgroundColor: colors.borderStrong,
    justifyContent: "flex-start",
  },
  disabled: {
    opacity: 0.4,
  },
  knob: {
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: colors.surface,
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 14,
  },
  text: {
    flex: 1,
  },
  label: {
    ...text.bodyStrong,
    color: colors.text,
  },
  description: {
    ...text.caption,
    color: colors.textSecondary,
  },
});
