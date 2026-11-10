import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar, BottomSheet, Button, Card, InlineAlert, ListGroup, ListRow, Screen, SecondaryButton, Switch, useToast } from "@/components";
import { BUSINESS_NAME } from "@/constants/app";
import { ROLE_META } from "@/constants/roles";
import { colors, radii, spacing, typography } from "@/constants/theme";
import { useAuth } from "@/features/auth";
import { connectivity, syncNow, useIsOnline, useOfflineOptional, useOutbox } from "@/services/offline";
import { isSupabaseConfigured } from "@/services/supabase";
import { useNotificationPreferences, useSetDeliveryReminders, useSetPushPreference } from "../settingsData";
import { notificationSettings, type NotificationSetting } from "../settingsLogic";

const APP_VERSION = Constants.expoConfig?.version ?? "—";

export function SettingsScreen() {
  const { profile, previewRole, realRole, signOut } = useAuth();
  const offline = useOfflineOptional();
  const online = useIsOnline();
  const { counts } = useOutbox();
  const unsyncedCount = counts.pending + counts.syncing + counts.rejected;
  const [helpOpen, setHelpOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const name = profile?.full_name ?? profile?.username ?? "";
  // Staff sign in by username; the account email is internal and not shown.
  const username = profile?.username ? `@${profile.username}` : "";

  return (
    <Screen title="Settings" showBackButton contentStyle={styles.content}>
      <Card style={styles.profileCard}>
        <View style={styles.profile}>
          <Avatar name={name} size={56} />
          <View style={styles.flex}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.muted}>{username}</Text>
            {profile ? <Text style={styles.role}>{ROLE_META[profile.role].label}{previewRole ? " (preview)" : ""}</Text> : null}
          </View>
        </View>
        <View style={styles.divider} />
        <ListRow title="Change password" icon="key-outline" onPress={() => router.push("/change-password")} last />
      </Card>

      <View style={styles.group}>
        <Text style={styles.groupLabel}>Notifications</Text>
        <NotificationPreferencesCard />
      </View>

      <View style={styles.group}>
        <Text style={styles.groupLabel}>App</Text>
        <ListGroup>
          <ListRow
            title="Connection"
            right={
              <View style={styles.status}>
                <View style={[styles.statusDot, !(isSupabaseConfigured && online) && styles.statusDotOff]} />
                <Text style={[styles.statusText, !(isSupabaseConfigured && online) && styles.statusTextOff]}>{!isSupabaseConfigured ? "Not configured" : online ? "Connected" : "Offline"}</Text>
                {isSupabaseConfigured && !online ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Retry connection" disabled={checking} hitSlop={8}
                    onPress={() => { setChecking(true); void connectivity.check().then((ok) => (ok ? syncNow() : undefined)).finally(() => setChecking(false)); }}>
                    <Text style={styles.retry}>{checking ? "Checking…" : "Retry"}</Text>
                  </Pressable>
                ) : null}
              </View>
            }
          />
          <ListRow title="Offline changes" onPress={() => router.push("/sync")} right={<Text style={[styles.muted, counts.rejected > 0 && styles.warn]}>{unsyncedCount ? `${unsyncedCount} not synced` : "All synced"}</Text>} />
          {realRole === "administrator" && !previewRole ? <ListRow title="Offline sync problems" onPress={() => router.push("/sync-problems")} /> : null}
          <ListRow title="App version" right={<Text style={styles.muted}>{APP_VERSION}</Text>} />
          <ListRow title="Help & support" onPress={() => setHelpOpen(true)} last />
        </ListGroup>
      </View>

      <SecondaryButton label="Sign out" tone="danger" icon={<Ionicons name="log-out-outline" size={20} color={colors.danger} />} onPress={() => (offline ? offline.requestSignOut() : void signOut())} />
      <Text style={styles.footer}>{BUSINESS_NAME}</Text>

      <BottomSheet visible={helpOpen} onClose={() => setHelpOpen(false)}>
        {helpOpen ? <HelpSheet username={username} onClose={() => setHelpOpen(false)} /> : null}
      </BottomSheet>
    </Screen>
  );
}

function NotificationPreferencesCard() {
  const { profile } = useAuth();
  const prefs = useNotificationPreferences();
  const setReminders = useSetDeliveryReminders();
  const setPush = useSetPushPreference();
  const toast = useToast();
  const rows = notificationSettings(profile?.role);
  const saving = setReminders.isPending || setPush.isPending;

  function valueOf(row: NotificationSetting): boolean {
    // Show the choice being saved straight away; it settles when the save returns.
    if (row.kind === "in_app") {
      if (setReminders.isPending && typeof setReminders.variables === "boolean") return setReminders.variables;
      return prefs.data?.delivery_reminders ?? true;
    }
    if (setPush.isPending && setPush.variables?.category === row.category) return setPush.variables.on;
    return prefs.data?.[`push_${row.category}`] ?? true;
  }

  function change(row: NotificationSetting, on: boolean) {
    if (row.kind === "in_app") setReminders.mutate(on, { onSuccess: () => toast(on ? "Delivery reminders on" : "Delivery reminders off") });
    else setPush.mutate({ category: row.category, on }, { onSuccess: () => toast(`${row.title.replace("Push: ", "Push for ")} ${on ? "on" : "off"}`) });
  }

  if (!rows.length) {
    return (
      <Card style={styles.prefsCard}>
        <Text style={styles.prefDescription}>Your role has no notification settings.</Text>
      </Card>
    );
  }

  return (
    <Card style={styles.prefsCard}>
      {rows.map((row, index) => {
        const value = valueOf(row);
        const disabled = prefs.isPending || prefs.isError || saving;
        return (
          <Pressable
            key={row.key}
            accessibilityRole="switch"
            accessibilityLabel={row.title}
            accessibilityHint={row.description}
            accessibilityState={{ checked: value, disabled }}
            disabled={disabled}
            onPress={() => change(row, !value)}
            style={[styles.prefRow, index < rows.length - 1 && styles.prefDivider]}
          >
            <View style={styles.flex}>
              <View style={styles.prefTitleRow}>
                <Text style={styles.prefTitle}>{row.title}</Text>
              </View>
              <Text style={styles.prefDescription}>{row.description}</Text>
            </View>
            <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Switch value={value} />
            </View>
          </Pressable>
        );
      })}
      {prefs.isError ? <InlineAlert title="Couldn't load your preferences" message="Check your connection and open Settings again." /> : null}
      {setReminders.isError || setPush.isError ? <InlineAlert title="Not saved" message="Your setting didn't change. Try again." /> : null}
      {rows.some((row) => row.kind === "push") ? (
        <Text style={styles.prefNote}>Push choices are saved now. Phones start getting push alerts once push is set up for the business. Notifications in the app arrive whatever these switches say.</Text>
      ) : null}
    </Card>
  );
}

/** Help & support (D-A2): points staff to their administrator. No contact details are invented. */
function HelpSheet({ username, onClose }: { username: string; onClose: () => void }) {
  return (
    <>
      <Text style={styles.sheetTitle} accessibilityRole="header">Help & support</Text>
      <View style={styles.helpCard}>
        <Text style={styles.helpTitle}>Contact your administrator</Text>
        <Text style={styles.helpText}>Your administrator can reset your password, unlock your account, change your role or username, and help with orders and deliveries.</Text>
      </View>
      <Text style={styles.helpText}>When you ask for help, mention:</Text>
      <View style={styles.helpList}>
        {username ? <Text style={styles.helpItem}>• Your username: {username}</Text> : null}
        <Text style={styles.helpItem}>• App version: {APP_VERSION}</Text>
        <Text style={styles.helpItem}>• What you were doing and any message you saw</Text>
      </View>
      <Button label="Done" type="secondary" size="lg" onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  profileCard: { paddingBottom: spacing.xs },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.border },
  name: { ...typography.bodyMedium, fontWeight: "700", color: colors.text },
  muted: { ...typography.caption, color: colors.textSecondary },
  role: { ...typography.captionMedium, fontWeight: "700", color: colors.primary, marginTop: 2 },
  group: { gap: spacing.sm },
  groupLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted, paddingHorizontal: spacing.xs },
  prefsCard: { paddingVertical: spacing.xs, gap: 0 },
  prefRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  prefDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  prefTitleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  prefTitle: { ...typography.bodyMedium, fontWeight: "600", color: colors.text },
  prefDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  prefNote: { ...typography.caption, color: colors.textSecondary, paddingTop: spacing.sm },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  statusDotOff: { backgroundColor: colors.danger },
  statusText: { fontSize: 13, fontWeight: "600", color: colors.primary },
  statusTextOff: { color: colors.danger },
  retry: { fontSize: 13, fontWeight: "700", color: colors.primary, textDecorationLine: "underline", marginLeft: 6 },
  warn: { color: colors.warning, fontWeight: "600" },
  footer: { ...typography.captionMedium, fontWeight: "400", color: colors.textMuted, textAlign: "center" },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  helpCard: { gap: 4, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.primarySoft },
  helpTitle: { ...typography.bodyMedium, fontWeight: "700", color: colors.primary },
  helpText: { ...typography.caption, lineHeight: 19, color: colors.textSecondary },
  helpList: { gap: 4 },
  helpItem: { ...typography.caption, lineHeight: 19, color: colors.text },
});
