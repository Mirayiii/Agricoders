import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";
import { freshnessOf, staleMessage } from "@/services/data/staleness";
import { Icon } from "./Icon";

type StaleQuery = {
  data: unknown;
  isRefetchError?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt?: number;
  refetch: () => unknown;
};

/**
 * Shown above saved data when the latest refresh failed, so nobody mistakes
 * it for current data. Renders nothing while the data is current.
 */
export function StaleNotice({ query }: { query: StaleQuery }) {
  const freshness = freshnessOf(query);
  if (!freshness.stale) return null;
  return (
    <View style={styles.notice} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name="wifi-off" size={16} color={colors.warning} />
      <Text style={styles.message}>{staleMessage(freshness.savedAt)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Try refreshing again" hitSlop={10} disabled={query.isFetching} onPress={() => void query.refetch()}>
        <Text style={[styles.action, query.isFetching && styles.busy]}>{query.isFetching ? "Trying…" : "Retry"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSoft,
  },
  message: { ...text.caption, flex: 1, color: colors.text },
  action: { ...text.captionStrong, color: colors.warning },
  busy: { opacity: 0.6 },
});
