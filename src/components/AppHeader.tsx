import { useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { APP_NAME } from "@/constants/app";
import { colors, radii, shadows, spacing, text, typography } from "@/constants/theme";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { Icon } from "./Icon";
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
  const [rightWidth, setRightWidth] = useState(0);

  if (showBackButton) {
    // Figma "Header": round white buttons on the page background, title centered between them.
    // Centered on the screen when the sides match; with several actions on the right,
    // centered in the space left so the title isn't cut short.
    const right = spacing.lg + Math.max(ROUND, rightWidth) + spacing.md;
    const left = rightWidth > ROUND + 8 ? spacing.lg + ROUND + spacing.md : right;
    return (
      <View style={[styles.subWrap, { paddingTop: insets.top + 4 }]}>
        <View style={styles.subBar}>
          <Text style={[styles.subTitle, { left, right }]} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          <HeaderButton
            icon={backIcon === "close" ? "x" : "arrow-left"}
            label={backIcon === "close" ? "Close" : "Go back"}
            onPress={onBackPress ?? (() => router.back())}
          />
          <View style={styles.subRight} onLayout={(event) => setRightWidth(event.nativeEvent.layout.width)}>
            {rightAction}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.mark}>
          <Ionicons name="car-outline" size={18} color={colors.primary} />
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {rightAction ?? <NotificationBell />}
      </View>
    </View>
  );
}

const ROUND = 40;

/** Figma "Button/arrow-left": 40px white circle with the raised shadow. */
function HeaderButton({ icon, label, onPress }: { icon: "arrow-left" | "x"; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={4} onPress={onPress} style={({ pressed }) => [styles.round, pressed && styles.roundPressed]}>
      <Icon name={icon} size={20} color={colors.text} />
    </Pressable>
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
  subWrap: {
    backgroundColor: colors.background,
    paddingBottom: spacing.sm,
  },
  subBar: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  subRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  round: {
    width: ROUND,
    height: ROUND,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    ...shadows.raised,
  },
  roundPressed: {
    backgroundColor: colors.primarySoft,
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
    ...text.title,
    position: "absolute",
    textAlign: "center",
    color: colors.text,
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
