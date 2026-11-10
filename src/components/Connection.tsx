import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";
import { Icon, type IconName } from "./Icon";

/** Figma "Connection Banner" states. */
export type ConnectionBannerState = "offline" | "syncing" | "backOnline" | "review";

const BANNER: Record<ConnectionBannerState, { background: string; icon: IconName }> = {
  offline: { background: colors.danger, icon: "wifi-off" },
  syncing: { background: colors.info, icon: "refresh" },
  backOnline: { background: colors.primary, icon: "wifi" },
  // Not in Figma: queued changes the server refused, which need the person's review (Phase 10).
  review: { background: colors.warning, icon: "alert-circle" },
};

type ConnectionBannerProps = {
  state: ConnectionBannerState;
  message: string;
  /** Figma shows "Retry" on the Offline state. */
  actionLabel?: string;
  onAction?: () => void;
};

/** Full-width strip under the header. Built now; screens start showing it in the offline phase. */
export function ConnectionBanner({ state, message, actionLabel, onAction }: ConnectionBannerProps) {
  const variant = BANNER[state];
  return (
    <View style={[styles.banner, { backgroundColor: variant.background }]} accessibilityLiveRegion="polite">
      <Icon name={variant.icon} size={16} color={colors.onBrand} />
      <Text style={[styles.bannerText, styles.bannerMessage]}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={onAction}>
          <Text style={styles.bannerText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Figma "Connection State" (Stable, Unstable): the outlined explainer card. */
export function ConnectionStateCard({ stable, title, description }: { stable: boolean; title: string; description: string }) {
  const color = stable ? colors.primary : colors.danger;
  return (
    <View style={[styles.card, { borderColor: color }]}>
      <Text style={[styles.cardTitle, { color }]}>{title}</Text>
      <Text style={styles.cardText}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  bannerText: {
    ...text.captionStrong,
    color: colors.onBrand,
  },
  bannerMessage: {
    flex: 1,
  },
  card: {
    gap: 4,
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderWidth: 3,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    ...text.display,
    lineHeight: 34,
  },
  cardText: {
    ...text.body,
    color: colors.textSecondary,
  },
});
