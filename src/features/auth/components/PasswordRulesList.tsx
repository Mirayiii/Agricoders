import { StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { colors, radii, spacing, text } from "@/constants/theme";
import { failedPasswordRules, PASSWORD_RULES } from "../passwordRules";

/** The rules box on "Set your password": each D5 rule plus "not the old password", ticked as they are met. */
export function PasswordRulesList({ password, sameAsOld, differentLabel }: { password: string; sameAsOld: boolean; differentLabel: string }) {
  const failed = new Set(failedPasswordRules(password));
  const typed = password.length > 0;
  const rules = [
    ...PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: typed && !failed.has(rule.id) })),
    { id: "different", label: differentLabel, met: typed && !sameAsOld },
  ];
  return (
    <View style={styles.rules}>
      {rules.map((rule) => (
        <View key={rule.id} style={styles.rule} accessible accessibilityLabel={`${rule.label}, ${rule.met ? "met" : "not met"}`}>
          <Icon name={rule.met ? "check-circle" : "alert-circle"} size={14} color={rule.met ? colors.primary : colors.textMuted} />
          <Text style={[styles.ruleText, rule.met && styles.ruleMet]}>{rule.label}</Text>
        </View>
      ))}
      {failed.has("too_long") ? <Text style={styles.tooLong}>Use at most 72 characters.</Text> : null}
    </View>
  );
}

/** Whether a new password passes every rule and is different from the old one. */
export function passwordAcceptable(password: string, sameAsOld: boolean): boolean {
  return password.length > 0 && failedPasswordRules(password).length === 0 && !sameAsOld;
}

const styles = StyleSheet.create({
  rules: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 14, gap: spacing.sm },
  rule: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ruleText: { ...text.caption, color: colors.textSecondary, flexShrink: 1 },
  ruleMet: { color: colors.text },
  tooLong: { ...text.caption, color: colors.danger },
});
