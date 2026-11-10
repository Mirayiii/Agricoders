import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, shadows, spacing, typography } from "@/constants/theme";

export function ListGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

type ListRowProps = {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  last?: boolean;
  right?: ReactNode;
  titleColor?: string;
};

export function ListRow({ title, description, icon, onPress, last, right, titleColor }: ListRowProps) {
  const content = (
    <>
      {icon ? (
        <View style={styles.icon}>
          <Ionicons name={icon} size={19} color={colors.primary} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text style={[styles.title, titleColor ? { color: titleColor } : null]}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null)}
    </>
  );

  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}>
      {content}
    </Pressable>
  ) : (
    <View style={[styles.row, !last && styles.divider]}>{content}</View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    ...shadows.card,
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  description: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
