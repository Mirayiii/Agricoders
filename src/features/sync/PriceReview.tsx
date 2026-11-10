import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components";
import { colors, radii, spacing, text } from "@/constants/theme";
import type { PriceChange } from "@/services/offline";
import { formatMoney } from "@/utils/format";

/**
 * Prices changed between entering a new order and saving it (D-OF1): nothing
 * was saved. The person sees old and new prices and chooses to save at
 * today's prices or go back and check the order.
 */
export function PriceReview({ changes, busy, onAccept, onBack }: { changes: PriceChange[]; busy: boolean; onAccept: () => void; onBack: () => void }) {
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">Prices changed</Text>
      <Text style={styles.body}>Some prices changed after this order was entered, so it hasn’t been saved yet. Check the new prices before saving.</Text>
      <View style={styles.list}>
        {changes.map((row) => (
          <View key={`${row.product_id}:${row.unit}`} style={styles.row} accessible accessibilityLabel={`${row.product_name ?? "Item"} per ${row.unit}: was ${formatMoney(row.seen_price)}, now ${formatMoney(row.current_price)}`}>
            <Text style={styles.name}>{row.product_name ?? "Item"} <Text style={styles.unit}>({row.unit})</Text></Text>
            <Text style={styles.prices}><Text style={styles.old}>{formatMoney(row.seen_price)}</Text>  →  <Text style={styles.now}>{formatMoney(row.current_price)}</Text></Text>
          </View>
        ))}
      </View>
      <Button label="Save at current prices" size="lg" loading={busy} onPress={onAccept} />
      <Button label="Go back and check" type="secondary" size="lg" onPress={onBack} />
    </>
  );
}

const styles = StyleSheet.create({
  title: { ...text.title, color: colors.text },
  body: { ...text.body, color: colors.textSecondary },
  list: { borderRadius: radii.md, backgroundColor: colors.background, paddingHorizontal: spacing.md },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { ...text.bodyStrong, color: colors.text, flex: 1 },
  unit: { ...text.caption, color: colors.textSecondary },
  prices: { ...text.body, color: colors.text },
  old: { color: colors.textSecondary, textDecorationLine: "line-through" },
  now: { ...text.bodyStrong, color: colors.text },
});
