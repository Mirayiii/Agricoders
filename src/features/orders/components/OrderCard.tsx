import { StyleSheet, Text, View } from "react-native";

import { Icon, PressableCard, StatusBadge } from "@/components";
import { colors, radii, text } from "@/constants/theme";
import type { OrderStatus } from "@/types/orders";
import { dayLabel, formatMoney, plural } from "@/utils/format";
import { ORDER_STATUS_META, isFlagged } from "../status";

export type OrderCardData = {
  order_number: string;
  customer: string;
  status: OrderStatus;
  requested_delivery_date: string;
  item_count: number;
  total: number;
  requires_attention: boolean;
  attention_reason: string | null;
};

/** Figma "Order Card": ID, customer, status, date · items · total, and an optional issue note. */
export function OrderCard({ order, onPress }: { order: OrderCardData; onPress: () => void }) {
  const meta = ORDER_STATUS_META[order.status];
  const flagged = isFlagged(order);
  return (
    <PressableCard
      onPress={onPress}
      accessibilityLabel={`${order.order_number}, ${order.customer}, ${meta.label}, ${formatMoney(order.total)}${flagged ? ", needs attention" : ""}`}
      style={styles.card}
    >
      <View style={styles.header}>
        <View style={styles.title}>
          <Text style={styles.number}>{order.order_number}</Text>
          <Text style={styles.customer} numberOfLines={1}>{order.customer}</Text>
        </View>
        <StatusBadge label={meta.label} tone={meta.tone} />
      </View>
      <View style={styles.meta}>
        <Icon name="calendar" size={15} color={colors.textSecondary} />
        <Text style={styles.metaText}>{dayLabel(order.requested_delivery_date)}</Text>
        <Text style={styles.dot}>·</Text>
        <Text style={styles.metaText}>{plural(order.item_count, "item")}</Text>
        <Text style={styles.dot}>·</Text>
        <Text style={styles.total}>{formatMoney(order.total)}</Text>
      </View>
      {flagged ? (
        <View style={styles.note}>
          <Icon name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.noteText}>{order.attention_reason ?? "Needs checking"}</Text>
        </View>
      ) : null}
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, padding: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, minWidth: 0, gap: 2 },
  number: { ...text.overline, color: colors.primary },
  customer: { ...text.bodyStrong, color: colors.text },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  metaText: { ...text.caption, color: colors.textSecondary },
  dot: { ...text.caption, color: colors.textMuted },
  total: { ...text.captionStrong, color: colors.text },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radii.sm, backgroundColor: colors.dangerSoft },
  noteText: { ...text.captionStrong, flex: 1, color: colors.danger },
});
