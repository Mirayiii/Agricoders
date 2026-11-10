import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ROLE_META } from "@/constants/roles";
import { colors, radii, spacing, text } from "@/constants/theme";
import { useAuth } from "@/features/auth/useAuth";

/** Figma "Signed in": shown once after each interactive sign-in (D9). */
export function WelcomeScreen() {
  const { profile, finishWelcome } = useAuth();
  const insets = useSafeAreaInsets();
  const name = profile?.full_name?.trim() || profile?.username || "";
  const role = profile ? ROLE_META[profile.role].label : "";

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.xxl }]}>
      <View style={styles.center}>
        <View style={styles.badgeOuter} accessible={false}>
          <View style={styles.badgeInner}>
            <Icon name="check" size={20} color={colors.onBrand} />
          </View>
        </View>
        <Text style={styles.title} accessibilityRole="header">{name ? `Welcome, ${name}` : "Welcome"}</Text>
        {role ? <Text style={styles.subtitle}>Signed in as {role}</Text> : null}
      </View>
      <Button label="Open app" size="lg" onPress={finishWelcome} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  badgeOuter: { width: 64, height: 64, borderRadius: radii.full, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  badgeInner: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  title: { ...text.display, color: colors.text, textAlign: "center" },
  subtitle: { ...text.body, color: colors.textSecondary, textAlign: "center" },
});
