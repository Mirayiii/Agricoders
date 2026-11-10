import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radii, shadows, text } from "@/constants/theme";
import type { StatusTone } from "@/types/ui";
import { Icon } from "./Icon";
import { StatusBadge } from "./StatusBadge";

/** Figma "Product Row" states. */
export type ProductRowState = "default" | "added" | "unavailable";

type ProductRowProps = {
  name: string;
  /** For example "₱140.00 / kg". */
  priceLabel: string;
  stock?: { label: string; tone: StatusTone };
  state: ProductRowState;
  onAdd?: () => void;
  // Added state only:
  quantity?: string;
  /** Lets staff type a quantity such as 2.5 instead of using the stepper. */
  onQuantityChange?: (value: string) => void;
  onDecrease?: () => void;
  onIncrease?: () => void;
  unit?: string;
  onUnitPress?: () => void;
  unitPrice?: string;
  onUnitPriceChange?: (value: string) => void;
};

/** A product in the New Order list: Default, Added (quantity, unit and price) or Unavailable. */
export function ProductRow(props: ProductRowProps) {
  const { name, priceLabel, stock, state } = props;
  const added = state === "added";

  return (
    <View style={[styles.card, added ? styles.cardAdded : styles.cardDefault]}>
      <View style={styles.text}>
        <Text style={styles.name}>{name}</Text>
        <View style={added ? styles.metaColumn : styles.metaRow}>
          <Text style={styles.price}>{priceLabel}</Text>
          {stock ? <StatusBadge label={stock.label} tone={stock.tone} /> : null}
        </View>
      </View>
      {added ? <AddedControls {...props} /> : <AddButton disabled={state === "unavailable"} onPress={props.onAdd} name={name} />}
    </View>
  );
}

function AddButton({ disabled, onPress, name }: { disabled: boolean; onPress?: () => void; name: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${name}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.add, pressed && styles.addPressed, disabled && styles.disabled]}
    >
      <Icon name="plus" size={16} color={colors.primary} />
      <Text style={styles.addLabel}>Add</Text>
    </Pressable>
  );
}

function AddedControls({ name, quantity = "1", onQuantityChange, onDecrease, onIncrease, unit, onUnitPress, unitPrice, onUnitPriceChange }: ProductRowProps) {
  return (
    <View style={styles.controls}>
      <View style={styles.qtyRow}>
        <View style={styles.stepper}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Less ${name}`} hitSlop={6} onPress={onDecrease} style={[styles.step, styles.stepMinus]}>
            <Icon name="minus" size={14} color={colors.primary} />
          </Pressable>
          {onQuantityChange ? (
            <TextInput
              accessibilityLabel={`${name} quantity`}
              value={quantity}
              onChangeText={onQuantityChange}
              keyboardType="decimal-pad"
              selectTextOnFocus
              style={[styles.qty, styles.qtyInput]}
            />
          ) : <Text style={styles.qty}>{quantity}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel={`More ${name}`} hitSlop={6} onPress={onIncrease} style={[styles.step, styles.stepPlus]}>
            <Icon name="plus" size={14} color={colors.onBrand} />
          </Pressable>
        </View>
        {unit ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Unit, ${unit}`} onPress={onUnitPress} style={styles.unit}>
            <Text style={styles.unitLabel}>{unit}</Text>
            <Icon name="chevron-down" size={12} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {unitPrice !== undefined && !onUnitPriceChange ? (
        // Read-only for roles that cannot change prices.
        <View style={styles.priceRow} accessibilityLabel={`Unit price for ${name}: ₱${unitPrice}, set by the price list`}>
          <Text style={styles.price}>Price: ₱</Text>
          <Text style={[styles.priceInput, styles.priceReadOnly]}>{unitPrice}</Text>
        </View>
      ) : null}
      {onUnitPriceChange ? (
        <View style={styles.priceRow}>
          <Text style={styles.price}>Price: ₱</Text>
          <TextInput
            accessibilityLabel={`Unit price for ${name}`}
            value={unitPrice}
            onChangeText={onUnitPriceChange}
            keyboardType="decimal-pad"
            style={styles.priceInput}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderRadius: radii.lg,
    ...shadows.card,
  },
  cardDefault: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  cardAdded: {
    backgroundColor: colors.background,
    borderColor: colors.primaryMuted,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  name: {
    ...text.bodyStrong,
    color: colors.text,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  metaColumn: {
    gap: 4,
  },
  price: {
    ...text.caption,
    color: colors.textSecondary,
  },
  add: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 14,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  addPressed: {
    backgroundColor: colors.primarySoft,
  },
  addLabel: {
    ...text.label,
    color: colors.primary,
  },
  disabled: {
    opacity: 0.4,
  },
  controls: {
    alignItems: "flex-end",
    gap: 8,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepper: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  step: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  stepMinus: {
    backgroundColor: colors.primarySoft,
  },
  stepPlus: {
    backgroundColor: colors.primary,
  },
  qty: {
    ...text.label,
    color: colors.text,
    minWidth: 28,
    textAlign: "center",
  },
  qtyInput: {
    width: 40,
    minWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 2,
  },
  unit: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 10,
    paddingRight: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  unitLabel: {
    ...text.captionStrong,
    color: colors.text,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  priceReadOnly: {
    backgroundColor: colors.background,
    color: colors.textSecondary,
    lineHeight: 28,
  },
  priceInput: {
    width: 72,
    minHeight: 30,
    paddingVertical: 0,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    textAlign: "right",
    ...text.label,
    color: colors.text,
  },
});
