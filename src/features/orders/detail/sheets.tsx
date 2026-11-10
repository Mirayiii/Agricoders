import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet, Button, Chip, FormInput, Icon, type IconName } from "@/components";
import { colors, radii, text } from "@/constants/theme";
import { DISCOUNT_REASON_MAX, salesInvoiceProblem } from "../orderMoney";

export type SheetAction = { key: string; label: string; icon: IconName; danger?: boolean; onPress: () => void };

/** Figma "Actions sheet" from the ••• button. */
export function ActionsSheet({ visible, caption, actions, onClose }: { visible: boolean; caption: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.caption}>{caption}</Text>
      <View>
        {actions.map((action) => (
          <Pressable key={action.key} accessibilityRole="button" onPress={action.onPress} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
            <Icon name={action.icon} size={22} color={action.danger ? colors.danger : colors.text} />
            <Text style={[styles.actionLabel, action.danger && styles.danger]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

/** Figma "Cancel confirmation". */
export function CancelSheet({ visible, orderNumber, busy, onConfirm, onClose }: { visible: boolean; orderNumber: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Cancel {orderNumber}?</Text>
      <Text style={styles.body}>This can’t be undone. Staff will see the order as cancelled and it will be removed from preparation and delivery lists.</Text>
      <View style={styles.stack}>
        <Button label="Cancel order" type="destructive" size="lg" loading={busy} onPress={onConfirm} />
        <Button label="Keep order" type="brandOutline" size="lg" onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

type SalesInvoiceProps = {
  caption: string;
  initial: string | null;
  /** Completed order that already has an SI#: replacing or clearing it needs a reason. */
  requireReason?: boolean;
  busy: boolean;
  serverError?: string | null;
  onSave: (value: string, reason: string | null) => void;
  onClose: () => void;
};

/** Figma "Sales invoice (SI#)" sheet. Saving an empty value removes the SI#. */
export function SalesInvoiceSheet({ visible, ...props }: SalesInvoiceProps & { visible: boolean }) {
  return (
    <BottomSheet visible={visible} onClose={props.onClose}>
      {/* Remount on open so the fields start from the saved value. */}
      {visible ? <SalesInvoiceForm {...props} /> : null}
    </BottomSheet>
  );
}

function SalesInvoiceForm({ caption, initial, requireReason, busy, serverError, onSave, onClose }: SalesInvoiceProps) {
  const [value, setValue] = useState(initial ?? "");
  const [reason, setReason] = useState("");
  const unchanged = value.trim() === (initial ?? "");
  const needsReason = Boolean(requireReason) && !unchanged;
  const problem = salesInvoiceProblem(value) ?? null;
  const blocked = Boolean(problem) || unchanged || (needsReason && !reason.trim());
  const save = () => { if (!blocked) onSave(value, needsReason ? reason.trim() : null); };
  return (
    <>
      <View>
        <Text style={styles.title}>Sales Invoice (SI#)</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
      <FormInput
        label="Sales invoice number"
        icon="receipt"
        value={value}
        onChangeText={setValue}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={40}
        placeholder="e.g. 13451"
        returnKeyType="done"
        onSubmitEditing={save}
        error={problem ?? (needsReason ? undefined : serverError ?? undefined)}
        autoFocus
      />
      {initial && !value.trim() ? <Text style={styles.hint}>Saving with an empty field removes the SI#.</Text> : null}
      {requireReason ? (
        <FormInput
          label="Reason for change (required)"
          value={reason}
          onChangeText={setReason}
          maxLength={DISCOUNT_REASON_MAX}
          placeholder="e.g. Wrong invoice number entered"
          error={needsReason ? serverError ?? undefined : undefined}
        />
      ) : null}
      {requireReason ? <Text style={styles.hint}>This order is completed. The old and new SI# are kept in the activity log.</Text> : null}
      <View style={styles.row}>
        <Button label="Cancel" type="muted" size="lg" onPress={onClose} style={styles.flex} />
        <Button label="Save SI#" size="lg" loading={busy} disabled={blocked} onPress={save} style={styles.flex} />
      </View>
    </>
  );
}

const REMOVE_SUGGESTIONS = ["Applied by mistake", "Customer paid full price", "Promo ended"];

/** Removing a discount needs a reason; it is kept in the activity log. */
export function RemoveDiscountSheet({ visible, ...props }: { visible: boolean; caption: string; newTotal: string; busy: boolean; serverError?: string | null; onRemove: (reason: string) => void; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={props.onClose}>
      {visible ? <RemoveDiscountForm {...props} /> : null}
    </BottomSheet>
  );
}

function RemoveDiscountForm({ caption, newTotal, busy, serverError, onRemove, onClose }: { caption: string; newTotal: string; busy: boolean; serverError?: string | null; onRemove: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <>
      <View>
        <Text style={styles.title}>Remove discount?</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
      <Text style={styles.body}>The order total goes back to {newTotal}.</Text>
      <View style={styles.chips}>
        {REMOVE_SUGGESTIONS.map((label) => <Chip key={label} label={label} selected={reason === label} onPress={() => setReason(label)} />)}
      </View>
      <FormInput label="Reason for removing (required)" value={reason} onChangeText={setReason} maxLength={DISCOUNT_REASON_MAX} placeholder="Why is the discount being removed?" error={serverError ?? undefined} />
      <View style={styles.row}>
        <Button label="Keep discount" type="muted" size="lg" onPress={onClose} style={styles.flex} />
        <Button label="Remove" type="destructive" size="lg" loading={busy} disabled={!reason.trim()} onPress={() => onRemove(reason.trim())} style={styles.flex} />
      </View>
    </>
  );
}

const FLAG_SUGGESTIONS = ["Unclear quantity", "Price check", "Customer to confirm"];

export function FlagSheet({ visible, busy, onFlag, onClose }: { visible: boolean; busy: boolean; onFlag: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>What needs checking?</Text>
      <View style={styles.chips}>
        {FLAG_SUGGESTIONS.map((label) => <Chip key={label} label={label} selected={reason === label} onPress={() => setReason(label)} />)}
      </View>
      <FormInput label="Issue" value={reason} onChangeText={setReason} placeholder="Describe the issue" multiline />
      <Button label="Flag order" size="lg" disabled={!reason.trim()} loading={busy} onPress={() => onFlag(reason.trim())} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  caption: { ...text.caption, fontFamily: text.captionStrong.fontFamily, color: colors.textSecondary },
  action: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, paddingHorizontal: 4, borderRadius: radii.sm },
  actionPressed: { backgroundColor: colors.background },
  actionLabel: { ...text.bodyStrong, color: colors.text },
  danger: { color: colors.danger },
  title: { ...text.title, color: colors.text },
  body: { ...text.body, color: colors.textSecondary },
  hint: { ...text.caption, color: colors.textSecondary },
  stack: { gap: 10, paddingTop: 4 },
  row: { flexDirection: "row", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
