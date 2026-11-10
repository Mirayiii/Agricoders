import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Avatar, BottomSheet, Button, Card, Icon, ListGroup, ListRow, Screen, SecondaryButton, useToast } from "@/components";
import { APP_NAME, BUSINESS_NAME } from "@/constants/app";
import { ROLE_META } from "@/constants/roles";
import { colors, radii, spacing, text, typography } from "@/constants/theme";
import { useAuth } from "@/features/auth";
import { useOfflineOptional } from "@/services/offline";
import { PROFILE_ROLES, type ProfileRole } from "@/types/auth";
import { PREVIEW_ROLE_TEXT, moreMenu } from "../moreMenu";

export function MoreScreen() {
  const { profile, realRole, previewRole, signOut } = useAuth();
  const [choosing, setChoosing] = useState(false);
  const offline = useOfflineOptional();
  // During a preview, profile.role is the previewed role, so the menu is that role's menu.
  const modules = moreMenu(profile?.role);
  const name = profile?.full_name ?? profile?.username ?? "";
  // Only a real administrator sees Switch role, also while previewing (to switch or exit).
  const canSwitch = realRole === "administrator";

  return (
    <Screen title="More" contentStyle={styles.content}>
      <Card style={styles.profileCard}>
        <View style={styles.profile}>
          <Avatar name={name} size={56} />
          <View style={styles.profileText}>
            <Text style={styles.nameLine} numberOfLines={2}>
              <Text style={styles.name}>{name}</Text>
              {profile?.username ? <Text style={styles.username}>  @{profile.username}</Text> : null}
            </Text>
            <Text style={styles.role}>{profile ? ROLE_META[profile.role].label : ""}{previewRole ? " (preview)" : ""}</Text>
            <Text style={styles.business}>{BUSINESS_NAME}</Text>
          </View>
        </View>
        {canSwitch ? (
          <View style={styles.switchRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Switch role (preview)" accessibilityHint="Shows the app as another role sees it. Your real role doesn't change." onPress={() => setChoosing(true)} style={({ pressed }) => [styles.switchChip, pressed && styles.pressed]}>
              <Text style={styles.switchText}>Switch Role (Preview)</Text>
              <Icon name="chevron-down" size={16} color={colors.text} />
            </Pressable>
          </View>
        ) : null}
      </Card>
      <ListGroup>
        {modules.map((item, index) => (
          <ListRow key={item.key} title={item.title} description={item.description} icon={item.icon} onPress={() => router.push(item.route)} last={index === modules.length - 1} />
        ))}
      </ListGroup>
      <SecondaryButton label="Sign out" tone="danger" icon={<Ionicons name="log-out-outline" size={20} color={colors.danger} />} onPress={() => (offline ? offline.requestSignOut() : void signOut())} />
      <Text style={styles.footer}>{APP_NAME} · v{Constants.expoConfig?.version ?? "1.0.0"}</Text>
      {canSwitch ? (
        <BottomSheet visible={choosing} onClose={() => setChoosing(false)}>
          {choosing ? <SwitchRoleSheet onClose={() => setChoosing(false)} /> : null}
        </BottomSheet>
      ) : null}
    </Screen>
  );
}

/** Switch role (preview): a UI preview for administrators, never a change of role. */
function SwitchRoleSheet({ onClose }: { onClose: () => void }) {
  const { realRole, previewRole, startRolePreview, endRolePreview } = useAuth();
  const toast = useToast();
  const current = previewRole ?? realRole;

  function choose(role: ProfileRole) {
    onClose();
    if (role === current) return;
    if (role === realRole) {
      endRolePreview();
      toast({ title: "Preview ended", message: `You're back to your own view as ${ROLE_META[role].label}.`, tone: "positive" });
      return;
    }
    // Stay on More: its menu and the tabs below switch to the previewed role.
    startRolePreview(role);
  }

  return (
    <>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle} accessibilityRole="header">Switch Role (Preview)</Text>
        <Text style={styles.sheetText}>
          See the menus and screens another role sees. This is a UI preview only: your real role, your permissions and the data the server sends you stay the same, so it isn’t a permissions test.
        </Text>
      </View>
      <View style={styles.options}>
        {PROFILE_ROLES.map((role) => {
          const selected = role === current;
          return (
            <Pressable key={role} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => choose(role)} style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}>
              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{ROLE_META[role].label}{role === realRole ? " (your role)" : ""}</Text>
                <Text style={styles.optionDescription}>{PREVIEW_ROLE_TEXT[role]}</Text>
              </View>
              {selected ? <View style={styles.check}><Icon name="check" size={14} color={colors.surface} /></View> : null}
            </Pressable>
          );
        })}
      </View>
      {previewRole ? <Button label="Exit preview" type="primary" size="lg" onPress={() => { endRolePreview(); onClose(); }} /> : null}
      <Button label="Cancel" type="secondary" size="lg" onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  profileCard: { gap: spacing.md },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  profileText: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { color: colors.text },
  name: { ...typography.bodyMedium, fontWeight: "700", color: colors.text },
  username: { ...typography.caption, color: colors.textSecondary },
  role: { ...typography.captionMedium, fontWeight: "700", color: colors.primary },
  business: { ...typography.caption, color: colors.textSecondary },
  switchRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, alignItems: "flex-end" },
  switchChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  switchText: { ...text.bodyStrong, fontSize: 14, color: colors.text },
  pressed: { opacity: 0.7 },
  footer: { ...typography.caption, color: colors.textMuted, textAlign: "center" },
  sheetHead: { gap: 4 },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  sheetText: { ...typography.caption, lineHeight: 18, color: colors.textSecondary },
  options: { gap: spacing.sm },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { ...text.bodyStrong, color: colors.text },
  optionTitleSelected: { color: colors.primary },
  optionDescription: { ...typography.caption, color: colors.textSecondary },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
