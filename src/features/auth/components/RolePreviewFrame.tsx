import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { ROLE_META } from "@/constants/roles";
import { colors, spacing, text } from "@/constants/theme";
import { useAuth } from "../useAuth";

/**
 * While an administrator previews another role, a bar stays above every screen
 * saying so, with Exit preview. The screens below lay out as if the bar were the
 * top of the display.
 */
export function RolePreviewFrame({ children }: { children: ReactNode }) {
  const { previewRole, endRolePreview } = useAuth();
  const insets = useSafeAreaInsets();
  if (!previewRole) return <>{children}</>;
  return (
    <View style={styles.fill}>
      <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]} accessibilityRole="summary" accessibilityLiveRegion="polite">
        <Icon name="eye" size={18} color={colors.warning} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>Previewing as {ROLE_META[previewRole].label}</Text>
          <Text style={styles.caption} numberOfLines={2}>UI preview only. Your role, access and data haven’t changed.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit role preview" onPress={endRolePreview} hitSlop={8} style={({ pressed }) => [styles.exit, pressed && styles.pressed]}>
          <Text style={styles.exitText}>Exit preview</Text>
        </Pressable>
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={styles.fill}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.warningSoft, borderBottomWidth: 1, borderBottomColor: colors.warningBorder },
  text: { flex: 1, minWidth: 0 },
  title: { ...text.bodyStrong, fontSize: 14, color: colors.text },
  caption: { ...text.caption, fontSize: 12, color: colors.textSecondary },
  exit: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.warningBorder },
  exitText: { ...text.bodyStrong, fontSize: 13, color: colors.warning },
  pressed: { opacity: 0.7 },
});
