import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet, Button, FormInput, Icon, InlineAlert } from "@/components";
import { colors, spacing, text } from "@/constants/theme";
import { DataError } from "@/services/data";
import { useSaveCustomer } from "./customersData";
import { draftChanged, draftFrom, draftProblem, type CustomerDraft } from "./customersLogic";

type Editable = Partial<Record<keyof CustomerDraft, string | null>> & { id: string };

type CustomerFormSheetProps = {
  visible: boolean;
  customer?: Editable | null;
  onClose: () => void;
  onSaved: (customerId: string, name: string) => void;
};

/** Figma "Add customer" and "Edit Customer Details", plus the CU-01 business type and delivery window. */
export function CustomerFormSheet({ visible, customer, onClose, onSaved }: CustomerFormSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {visible ? <CustomerForm key={customer?.id ?? "new"} customer={customer ?? null} onSaved={onSaved} onClose={onClose} /> : null}
    </BottomSheet>
  );
}

function problemText(error: unknown): string {
  if (error instanceof DataError && error.code) return error.message;
  if (error instanceof Error && /fetch|network/i.test(error.message)) return "Couldn’t reach the server. Nothing was saved twice: try again.";
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function CustomerForm({ customer, onSaved, onClose }: { customer: Editable | null; onSaved: (customerId: string, name: string) => void; onClose: () => void }) {
  const original = draftFrom(customer);
  const [draft, setDraft] = useState<CustomerDraft>(original);
  const save = useSaveCustomer();
  const field = (key: keyof CustomerDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const problem = draftProblem(draft);
  const editing = customer !== null;
  const canSave = !problem && (!editing || draftChanged(draft, original));

  function submit() {
    if (problem) return;
    save.mutate(
      { customerId: customer?.id ?? null, draft },
      { onSuccess: (result) => onSaved(result.customer_id, result.brand_name || result.business_name) },
    );
  }

  return (
    <>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.title} accessibilityRole="header">{editing ? "Edit Customer Details" : "Add customer"}</Text>
          {editing ? <Text style={styles.subtitle}>Update contact and delivery information</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={styles.close}>
          <Icon name="x" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.row}>
        <View style={styles.code}>
          <FormInput label="Code" value={draft.customer_code} onChangeText={field("customer_code")} placeholder="Required" autoCapitalize="characters" maxLength={40} />
        </View>
        <View style={styles.flex}>
          <FormInput label="Business name" value={draft.business_name} onChangeText={field("business_name")} placeholder="Required" autoCapitalize="words" maxLength={160} />
        </View>
      </View>
      <FormInput label="Brand name" value={draft.brand_name} onChangeText={field("brand_name")} placeholder="Optional" autoCapitalize="words" maxLength={160} />
      <FormInput label="TIN#" value={draft.tin} onChangeText={field("tin")} placeholder="Optional (e.g. 123-456-789-000)" keyboardType="numbers-and-punctuation" autoCapitalize="none" maxLength={40} />
      <FormInput label="Contact person" value={draft.contact_person} onChangeText={field("contact_person")} placeholder="e.g. Mark Reyes" autoCapitalize="words" maxLength={120} />
      <FormInput label="Phone" value={draft.phone} onChangeText={field("phone")} placeholder="Optional (e.g. 0917 555 0142)" keyboardType="phone-pad" maxLength={40} />
      <FormInput label="Email" value={draft.email} onChangeText={field("email")} placeholder="Optional (e.g. orders@customer.ph)" keyboardType="email-address" autoCapitalize="none" maxLength={160} />
      <FormInput label="Delivery address" value={draft.delivery_address} onChangeText={field("delivery_address")} placeholder="Street, Barangay, City" maxLength={300} />
      {save.isError ? <InlineAlert title="Not saved" message={problemText(save.error)} /> : null}
      <Button label={editing ? "Save changes" : "Add customer"} size="lg" onPress={submit} disabled={!canSave} loading={save.isPending} />
      {editing ? <Button label="Cancel" type="muted" size="lg" onPress={onClose} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  title: { ...text.title, color: colors.text },
  subtitle: { ...text.caption, color: colors.textSecondary, marginTop: 2 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", gap: spacing.sm },
  code: { width: 130 },
  flex: { flex: 1, minWidth: 0 },
});
