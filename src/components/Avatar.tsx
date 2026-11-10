import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/constants/theme";
import { initials } from "@/utils/format";

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.text, { fontSize: Math.round(size * 0.35) }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontWeight: "700",
    color: colors.primary,
  },
});
