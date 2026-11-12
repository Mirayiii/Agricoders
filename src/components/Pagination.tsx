import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, text } from "@/constants/theme";
import { pageCount, pageItems } from "@/utils/pagination";
import { Icon } from "./Icon";

type PaginationProps = {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  /** What the list holds, for screen readers ("orders", "products"). */
  label?: string;
};

/**
 * Prototype "Compact Pagination Bar": previous, page numbers, next. Figma has
 * no pagination, so this is built from the Figma chip tokens (radius, brand
 * fill for the current page) and the Figma chevron icons. Hidden when
 * everything fits on one page.
 */
export function Pagination({ page, total, pageSize, onChange, label = "items" }: PaginationProps) {
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;
  const current = Math.min(Math.max(1, page), pages);
  const first = (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);
  return (
    <View style={styles.wrap}>
      <View style={styles.bar} accessibilityRole="toolbar" accessibilityLabel={`Pages of ${label}`}>
        <Arrow icon="chevron-left" label="Previous page" disabled={current === 1} onPress={() => onChange(current - 1)} />
        {pageItems(current, pages).map((item) =>
          item.kind === "gap" ? (
            <Text key={item.key} style={styles.gap} accessibilityElementsHidden importantForAccessibility="no">…</Text>
          ) : (
            <Pressable
              key={item.page}
              accessibilityRole="button"
              accessibilityLabel={`Page ${item.page}`}
              accessibilityState={{ selected: item.current }}
              onPress={() => onChange(item.page)}
              style={({ pressed }) => [styles.page, item.current && styles.pageCurrent, pressed && !item.current && styles.pressed]}
            >
              <Text style={[styles.pageText, item.current && styles.pageTextCurrent]}>{item.page}</Text>
            </Pressable>
          ),
        )}
        <Arrow icon="chevron-right" label="Next page" disabled={current === pages} onPress={() => onChange(current + 1)} />
      </View>
      <Text style={styles.range}>{first}–{last} of {total} {label}</Text>
    </View>
  );
}

function Arrow({ icon, label, disabled, onPress }: { icon: "chevron-left" | "chevron-right"; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.page, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Icon name={icon} size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.sm },
  bar: { flexDirection: "row", alignItems: "center", gap: 6 },
  page: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  pageText: { ...text.label, color: colors.text },
  pageTextCurrent: { color: colors.onBrand },
  gap: { ...text.label, color: colors.textMuted, paddingHorizontal: 2 },
  disabled: { opacity: 0.35 },
  pressed: { backgroundColor: colors.background },
  range: { ...text.caption, color: colors.textMuted },
});
