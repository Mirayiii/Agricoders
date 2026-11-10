import { type Ref, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance, type TextInputProps } from "react-native";

import { colors, radii, text } from "@/constants/theme";
import { Icon, type IconName } from "./Icon";

type FormInputProps = TextInputProps & {
  label: string;
  /** Forwarded to the TextInput, for example to move focus to the next field. */
  ref?: Ref<TextInputInstance>;
  /** Shows the Figma Error state: red 1.5px border and this message below. */
  error?: string;
  /** Leading Figma icon, for example "user" or "key". */
  icon?: IconName;
};

/**
 * Figma "Input Field" (Default, Filled, Error). Passing `secureTextEntry` adds
 * the eye button that shows or hides the password.
 */
export function FormInput({ label, error, icon, style, secureTextEntry, multiline, ...inputProps }: FormInputProps) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = Boolean(secureTextEntry);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, multiline && styles.fieldMultiline, error ? styles.fieldError : null]}>
        {icon ? <Icon name={icon} size={18} color={colors.textMuted} /> : null}
        <TextInput
          {...inputProps}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          multiline={multiline}
          secureTextEntry={isPassword && !revealed}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, multiline && styles.inputMultiline, style]}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            hitSlop={12}
            onPress={() => setRevealed((value) => !value)}
          >
            {/* Eye shows the password; eye-off hides it again. */}
            <Icon name={revealed ? "eye-off" : "eye"} size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  label: {
    ...text.captionStrong,
    color: colors.textSecondary,
  },
  field: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  fieldMultiline: {
    alignItems: "flex-start",
    paddingVertical: 12,
  },
  fieldError: {
    borderWidth: 1.5,
    borderColor: colors.danger,
    // Keep the content in place when the border gets thicker.
    paddingHorizontal: 13.5,
  },
  input: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 0,
    ...text.bodyMedium,
    color: colors.text,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  error: {
    ...text.caption,
    color: colors.danger,
  },
});
