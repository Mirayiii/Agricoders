import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, shadows, text } from "@/constants/theme";
import type { StatusTone } from "@/types/ui";
import { Icon } from "./Icon";
import { STATUS_TONE_COLORS, StatusBadge } from "./StatusBadge";

type StockCardProps = {
  name: string;
  /** For example "100001 · per kg". */
  detail: string;
  /** Left out for staff who can't see prices. */
  price?: string;
  /** For example "27% margin". */
  margin?: string;
  /** Tracked type only: stock figures. Without it the card is the Simple type. */
  stock?: {
    badge: { label: string; tone: StatusTone };
    value: string;
    /** 0 to 1, how full the level bar is. */
    level: number;
    /** Colour of the value and bar. Figma shows Danger for low stock. */
    tone: StatusTone;
  };
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Archived products: dimmed. */
  muted?: boolean;
};

/** Figma "Stock Card" (Simple, Tracked) for the Products and Stock list. */
export function StockCard({ name, detail, price, margin, stock, onPress, accessibilityLabel, muted = false }: StockCardProps) {
  const marginPill = margin ? (
    <View style={styles.margin}>
      <Text style={styles.marginText}>{margin}</Text>
    </View>
  ) : null;

  return (
    <Pressable accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={accessibilityLabel} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.card, muted && styles.muted, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={styles.title}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>
        {stock ? (
          <StatusBadge label={stock.badge.label} tone={stock.badge.tone} />
        ) : (
          price ? (
            <View style={styles.priceColumn}>
              <Text style={styles.price}>{price}</Text>
              {marginPill}
            </View>
          ) : null
        )}
        <Icon name="chevron-right" size={20} color={colors.textMuted} />
      </View>
      {stock ? (
        <>
          <View style={styles.divider} />
          <View style={styles.figures}>
            {price ? (
              <View style={styles.figure}>
                <Text style={styles.figureLabel}>Price</Text>
                <View style={styles.valueRow}>
                  <Text style={styles.price}>{price}</Text>
                  {marginPill}
                </View>
              </View>
            ) : null}
            <View style={styles.figure}>
              <Text style={styles.figureLabel}>In stock</Text>
              <Text style={[styles.price, { color: STATUS_TONE_COLORS[stock.tone].foreground }]}>{stock.value}</Text>
              <View style={styles.level}>
                <View
                  style={[
                    styles.levelFill,
                    {
                      width: `${Math.round(Math.max(0, Math.min(1, stock.level)) * 100)}%`,
                      backgroundColor: STATUS_TONE_COLORS[stock.tone].foreground,
                    },
                  ]}
                />
              </View>
            </View>
          </View>
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  muted: { opacity: 0.7 },
  pressed: { backgroundColor: colors.surfacePressed },
  top: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  title: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...text.bodyStrong,
    color: colors.text,
  },
  detail: {
    ...text.caption,
    color: colors.textSecondary,
  },
  priceColumn: {
    alignItems: "flex-end",
    gap: 4,
  },
  price: {
    ...text.bodyStrong,
    color: colors.text,
  },
  margin: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: colors.primarySoft,
  },
  marginText: {
    ...text.overline,
    color: colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  figures: {
    flexDirection: "row",
    gap: 16,
  },
  figure: {
    flex: 1,
    gap: 4,
  },
  figureLabel: {
    ...text.overline,
    color: colors.textSecondary,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  level: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  levelFill: {
    height: 4,
    borderRadius: 2,
  },
});
