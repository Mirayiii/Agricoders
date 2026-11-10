import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components";
import { colors, radii, text } from "@/constants/theme";
import { formatMoney } from "@/utils/format";
import { DISCOUNT_REASON_MAX, discountProblem, parseAmount, previewTotal, type DiscountDraft, type DiscountType } from "../orderMoney";

type DiscountFormProps = {
  subtotal: number;
  initial?: { type: DiscountType; value: number; reason: string } | null;
  busy: boolean;
  /** Message from the server, shown under the form. */
  serverError?: string | null;
  onCancel: () => void;
  onApply: (discount: { type: DiscountType; value: number; reason: string }) => void;
};

const TYPES: { key: DiscountType; label: string }[] = [
  { key: "fixed", label: "₱ Fixed amount" },
  { key: "percent", label: "% Percentage" },
];

/** Figma "Add discount form": inline in the Items card. A reason is required. */
export function DiscountForm({ subtotal, initial, busy, serverError, onCancel, onApply }: DiscountFormProps) {
  const [draft, setDraft] = useState<DiscountDraft>({
    type: initial?.type ?? "fixed",
    valueText: initial ? String(Number(initial.value)) : "",
    reason: initial?.reason ?? "",
  });
  const [touched, setTouched] = useState(false);
  const problem = discountProblem(draft, subtotal);
  const preview = previewTotal(subtotal, draft);
  const shownProblem = touched ? problem : null;

  function apply() {
    setTouched(true);
    const value = parseAmount(draft.valueText);
    if (problem || value === null) return;
    onApply({ type: draft.type, value, reason: draft.reason.trim() });
  }

  return (
    <View style={styles.form}>
      <View style={styles.header}>
        <Text style={styles.title}>{initial ? "Edit Order Discount" : "Add Order Discount"}</Text>
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Discount type</Text>
      <View style={styles.segments} accessibilityRole="radiogroup">
        {TYPES.map((option) => {
          const selected = draft.type === option.key;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setDraft((current) => ({ ...current, type: option.key }))}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{draft.type === "fixed" ? "Discount value (₱)" : "Discount value (%)"}</Text>
        <View style={styles.input}>
          <Text style={styles.affix}>{draft.type === "fixed" ? "₱" : "%"}</Text>
          <TextInput
            value={draft.valueText}
            onChangeText={(valueText) => setDraft((current) => ({ ...current, valueText }))}
            keyboardType="decimal-pad"
            placeholder={draft.type === "fixed" ? "500" : "10"}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={draft.type === "fixed" ? "Discount value in pesos" : "Discount percentage"}
            style={styles.inputText}
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Reason for discount (required)</Text>
        <View style={styles.input}>
          <TextInput
            value={draft.reason}
            onChangeText={(reason) => setDraft((current) => ({ ...current, reason }))}
            maxLength={DISCOUNT_REASON_MAX}
            placeholder="e.g. Late delivery, Quality issue, Promo"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Reason for discount"
            style={styles.inputText}
          />
        </View>
      </View>

      {preview && !problem ? (
        <Text style={styles.preview}>New total {formatMoney(preview.total)} ({formatMoney(preview.discount)} off)</Text>
      ) : null}
      {shownProblem || serverError ? <Text style={styles.error} accessibilityRole="alert">{shownProblem ?? serverError}</Text> : null}

      <Button label="Apply discount" onPress={apply} loading={busy} disabled={touched && Boolean(problem)} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "center" },
  title: { ...text.label, flex: 1, color: colors.text },
  cancel: { ...text.captionStrong, color: colors.textSecondary },
  label: { ...text.overline, color: colors.textSecondary },
  segments: { flexDirection: "row", gap: 3, padding: 3, borderRadius: radii.sm, backgroundColor: colors.surfaceMuted },
  segment: { flex: 1, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 6, paddingHorizontal: 8 },
  segmentSelected: { backgroundColor: colors.primary },
  segmentLabel: { ...text.captionStrong, color: colors.textSecondary },
  segmentLabelSelected: { color: colors.onBrand },
  field: { gap: 6 },
  input: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  affix: { ...text.body, color: colors.text },
  inputText: { ...text.body, flex: 1, color: colors.text, paddingVertical: 12 },
  preview: { ...text.caption, color: colors.textSecondary },
  error: { ...text.caption, color: colors.danger },
});
