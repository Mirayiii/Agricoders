import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { Button } from "@/components/Button";
import { FormInput } from "@/components/FormInput";
import { Icon } from "@/components/Icon";
import { InlineAlert } from "@/components/InlineAlert";
import { useToast } from "@/components/Toast";
import { colors, spacing, text } from "@/constants/theme";
import { useAuth } from "@/features/auth/useAuth";
import type { AuthMessage } from "../staffAuthApi";
import { passwordAcceptable, PasswordRulesList } from "./PasswordRulesList";

type Props = { visible: boolean; onClose: () => void };

/**
 * Figma "Change password" sheet over Settings. Staff have no email, so this
 * replaces the old emailed reset link. The password rules list is not in the
 * Figma frame; it is kept because the 8-character rule needs to be visible.
 */
export function ChangePasswordSheet({ visible, onClose }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {visible ? <ChangePasswordForm onClose={onClose} /> : null}
    </BottomSheet>
  );
}

function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const { changePassword } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AuthMessage | null>(null);

  const sameAsCurrent = next.length > 0 && next === current;
  const confirmError = confirm.length > 0 && confirm !== next ? "Passwords do not match" : undefined;
  const canSave = current.length > 0 && passwordAcceptable(next, sameAsCurrent) && confirm === next;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setAlert(null);
    const outcome = await changePassword(next, current);
    setSaving(false);
    if (outcome.ok) {
      toast({ title: "Password changed", message: "You stay signed in here. Other devices were signed out.", tone: "positive" });
      onClose();
    } else if (!outcome.signedOut) {
      setAlert(outcome.message);
      if (outcome.message.title.startsWith("Current")) setCurrent("");
    }
  }

  return (
    <>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.title} accessibilityRole="header">Change password</Text>
          <Text style={styles.subtitle}>Update your personal account login password.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={styles.close}>
          <Icon name="x" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      {alert ? <InlineAlert title={alert.title} message={alert.message} /> : null}
      <FormInput label="Current password" value={current} onChangeText={setCurrent} placeholder="Enter current password" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" />
      <FormInput label="New password" value={next} onChangeText={setNext} placeholder="Enter new password (min. 8 characters)" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" />
      <FormInput label="Confirm new password" value={confirm} onChangeText={setConfirm} error={confirmError} placeholder="Re-type new password" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="done" onSubmitEditing={save} />
      {next.length > 0 ? <PasswordRulesList password={next} sameAsOld={sameAsCurrent} differentLabel="Not your current password" /> : null}
      <View style={styles.actions}>
        <Button label="Cancel" type="muted" size="lg" onPress={onClose} style={styles.action} />
        <Button label="Update password" size="lg" onPress={save} loading={saving} disabled={!canSave} style={styles.action} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  title: { ...text.title, color: colors.text },
  subtitle: { ...text.caption, color: colors.textSecondary, marginTop: 2 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: spacing.md },
  action: { flex: 1, minWidth: 0, paddingHorizontal: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
});
