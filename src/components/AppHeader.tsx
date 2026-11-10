import type { ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { APP_NAME } from "@/constants/app";
import { colors, spacing, typography } from "@/constants/theme";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { IconButton } from "./IconButton";

type AppHeaderProps = {
  title?: string;
  showBackButton?: boolean;
  onBackPress?: () => void;
  backIcon?: "chevron-back" | "close";
  rightAction?: ReactNode;
};

export function AppHeader({
  title = APP_NAME,
  showBackButton = false,
  onBackPress,
  backIcon = "chevron-back",
  rightAction,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      {showBackButton ? (
        <View style={[styles.bar, styles.subBar]}>
          <IconButton icon={backIcon} iconSize={24} accessibilityLabel={backIcon === "close" ? "Close" : "Go back"} onPress={onBackPress ?? (() => router.back())} />
          <Text style={[styles.title, styles.subTitle]} numberOfLines={1}>
            {title}
          </Text>
          {rightAction}
        </View>
      ) : (
        <View style={styles.bar}>
          <View style={styles.mark}>
            <Ionicons name="car-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {rightAction ?? <NotificationBell />}
        </View>
      )}
    </View>
  );
}

function NotificationBell() {
  const unread = useUnreadNotifications();

  return (
    <IconButton
      icon="notifications-outline"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}
      onPress={() => router.push("/notifications")}
    >
      {unread ? <View style={styles.dot} /> : null}
    </IconButton>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bar: {
    minHeight: 56,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  subBar: {
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  mark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...typography.brand,
    flex: 1,
    color: colors.text,
  },
  subTitle: {
    letterSpacing: 0,
  },
  dot: {
    position: "absolute",
    top: 8,
    right: 9,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
