import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { FormInput } from "@/components/FormInput";
import { Icon } from "@/components/Icon";
import { InlineAlert } from "@/components/InlineAlert";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { useAuth } from "@/features/auth/useAuth";
import { passwordAcceptable, PasswordRulesList } from "../components/PasswordRulesList";
import type { AuthMessage } from "../staffAuthApi";

/**
 * Figma "Set your password". Shown after signing in with a temporary password,
 * or once for existing staff after the stricter rules arrive (D11). The back
 * arrow signs out (D10).
 */
export function SetPasswordScreen() {
  const { changePassword, signOut, knowsCurrentPassword, matchesSignInPassword, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AuthMessage | null>(null);

  const policyUpgrade = profile?.must_change_reason === "policy_upgrade";
  // "Not the temporary password": compared with the password typed at sign-in, or on this screen.
  const sameAsCurrent = next.length > 0 && (knowsCurrentPassword ? matchesSignInPassword(next) : next === current);
  const confirmError = confirm.length > 0 && confirm !== next ? "Passwords do not match" : undefined;
  const rulesMet = passwordAcceptable(next, sameAsCurrent);
  const canSave = rulesMet && confirm === next && (knowsCurrentPassword || current.length > 0);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setAlert(null);
    const outcome = await changePassword(next, knowsCurrentPassword ? undefined : current);
    setSaving(false);
    if (!outcome.ok && !outcome.signedOut) setAlert(outcome.message);
  }

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out and go back" onPress={() => void signOut()} hitSlop={4} style={styles.back}>
          <Icon name="chevron-left" size={20} color={colors.text} />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Set your password</Text>
          <Text style={styles.subtitle}>
            {policyUpgrade
              ? "MEAH now needs stronger passwords. Choose a new one to continue."
              : "You signed in with a temporary password. Choose a new one to continue."}
          </Text>
        </View>

        {alert ? <InlineAlert title={alert.title} message={alert.message} /> : null}

        <View style={styles.fields}>
          {knowsCurrentPassword ? null : (
            <FormInput
              label={policyUpgrade ? "Current password" : "Temporary password"}
              icon="key"
              value={current}
              onChangeText={setCurrent}
              placeholder="Password you signed in with"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
            />
          )}
          <FormInput
            label="New password"
            icon="key"
            value={next}
            onChangeText={setNext}
            placeholder="Enter a new password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <FormInput
            label="Confirm password"
            icon="key"
            value={confirm}
            onChangeText={setConfirm}
            error={confirmError}
            placeholder="Re-enter password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={save}
          />
        </View>

        <PasswordRulesList password={next} sameAsOld={sameAsCurrent} differentLabel={policyUpgrade ? "Not your current password" : "Not the temporary password"} />

        <Button label="Save and continue" size="lg" onPress={save} loading={saving} disabled={!canSave} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: spacing.xxl, gap: spacing.xl },
  back: {
    width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center", ...shadows.card,
  },
  header: { gap: spacing.sm },
  title: { ...text.display, color: colors.text },
  subtitle: { ...text.body, color: colors.textSecondary },
  fields: { gap: 14 },
});
