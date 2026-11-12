import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";
import { Icon } from "./Icon";
import { StatusBadge } from "./StatusBadge";

type PackItemProps = {
  name: string;
  quantity: string;
  packed: boolean;
  /** Line note from the order, shown under the name. */
  note?: string | null;
  /** The note was changed after packing started: shown with a "Note changed" badge until the line is ticked again. */
  noteChanged?: boolean;
  onToggle?: (packed: boolean) => void;
};

/** Figma "Pack Item" (To pack, Packed): one line of a packing checklist. */
export function PackItem({ name, quantity, packed, note, noteChanged, onToggle }: PackItemProps) {
  const color = packed ? colors.textMuted : colors.text;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${name}, ${quantity}${noteChanged ? ", note changed" : ""}${note ? `, ${note}` : ""}`}
      accessibilityState={{ checked: packed, disabled: !onToggle }}
      disabled={!onToggle}
      onPress={() => onToggle?.(!packed)}
      style={styles.row}
    >
      <View style={[styles.circle, packed ? styles.circlePacked : styles.circleOpen]}>
        {packed ? <Icon name="check" size={16} color={colors.onBrand} /> : null}
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, { color }]}>{name}</Text>
        {noteChanged ? <View style={styles.badge}><StatusBadge label="Note changed" tone="warning" /></View> : null}
        {note ? <Text style={styles.note} numberOfLines={2}>{note}</Text> : null}
      </View>
      <Text style={[styles.quantity, { color }]}>{quantity}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
  },
  circle: {
    width: 26,
    height: 26,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  circleOpen: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  circlePacked: {
    backgroundColor: colors.primary,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    ...text.bodyMedium,
  },
  note: {
    ...text.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  badge: {
    flexDirection: "row",
    marginTop: 4,
  },
  quantity: {
    ...text.label,
  },
});
