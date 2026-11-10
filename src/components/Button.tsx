import { isValidElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radii, text } from "@/constants/theme";
import { Icon, type IconName } from "./Icon";

/** Figma "Button" types. Disabled is a state (the `disabled` prop), not a type. */
export type ButtonType = "primary" | "secondary" | "outline" | "danger" | "destructive" | "muted" | "brandOutline";
/** Figma sizes: L is 52 high with 16pt text, M is 40 high with 13pt text. */
export type ButtonSize = "lg" | "md";

const TYPE_STYLES: Record<ButtonType, { container: ViewStyle; pressed: ViewStyle; label: string }> = {
  primary: {
    container: { backgroundColor: colors.primary },
    pressed: { backgroundColor: colors.primaryPressed },
    label: colors.onBrand,
  },
  secondary: {
    container: { backgroundColor: colors.primarySoft },
    pressed: { backgroundColor: colors.primaryMuted },
    label: colors.primary,
  },
  outline: {
    container: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
    pressed: { backgroundColor: colors.background },
    label: colors.text,
  },
  // Figma Order "Cancel confirmation": solid red, white label.
  destructive: {
    container: { backgroundColor: colors.danger },
    pressed: { opacity: 0.85 },
    label: colors.onBrand,
  },
  // Figma sheet "Cancel": muted grey fill.
  muted: {
    container: { backgroundColor: colors.surfaceMuted },
    pressed: { backgroundColor: colors.borderStrong },
    label: colors.text,
  },
  // Figma "Keep order": white with a brand-green border and label.
  brandOutline: {
    container: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
    pressed: { backgroundColor: colors.primarySoft },
    label: colors.primary,
  },
  danger: {
    // Figma: danger-bg fill with a 1px danger-fg stroke at 30%.
    container: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: "rgba(180, 35, 24, 0.3)" },
    pressed: { opacity: 0.85 },
    label: colors.danger,
  },
};

export type ButtonProps = {
  label: string;
  onPress?: PressableProps["onPress"];
  type?: ButtonType;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** A Figma icon name (drawn in the label colour) or a custom element. */
  icon?: IconName | ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Button({
  label,
  onPress,
  type = "primary",
  size = "md",
  disabled,
  loading,
  icon,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const variant = TYPE_STYLES[type];
  const large = size === "lg";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      // M buttons are 40 high in Figma; the slop keeps the touch target at 48.
      hitSlop={large ? undefined : 4}
      style={({ pressed }) => [
        styles.base,
        large ? styles.large : styles.medium,
        variant.container,
        pressed && !isDisabled && variant.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant.label} />
      ) : (
        <>
          {typeof icon === "string" ? (
            <Icon name={icon as IconName} size={large ? 20 : 16} color={variant.label} />
          ) : isValidElement(icon) ? (
            icon
          ) : null}
          <Text style={[large ? text.button : text.captionStrong, styles.label, { color: variant.label }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

type LegacyButtonProps = Omit<ButtonProps, "type">;

/** Primary button. `destructive` maps to the Figma Danger type. */
export function PrimaryButton({ destructive = false, ...props }: LegacyButtonProps & { destructive?: boolean }) {
  return <Button {...props} type={destructive ? "danger" : "primary"} />;
}

/**
 * Secondary button. Tone "primary" is the Figma Secondary type, "neutral" is
 * Outline and "danger" is Danger.
 */
export function SecondaryButton({ tone = "primary", ...props }: LegacyButtonProps & { tone?: "primary" | "neutral" | "danger" }) {
  const type: ButtonType = tone === "danger" ? "danger" : tone === "neutral" ? "outline" : "secondary";
  return <Button {...props} type={type} />;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  large: {
    minHeight: 52,
    paddingHorizontal: 20,
  },
  medium: {
    minHeight: 40,
    paddingHorizontal: 14,
  },
  disabled: {
    opacity: 0.4,
  },
  // Long labels wrap rather than being cut off at large text sizes.
  label: {
    flexShrink: 1,
    textAlign: "center",
  },
});
