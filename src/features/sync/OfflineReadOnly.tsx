import { StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components";
import { colors, radii, spacing, text } from "@/constants/theme";
import { useIsOnline } from "@/services/offline";

/** Plan 10.6 and Figma: the last saved data can be read offline; Add and Edit show disabled. */
export const REQUIRES_CONNECTION = "Requires a connection";

export function OfflineReadOnly({ what }: { what: string }) {
  const online = useIsOnline();
  if (online) return null;
  return (
    <View style={styles.notice} accessibilityRole="text">
      <Icon name="wifi-off" size={16} color={colors.textSecondary} />
      <Text style={styles.text}>You’re offline and seeing saved {what}. Add and Edit are turned off: they require a connection.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  text: { ...text.caption, color: colors.textSecondary, flex: 1 },
});
