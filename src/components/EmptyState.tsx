import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "@/constants/theme";

type EmptyStateProps = {
  title: string;
  description: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: "muted" | "success";
};

export function EmptyState({
  title,
  description,
  icon = "file-tray-outline",
  tone = "muted",
}: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Ionicons name={icon} size={tone === "success" ? 32 : 30} color={tone === "success" ? colors.primary : colors.textMuted} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    gap: 6,
  },
  title: {
    ...typography.bodyMedium,
    color: colors.text,
    textAlign: "center",
  },
  description: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
});
