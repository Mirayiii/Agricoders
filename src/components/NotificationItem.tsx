import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";
import type { StatusTone } from "@/types/ui";
import { Icon, type IconName } from "./Icon";
import { STATUS_TONE_COLORS } from "./StatusBadge";

type NotificationItemProps = {
  title: string;
  body: string;
  time: string;
  unread: boolean;
  icon?: IconName;
  /** Colours the icon circle with a Status Badge tone. Figma shows Danger. */
  tone?: StatusTone;
  onPress?: () => void;
};

/** Figma "Notification Item" (Unread, Read). */
export function NotificationItem({ title, body, time, unread, icon = "alert-circle", tone = "danger", onPress }: NotificationItemProps) {
  const palette = STATUS_TONE_COLORS[tone];
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${unread ? "New. " : ""}${title}. ${body}. ${time}`}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.item, unread ? styles.unread : styles.read]}
    >
      <View style={[styles.iconCircle, { backgroundColor: palette.background }]}>
        <Icon name={icon} size={18} color={palette.foreground} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {unread ? <Text style={styles.newLabel}>New</Text> : null}
        </View>
        <Text style={styles.text}>{body}</Text>
        <Text style={styles.time}>{time}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  unread: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryMuted,
  },
  read: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: "row",
    gap: 8,
  },
  title: {
    ...text.label,
    color: colors.text,
    flex: 1,
  },
  newLabel: {
    ...text.overline,
    color: colors.primary,
  },
  text: {
    ...text.caption,
    color: colors.textSecondary,
  },
  time: {
    ...text.overline,
    color: colors.textMuted,
  },
});
