import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Icon, type IconName, StatusBadge } from "@/components";
import { colors, radii, spacing, text } from "@/constants/theme";
import type { OrderStatus } from "@/types/orders";
import { formatMoney, formatQuantity, plural } from "@/utils/format";
import { ORDER_FLOW, ORDER_FLOW_LABELS, ORDER_STATUS_META } from "../status";
import type { NextStep } from "./nextStep";

// Order detail sections, one per Figma block (task 3.3).

export function DetailHeader({ title, onBack, onMore }: { title: string; onBack: () => void; onMore?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
      <RoundButton icon="arrow-left" label="Go back" onPress={onBack} />
      <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
      {onMore ? <RoundButton icon="more" label="More actions" onPress={onMore} /> : <View style={styles.roundButton} />}
    </View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={4} onPress={onPress} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
      <Icon name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

export function OrderSummary({ status, when, source, customer, itemCount, total }: { status: OrderStatus; when: string; source: string; customer: string; itemCount: number; total: number }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <View style={styles.summary}>
      <View style={styles.summaryStatus}>
        <StatusBadge label={meta.label} tone={meta.tone} />
        <Text style={styles.caption}>Delivery {when} · via {source}</Text>
      </View>
      <Text style={styles.customerName}>{customer}</Text>
      <Text style={styles.summaryLine}>{plural(itemCount, "item")} · <Text style={styles.summaryTotal}>{formatMoney(total)}</Text></Text>
    </View>
  );
}

export function AttentionBanner({ reason, onResolve }: { reason: string; onResolve?: () => void }) {
  return (
    <View style={styles.attention} accessibilityRole="alert">
      <Icon name="alert-circle" size={18} color={colors.warning} />
      <View style={styles.flex}>
        <Text style={styles.attentionTitle}>Needs attention</Text>
        <Text style={styles.attentionText}>{reason}</Text>
      </View>
      {onResolve ? (
        <Pressable accessibilityRole="button" onPress={onResolve} style={({ pressed }) => [styles.resolve, pressed && styles.pressed]}>
          <Text style={styles.resolveText}>Resolved</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CancelledBanner() {
  return (
    <View style={styles.cancelled}>
      <Icon name="x-circle" size={18} color={colors.danger} />
      <Text style={styles.cancelledText}>This order was cancelled and is locked.</Text>
    </View>
  );
}

/** Five-step tracker with the "Next step" box. */
export function ProgressCard({ status, next }: { status: OrderStatus; next: NextStep }) {
  const at = ORDER_FLOW.indexOf(status);
  const last = ORDER_FLOW_LABELS.length - 1;
  return (
    <View style={[styles.card, styles.progress]}>
      <View style={styles.stepper} accessibilityLabel={`Step ${at + 1} of ${ORDER_FLOW_LABELS.length}: ${ORDER_FLOW_LABELS[at]}`}>
        <View style={styles.track} />
        {at > 0 ? <View style={[styles.trackDone, { width: `${(Math.min(at, last) / last) * 80}%` }]} /> : null}
        {ORDER_FLOW_LABELS.map((label, index) => {
          const done = index <= at;
          return (
            <View key={label} style={styles.step}>
              <View style={[styles.dot, done && styles.dotDone]}>
                {done ? <Icon name="check" size={14} color={colors.onBrand} /> : null}
              </View>
              <Text style={[styles.stepLabel, index < at && styles.stepPast, index === at && styles.stepCurrent]}>{label}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.next}>
        <View style={styles.nextIcon}><Icon name="arrow-right" size={11} color={colors.onBrand} /></View>
        <View style={styles.flex}>
          <Text style={styles.label}>Next step</Text>
          <Text style={styles.body}>{next.text}</Text>
        </View>
      </View>
    </View>
  );
}

export function SectionCard({ title, right, children, style }: { title?: string; right?: ReactNode; children: ReactNode; style?: object }) {
  return (
    <View style={[styles.card, styles.section, style]}>
      {title ? (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function InfoRow({ label, value, action }: { label: string; value: string; action?: { icon: IconName; label: string; onPress: () => void } }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.flex}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.body}>{value}</Text>
      </View>
      {action ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={4} style={({ pressed }) => [styles.softButton, pressed && styles.pressed]}>
          <Icon name={action.icon} size={20} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function TextLink({ icon, label, onPress, tone = "brand", accessibilityLabel }: { icon?: IconName; label: string; onPress: () => void; tone?: "brand" | "muted" | "danger"; accessibilityLabel?: string }) {
  const color = tone === "danger" ? colors.danger : tone === "muted" ? colors.textSecondary : colors.primary;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} hitSlop={10} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Text style={[styles.linkText, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** Figma "Sales Invoice" card. */
export function SalesInvoiceCard({ value, onEdit }: { value: string | null; onEdit?: () => void }) {
  return (
    <View style={[styles.card, styles.invoice]}>
      <View style={styles.iconTile}><Icon name="receipt" size={20} color={colors.textSecondary} /></View>
      <View style={styles.flex}>
        <Text style={styles.label}>Sales Invoice</Text>
        <Text style={[styles.body, !value && styles.placeholder]}>{value ? `SI#: ${value}` : "SI#: Tap Add to record it"}</Text>
      </View>
      {onEdit ? <TextLink icon={value ? "edit" : "plus"} label={value ? "Edit" : "Add"} accessibilityLabel={value ? "Edit sales invoice number" : "Add sales invoice number"} onPress={onEdit} /> : null}
    </View>
  );
}

export type LineView = { id: string; name: string; quantity: number; unit: string; unitPrice: number; lineTotal: number };

export function ItemLines({ lines }: { lines: LineView[] }) {
  return (
    <>
      {lines.map((line) => (
        <View key={line.id}>
          <View style={styles.divider} />
          <View style={styles.line}>
            <View style={styles.flex}>
              <Text style={styles.lineName}>{line.name}</Text>
              <Text style={styles.caption}>{formatQuantity(line.quantity)} {line.unit} × {formatMoney(line.unitPrice)}</Text>
            </View>
            <Text style={styles.lineTotal}>{formatMoney(line.lineTotal)}</Text>
          </View>
        </View>
      ))}
      <View style={styles.divider} />
    </>
  );
}

export function SubtotalRow({ subtotal, muted }: { subtotal: number; muted: boolean }) {
  return (
    <View style={[styles.moneyRow, styles.subtotalRow]}>
      <Text style={styles.subtotalLabel}>Subtotal</Text>
      <Text style={muted ? styles.subtotalMuted : styles.subtotalValue}>{formatMoney(subtotal)}</Text>
    </View>
  );
}

export function TotalRow({ total }: { total: number }) {
  return (
    <>
      <View style={styles.divider} />
      <View style={[styles.moneyRow, styles.totalRow]}>
        <Text style={styles.totalLabel}>Order total</Text>
        <Text style={styles.totalValue} accessibilityLabel={`Order total ${formatMoney(total)}`}>{formatMoney(total)}</Text>
      </View>
    </>
  );
}

/** Applied discount: amount in red, Edit and Remove when it can still change, and the reason. */
export function DiscountRow({ amount, label, reason, onEdit, onRemove, busy }: { amount: number; label: string; reason: string | null; onEdit?: () => void; onRemove?: () => void; busy?: boolean }) {
  return (
    <View style={styles.discount}>
      <View style={styles.discountRow}>
        <Text style={styles.discountLabel}>Discount</Text>
        {onEdit ? <TextLink label="Edit" tone="muted" accessibilityLabel="Edit discount" onPress={onEdit} /> : null}
        {onRemove ? <TextLink label={busy ? "Removing…" : "Remove"} tone="danger" accessibilityLabel="Remove discount" onPress={onRemove} /> : null}
        <View style={styles.flex} />
        <Text style={styles.discountAmount} accessibilityLabel={`Discount ${label}, minus ${formatMoney(amount)}`}>-{formatMoney(amount)}</Text>
      </View>
      {reason ? <Text style={styles.reason}>Reason: {reason}</Text> : null}
    </View>
  );
}

export function AddDiscountButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.addDiscountWrap}>
      <Button label="Add Discount" type="secondary" icon="tag" onPress={onPress} style={styles.addDiscount} />
    </View>
  );
}

export type ActivityView = { id: string; text: string; meta: string; icon: IconName };

export function ActivityCard({ items }: { items: ActivityView[] }) {
  return (
    <SectionCard title="Activity">
      {items.length ? items.map((item) => (
        <View key={item.id} style={styles.event}>
          <View style={styles.eventIcon}><Icon name={item.icon} size={16} color={colors.primary} /></View>
          <View style={styles.flex}>
            <Text style={styles.eventText}>{item.text}</Text>
            <Text style={styles.caption}>{item.meta}</Text>
          </View>
        </View>
      )) : <Text style={styles.caption}>No activity recorded.</Text>}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, backgroundColor: colors.background },
  headerTitle: { ...text.title, flex: 1, color: colors.text },
  roundButton: { width: 40, height: 40, borderRadius: radii.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  summary: { gap: 4 },
  summaryStatus: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", paddingBottom: 4 },
  customerName: { ...text.display, color: colors.text },
  summaryLine: { ...text.bodyMedium, fontFamily: text.body.fontFamily, color: colors.textSecondary },
  summaryTotal: { ...text.bodyStrong, color: colors.text },
  caption: { ...text.caption, color: colors.textSecondary },
  label: { ...text.overline, color: colors.textSecondary },
  body: { ...text.body, color: colors.text },
  placeholder: { color: colors.textMuted },
  attention: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: radii.lg, backgroundColor: colors.warningSoft },
  attentionTitle: { ...text.label, color: colors.warning },
  attentionText: { ...text.body, color: colors.text, marginTop: 2 },
  resolve: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surface, justifyContent: "center" },
  resolveText: { ...text.captionStrong, color: colors.warning },
  cancelled: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: radii.lg, backgroundColor: colors.dangerSoft },
  cancelledText: { ...text.label, flex: 1, color: colors.danger },
  card: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  progress: { padding: 16, gap: 14 },
  stepper: { flexDirection: "row" },
  track: { position: "absolute", top: 11, left: "10%", right: "10%", height: 2, backgroundColor: colors.borderStrong },
  trackDone: { position: "absolute", top: 11, left: "10%", height: 2, backgroundColor: colors.primary },
  step: { flex: 1, alignItems: "center", gap: 6 },
  dot: { width: 24, height: 24, borderRadius: radii.full, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  dotDone: { borderColor: colors.primary, backgroundColor: colors.primary },
  stepLabel: { ...text.overline, color: colors.textMuted },
  stepPast: { color: colors.textSecondary },
  stepCurrent: { fontFamily: text.micro.fontFamily, color: colors.text },
  next: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: radii.md, backgroundColor: colors.background },
  nextIcon: { width: 22, height: 22, borderRadius: radii.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  section: { padding: 16, gap: 12 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { ...text.heading, flex: 1, color: colors.text },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  softButton: { width: 40, height: 40, borderRadius: radii.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  link: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkText: { ...text.captionStrong },
  invoice: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingLeft: 12, paddingRight: 16 },
  iconTile: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  divider: { height: 1, backgroundColor: colors.border },
  line: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  lineName: { ...text.bodyStrong, color: colors.text },
  lineTotal: { ...text.label, color: colors.text },
  moneyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  subtotalRow: { paddingTop: 12, paddingBottom: 4 },
  subtotalLabel: { ...text.body, color: colors.textSecondary },
  subtotalValue: { ...text.bodyMedium, color: colors.text },
  subtotalMuted: { ...text.body, color: colors.textMuted },
  totalRow: { paddingTop: 12 },
  totalLabel: { ...text.bodyStrong, color: colors.text },
  totalValue: { ...text.title, color: colors.primary },
  discount: { gap: 2, paddingTop: 4, paddingBottom: 12 },
  discountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  discountLabel: { ...text.bodyMedium, color: colors.danger },
  discountAmount: { ...text.label, color: colors.danger },
  reason: { ...text.caption, fontStyle: "italic", color: colors.textSecondary },
  addDiscountWrap: { paddingTop: 4, paddingBottom: 12 },
  addDiscount: { minHeight: 36, borderWidth: 1, borderColor: colors.primaryMuted, borderRadius: 10 },
  event: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  eventIcon: { width: 32, height: 32, borderRadius: radii.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  eventText: { ...text.bodyMedium, color: colors.text },
});

/** Figma "Delivery receipt" card, under the Sales Invoice card. */
export function DeliveryReceiptCard({ label, onOpen, onIssue, busy }: { label: string | null; onOpen?: () => void; onIssue?: () => void; busy?: boolean }) {
  return (
    <View style={[styles.card, styles.invoice]}>
      <View style={styles.iconTile}><Icon name="file-text" size={20} color={colors.textSecondary} /></View>
      <View style={styles.flex}>
        <Text style={styles.label}>Delivery receipt</Text>
        <Text style={[styles.body, !label && styles.placeholder]}>{label ? `DR No. ${label} · PDF` : busy ? "Issuing…" : "Not issued yet"}</Text>
      </View>
      {label && onOpen ? <TextLink icon="eye" label="View" accessibilityLabel={`View delivery receipt ${label}`} onPress={onOpen} /> : null}
      {!label && onIssue ? <TextLink icon="plus" label="Issue" accessibilityLabel="Issue delivery receipt" onPress={onIssue} /> : null}
    </View>
  );
}
