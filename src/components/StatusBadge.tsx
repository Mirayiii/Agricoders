import { StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";
import type { StatusTone } from "@/types/ui";

/**
 * Figma "Status Badge" tones: Warning, Info, Success, Danger, Neutral.
 * "pending" and "processing" are older names kept for existing screens.
 */
export const STATUS_TONE_COLORS: Record<StatusTone, { background: string; foreground: string }> = {
  warning: { background: colors.warningSoft, foreground: colors.warning },
  info: { background: colors.infoSoft, foreground: colors.info },
  success: { background: colors.successSoft, foreground: colors.success },
  danger: { background: colors.dangerSoft, foreground: colors.danger },
  neutral: { background: colors.surfaceMuted, foreground: colors.textSecondary },
  pending: { background: colors.warningSoft, foreground: colors.warning },
  processing: { background: colors.infoSoft, foreground: colors.info },
};

type StatusBadgeProps = {
  label: string;
  tone?: StatusTone;
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  const palette = STATUS_TONE_COLORS[tone];

  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]}>
      <Text style={[text.overline, { color: palette.foreground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
  },
});
