import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BottomSheet, Button, FormInput, InlineAlert } from "@/components";
import { colors, radii, spacing, text } from "@/constants/theme";
import { problemText, useCreateProduct } from "./productsData";
import { COMMON_UNITS, EMPTY_PRODUCT, cleanUnit, marginPreview, productPayload, productProblem, toggleUnit, type ProductDraft } from "./productsLogic";

type ProductFormSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSaved: (productId: string, name: string) => void;
};

/** Figma "Products · Add product". */
export function ProductFormSheet({ visible, onClose, onSaved }: ProductFormSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {visible ? <AddProductForm onSaved={onSaved} /> : null}
    </BottomSheet>
  );
}

function AddProductForm({ onSaved }: { onSaved: (productId: string, name: string) => void }) {
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_PRODUCT);
  const [custom, setCustom] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const create = useCreateProduct();
  const set = (key: keyof ProductDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const problem = productProblem(draft);
  const preview = marginPreview(draft.cost_price, draft.selling_price);
  const units = [...COMMON_UNITS, ...draft.units.filter((unit) => !COMMON_UNITS.includes(unit.toLowerCase()))];

  function addCustom() {
    const unit = cleanUnit(custom);
    if (!unit) return;
    if (!draft.units.some((item) => item.toLowerCase() === unit.toLowerCase())) setDraft((current) => toggleUnit(current, unit));
    setCustom("");
    setCustomOpen(false);
  }

  return (
    <>
      <Text style={styles.title} accessibilityRole="header">Add product</Text>
      <FormInput label="Product name" value={draft.product_name} onChangeText={set("product_name")} placeholder="e.g. Bell peppers" autoCapitalize="sentences" maxLength={120} />
      <View style={styles.group}>
        <Text style={styles.label}>Sold by (select multiple or add custom units)</Text>
        <View style={styles.chips}>
          {units.map((unit) => {
            const selected = draft.units.some((item) => item.toLowerCase() === unit.toLowerCase());
            const isDefault = selected && draft.default_unit?.toLowerCase() === unit.toLowerCase();
            return (
              <Pressable
                key={unit}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={isDefault ? `${unit}, default unit` : unit}
                onPress={() => setDraft((current) => toggleUnit(current, unit))}
                style={[styles.unit, selected && styles.unitOn]}
              >
                <Text style={[styles.unitText, selected && styles.unitTextOn]}>{unit}</Text>
              </Pressable>
            );
          })}
          {customOpen ? (
            <View style={styles.customRow}>
              <TextInput value={custom} onChangeText={setCustom} placeholder="e.g. tray" placeholderTextColor={colors.textMuted} style={styles.customInput} maxLength={20} autoFocus onSubmitEditing={addCustom} accessibilityLabel="Custom unit" />
              <Pressable accessibilityRole="button" onPress={addCustom} style={[styles.unit, styles.add]}><Text style={[styles.unitText, styles.addText]}>+ Add</Text></Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setCustomOpen(true)} style={[styles.unit, styles.dashed]}><Text style={styles.unitText}>+ Custom unit</Text></Pressable>
          )}
        </View>
        {draft.units.length > 1 ? <Text style={styles.hint}>Prices are per {draft.default_unit} (the first unit chosen). You can change the default later.</Text> : null}
      </View>
      <View style={styles.row}>
        <View style={styles.flex}><FormInput label="Cost price (₱)" value={draft.cost_price} onChangeText={set("cost_price")} placeholder="0.00" keyboardType="decimal-pad" /></View>
        <View style={styles.flex}><FormInput label="Selling price (₱)" value={draft.selling_price} onChangeText={set("selling_price")} placeholder="0.00" keyboardType="decimal-pad" /></View>
      </View>
      {preview ? <Text style={styles.hint}>{preview.text}{draft.default_unit ? ` · per ${draft.default_unit}` : ""}</Text> : null}
      <View style={styles.row}>
        <View style={styles.flex}><FormInput label="Buying SKU" value={draft.buying_sku} onChangeText={set("buying_sku")} placeholder="e.g. 100011" autoCapitalize="characters" maxLength={40} /></View>
        <View style={styles.flex}><FormInput label="Selling SKU" value={draft.selling_sku} onChangeText={set("selling_sku")} placeholder="e.g. 101011" autoCapitalize="characters" maxLength={40} /></View>
      </View>
      {draft.product_name.trim() && problem ? <Text style={styles.problem}>{problem}</Text> : null}
      {create.isError ? <InlineAlert title="Not added" message={problemText(create.error)} /> : null}
      <Button
        label="Add product"
        size="lg"
        disabled={Boolean(problem)}
        loading={create.isPending}
        onPress={() => create.mutate(productPayload(draft), { onSuccess: (result) => onSaved(result.product_id, result.product_name) })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  title: { ...text.title, color: colors.text },
  group: { gap: spacing.sm },
  label: { ...text.label, color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  unit: { paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  unitOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  unitText: { ...text.captionStrong, color: colors.text },
  unitTextOn: { color: colors.onBrand },
  dashed: { borderStyle: "dashed" },
  add: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  addText: { color: colors.primary },
  customRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  customInput: { ...text.body, color: colors.text, width: 120, height: 36, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10 },
  row: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  hint: { ...text.caption, color: colors.textSecondary },
  problem: { ...text.caption, color: colors.danger },
});
