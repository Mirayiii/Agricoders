import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { FormInput } from "@/components/FormInput";
import { InlineAlert } from "@/components/InlineAlert";
import { Screen } from "@/components/Screen";
import { useToast } from "@/components/Toast";
import { colors, spacing, text } from "@/constants/theme";
import { useAuth } from "@/features/auth/useAuth";
import { passwordAcceptable, PasswordRulesList } from "../components/PasswordRulesList";
import type { AuthMessage } from "../staffAuthApi";

/** Settings > Change password. Replaces the old emailed reset link: staff have no email. */
export function ChangePasswordScreen() {
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
      router.back();
    } else if (!outcome.signedOut) {
      setAlert(outcome.message);
      if (outcome.message.title.startsWith("Current")) setCurrent("");
    }
  }

  return (
    <Screen title="Change password" showBackButton keyboardAware contentStyle={styles.content}>
      <Text style={styles.intro}>Changing your password signs you out on your other devices.</Text>
      {alert ? <InlineAlert title={alert.title} message={alert.message} /> : null}
      <View style={styles.fields}>
        <FormInput label="Current password" icon="key" value={current} onChangeText={setCurrent} placeholder="Enter your current password" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" />
        <FormInput label="New password" icon="key" value={next} onChangeText={setNext} placeholder="Enter a new password" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" />
        <FormInput label="Confirm password" icon="key" value={confirm} onChangeText={setConfirm} error={confirmError} placeholder="Re-enter password" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="done" onSubmitEditing={save} />
      </View>
      <PasswordRulesList password={next} sameAsOld={sameAsCurrent} differentLabel="Not your current password" />
      <Button label="Save password" size="lg" onPress={save} loading={saving} disabled={!canSave} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  intro: { ...text.body, color: colors.textSecondary },
  fields: { gap: 14 },
});
