import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { colors, typography } from "@/constants/theme";
import { PressableCard } from "./PressableCard";

type StatTileProps = {
  label: string;
  value: number | string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBackground: string;
  iconColor: string;
  onPress: () => void;
};

export function StatTile({ label, value, icon, iconBackground, iconColor, onPress }: StatTileProps) {
  return (
    <PressableCard onPress={onPress} accessibilityLabel={`${label}: ${value}`} style={styles.tile}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: iconBackground }]}>
          <Ionicons name={icon} size={19} color={iconColor} />
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.borderStrong} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    padding: 14,
    gap: 6,
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    ...typography.stat,
    color: colors.text,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
  },
});
