import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { colors, radii, text } from "@/constants/theme";

/** Home header from Figma: logo, "MEAH Management" and the bell with an unread dot. */
export function HomeHeader({ unread }: { unread: number }) {
  return (
    <View style={styles.header}>
      <Logo size={40} />
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>MEAH Management</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}
        onPress={() => router.push("/notifications")}
        hitSlop={4}
        style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
      >
        <Icon name="bell" size={20} color={colors.text} />
        {unread ? <View style={styles.dot} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  title: { ...text.title, color: colors.text, flex: 1 },
  bell: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: colors.surfacePressed },
  dot: { position: "absolute", top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.badge, borderWidth: 1, borderColor: colors.surface },
});
