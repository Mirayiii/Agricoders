import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing } from "@/constants/theme";

const TONES = {
  success: { background: colors.primarySoft, icon: colors.primary },
  info: { background: colors.infoSoft, icon: colors.info },
  warning: { background: colors.warningSoft, icon: colors.warning },
} as const;

type BannerProps = {
  tone?: keyof typeof TONES;
  icon?: keyof typeof Ionicons.glyphMap;
  children: ReactNode;
};

export function Banner({ tone = "success", icon = "information-circle", children }: BannerProps) {
  const palette = TONES[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.background }]}>
      <Ionicons name={icon} size={18} color={palette.icon} />
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

export function ProgressBar({ value, color = colors.primary }: { value: number; color?: string }) {
  const width = `${Math.max(0, Math.min(100, Math.round(value * 100)))}%` as const;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    gap: 10,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.track,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 3,
  },
});
