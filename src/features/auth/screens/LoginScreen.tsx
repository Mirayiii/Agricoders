import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, type TextInputInstance, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { FormInput } from "@/components/FormInput";
import { InlineAlert } from "@/components/InlineAlert";
import { colors, spacing, text } from "@/constants/theme";
import { useAuth } from "@/features/auth/useAuth";
import type { AuthMessage } from "../staffAuthApi";

/** Figma "Sign In": Default, Filled, Error, Deactivated and missing-password states. */
export function LoginScreen() {
  const { signIn, error: authError } = useAuth();
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInputInstance>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<AuthMessage | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});

  async function handleSignIn() {
    const errors = {
      username: username.trim() ? undefined : "Enter your username",
      password: password ? undefined : "Enter your password",
    };
    setFieldErrors(errors);
    if (errors.username || errors.password) {
      setAlert(null);
      return;
    }
    setAlert(null);
    setLoading(true);
    const result = await signIn(username, password, keepSignedIn);
    setLoading(false);
    if (result) {
      setAlert(result);
      setPassword("");
    }
  }

  // A message from the session itself (for example a deactivation found later).
  const sessionAlert: AuthMessage | null = !alert && authError ? splitMessage(authError) : null;
  const shownAlert = alert ?? sessionAlert;

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Sign in to MEAH</Text>
          <Text style={styles.subtitle}>Use the username and password your administrator gave you.</Text>
        </View>

        {shownAlert ? <InlineAlert title={shownAlert.title} message={shownAlert.message} /> : null}

        <View style={styles.fields}>
          <FormInput
            label="Username"
            icon="user"
            value={username}
            onChangeText={(value) => { setUsername(value); if (fieldErrors.username) setFieldErrors((e) => ({ ...e, username: undefined })); }}
            error={fieldErrors.username}
            placeholder="Enter your username"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <FormInput
            ref={passwordRef}
            label="Password"
            icon="key"
            value={password}
            onChangeText={(value) => { setPassword(value); if (fieldErrors.password) setFieldErrors((e) => ({ ...e, password: undefined })); }}
            error={fieldErrors.password}
            placeholder="Enter your password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleSignIn}
          />
        </View>

        <Checkbox label="Keep me signed in" checked={keepSignedIn} onChange={setKeepSignedIn} />

        <Button label="Sign in" size="lg" onPress={handleSignIn} loading={loading} />

        <View style={styles.footer}>
          <Text style={styles.help}>Accounts, reactivation and forgotten passwords are handled by your administrator. Contact them for help.</Text>
          <Text style={styles.company}>MEAH Agricultural Products Trading</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Session messages are stored as one string, "Title. Details". */
function splitMessage(message: string): AuthMessage {
  const index = message.indexOf(". ");
  return index > 0 ? { title: message.slice(0, index + 1), message: message.slice(index + 2) } : { title: message, message: "" };
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: spacing.xxl, gap: spacing.xl },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...text.display, color: colors.text },
  subtitle: { ...text.body, color: colors.textSecondary },
  fields: { gap: 14 },
  footer: { marginTop: "auto", paddingTop: spacing.xxxl, gap: spacing.sm, alignItems: "center" },
  help: { ...text.caption, color: colors.textSecondary, textAlign: "center" },
  company: { ...text.caption, color: colors.textMuted, textAlign: "center" },
});
