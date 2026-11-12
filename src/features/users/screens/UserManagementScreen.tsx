import { useCallback, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar, BottomSheet, Button, Card, Chip, EmptyState, ErrorState, FormInput, Icon, InlineAlert, LoadingState, PressableCard, PrimaryButton, Screen, SearchBar, SecondaryButton, StatusBadge, useToast } from "@/components";
import { ROLE_META } from "@/constants/roles";
import { colors, radii, shadows, spacing, typography } from "@/constants/theme";
import { useAuth } from "@/features/auth";
import { supabase } from "@/services/supabase";
import { PROFILE_ROLES, type Profile, type ProfileRole } from "@/types/auth";
import {
  changeStaffUsername,
  createStaffUser,
  loadAccountLocks,
  newRequestId,
  resetStaffPassword,
  type TemporaryPassword,
  unlockStaffUser,
  usernameError,
} from "../accountAdminApi";
import { TemporaryPasswordNotice } from "../components/TemporaryPasswordNotice";
import { displayName, filterUsers, roleCounts, userBadge } from "../usersLogic";

const PROFILE_COLUMNS = "id, full_name, email, username, role, status, must_change_password, must_change_reason, temp_password_expires_at, created_at, updated_at";

export function UserManagementScreen() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { profile: me } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<ProfileRole | "all">("all");
  const [editing, setEditing] = useState<Profile | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [locks, setLocks] = useState<Map<string, string>>(new Map());
  const [notice, setNotice] = useState<{ title: string; temp: TemporaryPassword } | null>(null);
  // One request id per reset, kept until it succeeds, so a retry cannot reset twice.
  const resetRequest = useRef<{ userId: string; id: string } | null>(null);

  const loadUsers = useCallback(async () => {
    const [{ data, error: loadError }, lockMap] = await Promise.all([
      supabase.from("profiles").select(PROFILE_COLUMNS).order("full_name", { ascending: true }),
      loadAccountLocks(),
    ]);
    setLocks(lockMap);
    setLoaded(true);
    if (loadError) {
      setError("Unable to load users. Confirm that the administrator policies are installed.");
      return;
    }
    setError(null);
    setUsers((data ?? []) as Profile[]);
  }, []);

  useFocusEffect(useCallback(() => { void loadUsers(); }, [loadUsers]));

  function openUser(user: Profile | null) {
    setSheetError(null);
    setEditing(user);
  }

  async function updateUser(user: Profile, updates: Partial<Pick<Profile, "full_name" | "role" | "status">>, success: string) {
    setSaving(true);
    setSheetError(null);
    const { error: updateError } = await supabase.from("profiles").update(updates).eq("id", user.id);
    setSaving(false);
    if (updateError) {
      // The server keeps at least one active administrator.
      setSheetError(/administrator/i.test(updateError.message) ? "There must always be at least one active administrator." : "Unable to save this user. Try again.");
      return;
    }
    setEditing(null);
    toast(success);
    await loadUsers();
  }

  async function saveUser(user: Profile, updates: { full_name: string; role: ProfileRole; username: string }) {
    if (updates.username !== user.username) {
      setSaving(true);
      const failure = await changeStaffUsername(user.id, updates.username);
      setSaving(false);
      if (failure) {
        setSheetError(failure);
        return;
      }
    }
    await updateUser(user, { full_name: updates.full_name, role: updates.role }, "Changes saved");
  }

  async function resetPassword(user: Profile) {
    if (resetRequest.current?.userId !== user.id) resetRequest.current = { userId: user.id, id: newRequestId() };
    setSaving(true);
    setSheetError(null);
    const outcome = await resetStaffPassword(resetRequest.current.id, user.id);
    setSaving(false);
    if (!outcome.ok) {
      setSheetError(outcome.error);
      return;
    }
    resetRequest.current = null;
    setEditing(null);
    setNotice({ title: "Password reset", temp: { username: user.username ?? "", password: outcome.password } });
    await loadUsers();
  }

  async function unlock(user: Profile) {
    setSaving(true);
    setSheetError(null);
    const failure = await unlockStaffUser(user.id);
    setSaving(false);
    if (failure) {
      setSheetError(failure);
      return;
    }
    setEditing(null);
    toast(`${displayName(user)} unlocked`);
    await loadUsers();
  }

  async function createUser(requestId: string, payload: { fullName: string; username: string; role: ProfileRole }): Promise<string | null> {
    // The prototype and AS-01 ask for name, username and role only; no contact email.
    const outcome = await createStaffUser(requestId, { ...payload, contactEmail: "" });
    if (!outcome.ok) return outcome.error;
    setAdding(false);
    setNotice({ title: `${payload.fullName} added`, temp: outcome.temp });
    await loadUsers();
    return null;
  }

  const counts = useMemo(() => roleCounts(users), [users]);
  const visible = useMemo(() => filterUsers(users, { query, role: roleFilter }), [users, query, roleFilter]);

  return (
    <Screen
      title="User management"
      showBackButton
      scroll={false}
    >
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 112 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Card style={styles.filters}>
          <SearchBar value={query} onChangeText={setQuery} placeholder="Search name or username" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="All" count={counts.all} selected={roleFilter === "all"} onPress={() => setRoleFilter("all")} variant="status" />
            {PROFILE_ROLES.map((role) => (
              <Chip key={role} label={ROLE_META[role].short} count={counts[role]} selected={roleFilter === role} onPress={() => setRoleFilter(role)} variant="status" />
            ))}
          </ScrollView>
        </Card>
        <View style={styles.list}>
          {!loaded ? <LoadingState message="Loading users..." /> : error ? (
            <Card><ErrorState description={error} onRetry={() => void loadUsers()} /></Card>
          ) : visible.length ? visible.map((user) => {
            const name = displayName(user);
            const badge = userBadge(user, locks);
            return (
              <PressableCard key={user.id} onPress={() => openUser(user)} accessibilityLabel={`${name}, ${ROLE_META[user.role].label}, ${badge.label}`} style={[styles.userCard, user.status !== "active" && styles.inactive]}>
                <Avatar name={name} />
                <View style={styles.userText}>
                  <Text style={styles.name}>{name}{user.id === me?.id ? <Text style={styles.you}> (you)</Text> : null}</Text>
                  <Text style={styles.email} numberOfLines={1}>{user.username}</Text>
                  <Text style={styles.roleLabel}>{ROLE_META[user.role].label}</Text>
                </View>
                {/* Figma: the status badge sits centered on the row. */}
                <View><StatusBadge label={badge.label} tone={badge.tone} /></View>
              </PressableCard>
            );
          }) : <Card><EmptyState icon="people-outline" title="No users found" description="Try another role or search." /></Card>}
        </View>
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add user"
        onPress={() => setAdding(true)}
        style={({ pressed }) => [styles.fab, { bottom: insets.bottom + spacing.lg }, pressed && styles.fabPressed]}
      >
        <Icon name="plus" size={26} color={colors.onBrand} />
      </Pressable>

      <BottomSheet visible={editing !== null} onClose={() => openUser(null)}>
        {editing ? (
          <EditUserForm
            key={editing.id}
            user={editing}
            isSelf={editing.id === me?.id}
            lockedUntil={locks.get(editing.id) ?? null}
            saving={saving}
            error={sheetError}
            onSave={(updates) => void saveUser(editing, updates)}
            onSetActive={(next) => void updateUser(editing, { status: next ? "active" : "inactive" }, `${displayName(editing)} ${next ? "reactivated" : "deactivated"}`)}
            onResetPassword={() => void resetPassword(editing)}
            onUnlock={() => void unlock(editing)}
          />
        ) : null}
      </BottomSheet>
      <BottomSheet visible={adding} onClose={() => setAdding(false)}>
        {adding ? <AddUserForm onCreate={createUser} /> : null}
      </BottomSheet>
      <BottomSheet visible={notice !== null} onClose={() => setNotice(null)}>
        {notice ? <TemporaryPasswordNotice title={notice.title} temp={notice.temp} onDone={() => setNotice(null)} /> : null}
      </BottomSheet>
    </Screen>
  );
}

function RoleOptions({ value, onChange }: { value: ProfileRole | null; onChange: (role: ProfileRole) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Role</Text>
      {PROFILE_ROLES.map((role) => {
        const selected = value === role;
        return (
          <Pressable key={role} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => onChange(role)} style={[styles.roleOption, selected && styles.roleOptionSelected]}>
            <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
            <View style={styles.userText}>
              <Text style={[styles.roleTitle, selected && styles.roleTitleSelected]}>{ROLE_META[role].label}</Text>
              <Text style={styles.roleDescription}>{ROLE_META[role].description}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

type EditUserFormProps = {
  user: Profile;
  isSelf: boolean;
  lockedUntil: string | null;
  saving: boolean;
  error: string | null;
  onSave: (updates: { full_name: string; role: ProfileRole; username: string }) => void;
  onSetActive: (active: boolean) => void;
  onResetPassword: () => void;
  onUnlock: () => void;
};

function EditUserForm({ user, isSelf, lockedUntil, saving, error, onSave, onSetActive, onResetPassword, onUnlock }: EditUserFormProps) {
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [username, setUsername] = useState(user.username ?? "");
  const [role, setRole] = useState<ProfileRole>(user.role);
  // Reset and deactivate ask once more inside the sheet before they run.
  const [confirming, setConfirming] = useState<"reset" | "deactivate" | null>(null);
  const isActive = user.status === "active";
  const nameError = usernameError(username);
  const name = displayName(user);

  if (confirming) {
    const reset = confirming === "reset";
    return (
      <>
        <Text style={styles.sheetTitle} accessibilityRole="header">{reset ? "Reset password?" : "Deactivate this account?"}</Text>
        <Text style={styles.confirmText}>
          {reset
            ? `${name} will be signed out on every device. You'll get a temporary password to give them, and they choose a new one when they sign in.`
            : `${name} will be signed out at once and can't sign in until an administrator reactivates the account. Their orders and history stay.`}
        </Text>
        {error ? <InlineAlert title={reset ? "Password not reset" : "Not deactivated"} message={error} /> : null}
        <Button label={reset ? "Reset password" : "Deactivate account"} type={reset ? "primary" : "danger"} size="lg" loading={saving} onPress={() => (reset ? onResetPassword() : onSetActive(false))} />
        <Button label="Cancel" type="secondary" size="lg" disabled={saving} onPress={() => setConfirming(null)} />
      </>
    );
  }

  return (
    <>
      <View>
        <Text style={styles.sheetTitle}>Edit user</Text>
        <Text style={styles.email}>@{user.username}</Text>
      </View>
      {error ? <InlineAlert title="Not saved" message={error} /> : null}
      {lockedUntil ? (
        <View style={styles.lockBox}>
          <Text style={styles.lockText}>Locked after 5 failed sign-ins. Unlocks by itself at {new Date(lockedUntil).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.</Text>
          <SecondaryButton label="Unlock now" onPress={onUnlock} disabled={saving} />
        </View>
      ) : null}
      <FormInput label="Full name" value={fullName} onChangeText={setFullName} placeholder="Full name" autoCapitalize="words" />
      {/* D3: only admins rename; the old name stays reserved for 30 days. */}
      <FormInput label="Username" value={username} onChangeText={(v) => setUsername(v.trim().toLowerCase())} error={nameError} autoCapitalize="none" autoCorrect={false} />
      {username !== user.username && !nameError ? <Text style={styles.hint}>They sign in with the new username from now on. @{user.username} stays reserved for 30 days.</Text> : null}
      <RoleOptions value={role} onChange={setRole} />
      {!isSelf ? <Button label="Reset password" type="secondary" size="lg" icon="key" disabled={saving} onPress={() => setConfirming("reset")} /> : null}
      <PrimaryButton label="Save changes" size="lg" onPress={() => onSave({ full_name: fullName.trim(), role, username })} disabled={!fullName.trim() || !username || Boolean(nameError)} loading={saving} />
      {!isSelf ? (
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => (isActive ? setConfirming("deactivate") : onSetActive(true))} style={styles.toggle}>
          <Text style={[styles.toggleText, { color: isActive ? colors.danger : colors.primary }]}>{isActive ? "Deactivate account" : "Reactivate account"}</Text>
          <Text style={styles.toggleHint}>{isActive ? "They will lose access until reactivated." : "They will be able to sign in again."}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function AddUserForm({ onCreate }: { onCreate: (requestId: string, payload: { fullName: string; username: string; role: ProfileRole }) => Promise<string | null> }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<ProfileRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same details, same request id: a retry after a lost response cannot create a second account.
  const request = useRef<{ key: string; id: string } | null>(null);

  const nameError = usernameError(username);
  const canSubmit = fullName.trim().length > 0 && username.length > 0 && !nameError && role !== null;

  async function submit() {
    if (!canSubmit || !role) return;
    const payload = { fullName: fullName.trim(), username, role };
    const key = JSON.stringify(payload);
    if (request.current?.key !== key) request.current = { key, id: newRequestId() };
    setSaving(true);
    setError(null);
    const failure = await onCreate(request.current.id, payload);
    setSaving(false);
    if (failure) setError(failure);
  }

  return (
    <>
      <View>
        <Text style={styles.sheetTitle}>Add user</Text>
        <Text style={styles.email}>Create login credentials to share with your staff member.</Text>
      </View>
      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <FormInput label="Full name" value={fullName} onChangeText={setFullName} placeholder="e.g. Maria Santos" autoCapitalize="words" />
      <FormInput
        label="Username"
        value={username}
        onChangeText={(v) => setUsername(v.trim().toLowerCase())}
        error={nameError}
        placeholder="e.g. maria.santos"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <RoleOptions value={role} onChange={setRole} />
      <PrimaryButton label="Create account" icon="user-plus" size="lg" onPress={() => void submit()} disabled={!canSubmit} loading={saving} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.lg, paddingHorizontal: spacing.lg, gap: spacing.md },
  filters: { gap: spacing.md },
  chips: { gap: spacing.sm },
  list: { gap: spacing.md },
  confirmText: { ...typography.body, lineHeight: 22, color: colors.textSecondary },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", ...shadows.card, elevation: 6 },
  fabPressed: { backgroundColor: colors.primaryPressed },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 14, paddingLeft: 14, paddingRight: spacing.md },
  inactive: { opacity: 0.65 },
  userText: { flex: 1, minWidth: 0, gap: 1 },
  name: { ...typography.bodyMedium, color: colors.text },
  you: { fontWeight: "400", color: colors.textMuted },
  email: { ...typography.caption, color: colors.textSecondary },
  roleLabel: { ...typography.captionMedium, color: colors.primary, marginTop: 2 },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  field: { gap: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  roleOption: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  roleOptionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primaryMuted },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  roleTitle: { ...typography.bodyMedium, color: colors.text },
  roleTitleSelected: { color: colors.primary },
  roleDescription: { fontSize: 12, color: colors.textSecondary },
  toggle: { minHeight: 44, alignItems: "center", justifyContent: "center", gap: 2 },
  toggleText: { fontSize: 15, fontWeight: "700" },
  toggleHint: { fontSize: 12, color: colors.textMuted },
  errorBox: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.dangerSoft, alignItems: "flex-start" },
  errorText: { ...typography.caption, color: colors.danger, flex: 1, lineHeight: 18 },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: -spacing.sm },
  lockBox: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.warningSoft },
  lockText: { ...typography.caption, color: colors.text },
});
