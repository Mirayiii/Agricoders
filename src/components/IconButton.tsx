import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, touch } from "@/constants/theme";

type IconButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress: () => void;
  // ghost: header icons; soft: tinted circle; solid: filled green; outline: bordered square.
  variant?: "ghost" | "soft" | "solid" | "outline";
  size?: number;
  iconSize?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function IconButton({ icon, accessibilityLabel, onPress, variant = "ghost", size = touch.icon, iconSize = 22, disabled, style, children }: IconButtonProps) {
  const color = variant === "solid" ? colors.surface : variant === "ghost" ? colors.text : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: variant === "outline" ? radii.md : size / 2 },
        styles[variant],
        pressed && (variant === "solid" ? styles.solidPressed : styles.pressed),
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons name={icon} size={iconSize} color={color} />
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  ghost: {
    backgroundColor: "transparent",
  },
  soft: {
    backgroundColor: colors.primarySoft,
  },
  solid: {
    backgroundColor: colors.primary,
  },
  outline: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  pressed: {
    backgroundColor: colors.primarySoft,
  },
  solidPressed: {
    backgroundColor: colors.primaryPressed,
  },
  disabled: {
    opacity: 0.4,
  },
});
