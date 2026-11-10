import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, text } from "@/constants/theme";
import { Icon } from "./Icon";

type CheckboxProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

/**
 * Figma "Checkbox" (20px box, radius 6). Unchecked is an empty rounded square of
 * the same shape and size (approved 3 Nov 2026); Pack Item keeps its own circles.
 */
export function Checkbox({ label, checked, onChange, disabled }: CheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      hitSlop={{ top: 14, bottom: 14 }}
      onPress={() => onChange(!checked)}
      style={[styles.row, disabled && styles.disabled]}
    >
      <View style={[styles.box, checked ? styles.boxChecked : styles.boxUnchecked]}>
        {checked ? <Icon name="check" size={14} color={colors.onBrand} /> : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "flex-start",
  },
  disabled: {
    opacity: 0.4,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: {
    backgroundColor: colors.primary,
  },
  boxUnchecked: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  label: {
    ...text.caption,
    color: colors.text,
  },
});
