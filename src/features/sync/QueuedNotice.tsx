import { router } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { Icon } from "@/components";
import { colors, radii, spacing, text } from "@/constants/theme";
import { type OutboxAction, useOutbox } from "@/services/offline";

/**
 * A line on a list screen for changes of one kind that are saved on this
 * phone and not on the server yet (for example new orders made offline), so
 * they aren't mistaken for lost. Opens Offline changes.
 */
export function QueuedNotice({ rpc, noun }: { rpc: OutboxAction["rpc"]; noun: [string, string] }) {
  const { items } = useOutbox();
  const mine = items.filter((item) => item.rpc === rpc && item.status !== "synced");
  if (!mine.length) return null;
  const review = mine.filter((item) => item.status === "rejected").length;
  const waiting = mine.length - review;
  const count = (n: number) => `${n} ${n === 1 ? noun[0] : noun[1]}`;
  const message = [waiting ? `${count(waiting)} saved offline, waiting to sync` : "", review ? `${count(review)} need${review === 1 ? "s" : ""} your review` : ""].filter(Boolean).join(" · ");
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens offline changes" onPress={() => router.push("/sync")} style={[styles.notice, review > 0 && styles.review]}>
      <Icon name={review ? "alert-circle" : "clock"} size={16} color={review ? colors.warning : colors.info} />
      <Text style={[styles.text, review > 0 && styles.reviewText]}>{message}</Text>
      <Icon name="chevron-right" size={16} color={review ? colors.warning : colors.info} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.infoSoft, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  review: { backgroundColor: colors.warningSoft },
  text: { ...text.caption, color: colors.info, flex: 1 },
  reviewText: { color: colors.warning },
});
