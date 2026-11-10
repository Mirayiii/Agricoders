import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { colors, fonts, radii, spacing, text } from "@/constants/theme";
import type { TemporaryPassword } from "../accountAdminApi";
import { credentialsText } from "../usersLogic";

/**
 * Shown once after creating a user or resetting a password. The admin hands
 * the temporary password over in person; it expires after 72 hours (D6) and
 * must be changed at first sign-in.
 */
export function TemporaryPasswordNotice({ title, temp, onDone }: { title: string; temp: TemporaryPassword; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    // AS-01: one tap copies the username and password together.
    await Clipboard.setStringAsync(credentialsText(temp));
    setCopied(true);
  }

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>Give these details to the staff member in person. They must choose a new password when they first sign in.</Text>
      </View>
      <View style={styles.box}>
        <View style={styles.row}>
          <Text style={styles.label}>Username</Text>
          <Text style={styles.value} selectable>{temp.username}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Temporary password</Text>
          <Text style={[styles.value, styles.password]} selectable accessibilityLabel={`Temporary password ${temp.password.split("").join(" ")}`}>{temp.password}</Text>
        </View>
        <Text style={styles.expiry}>Expires in 72 hours. It will not be shown again.</Text>
      </View>
      <Button label={copied ? "Copied" : "Copy credentials"} type="secondary" size="lg" icon={copied ? "check" : "clipboard"} onPress={() => void copy()} />
      <Button label="Done" size="lg" onPress={onDone} />
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  title: { ...text.title, color: colors.text },
  body: { ...text.body, color: colors.textSecondary },
  box: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 14, gap: spacing.md },
  row: { gap: 2 },
  label: { ...text.caption, color: colors.textSecondary },
  value: { ...text.bodyStrong, color: colors.text },
  password: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: 1 },
  expiry: { ...text.caption, color: colors.textMuted },
});
