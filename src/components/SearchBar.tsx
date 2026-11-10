import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, TextInput, View } from "react-native";

import { colors, radii, spacing, touch, typography } from "@/constants/theme";

type SearchBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** "muted": Figma's grey field inside a white card (Orders). */
  tone?: "default" | "muted";
};

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search",
  tone = "default",
}: SearchBarProps) {
  return (
    <View style={[styles.wrap, tone === "muted" && styles.muted]}>
      <Ionicons name="search-outline" size={18} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: touch.minHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  muted: {
    minHeight: 44,
    gap: 10,
    borderWidth: 0,
    paddingHorizontal: 14,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
});
