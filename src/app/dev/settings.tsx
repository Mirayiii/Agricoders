import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components";
import { colors, spacing } from "@/constants/theme";
import { RolePreviewFrame } from "@/features/auth";
import { AuthContext } from "@/features/auth/AuthProvider";
import { activePreviewRole, previewedProfile, type RolePreview } from "@/features/auth/rolePreview";
import { MoreScreen } from "@/features/more";
import { SettingsScreen } from "@/features/settings";
import { UserManagementScreen } from "@/features/users";
import { queryClient } from "@/services/data";
import { supabase } from "@/services/supabase";
import type { Profile, ProfileRole } from "@/types/auth";

// Dev-only: More, User management and Settings with pretend accounts from the
// Figma frames. Nothing reaches a server.

const person = (id: string, full_name: string, username: string, role: ProfileRole, status: "active" | "inactive" = "active"): Profile => ({
  id, full_name, username, role, status, email: `${username}@meah.test`,
  must_change_password: false, must_change_reason: null, temp_password_expires_at: null, created_at: "2026-09-24T02:00:00Z", updated_at: "2026-11-01T02:00:00Z",
});
const USERS: Profile[] = [
  person("ana", "Ana Mercado", "ana.mercado", "administrator"),
  person("liza", "Liza Ramos", "liza.ramos", "administrative_staff"),
  person("carlo", "Carlo Diaz", "carlo.diaz", "fulfillment_staff"),
  person("nina", "Nina Gomez", "nina.gomez", "fulfillment_staff"),
  person("rico", "Rico Bautista", "rico.bautista", "delivery_staff"),
  person("jun", "Jun Villanueva", "jun.villanueva", "delivery_staff"),
  person("paul", "Paul Santos", "paul.santos", "delivery_staff", "inactive"),
];
const LOCKED_UNTIL = new Date(Date.now() + 9 * 60_000).toISOString();

function fakeQuery(table: string) {
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") {
        const rows = table === "profiles" ? USERS : table === "notification_preferences" ? [{ push_enabled: true, delivery_reminders: true, low_stock_alerts: true }] : [];
        return (resolve: (value: unknown) => void) => setTimeout(() => resolve({ data: structuredClone(rows), error: null, count: 0 }), 80);
      }
      return () => chain;
    },
  });
  return chain;
}

async function fakeRpc(name: string, args: Record<string, unknown>) {
  if (name === "get_account_locks") return { data: [{ user_id: "jun", locked_until: LOCKED_UNTIL }], error: null };
  if (name === "set_my_setting") return { data: { [String(args.p_key)]: args.p_on }, error: null };
  return { data: [], error: null };
}

type Preview = "more" | "office" | "purchasing" | "delivery" | "previewing" | "users" | "settings" | "settings-purchasing" | "password";
const PREVIEWS: { key: Preview; label: string }[] = [
  { key: "more", label: "More · Administrator" }, { key: "previewing", label: "Previewing as Delivery" },
  { key: "office", label: "More · Administrative staff" }, { key: "purchasing", label: "More · Purchasing" }, { key: "delivery", label: "More · Delivery" },
  { key: "users", label: "User management" }, { key: "settings", label: "Settings" }, { key: "settings-purchasing", label: "Settings · Purchasing" },
  { key: "password", label: "Change password" },
];
const ROLE_OF: Partial<Record<Preview, ProfileRole>> = { office: "administrative_staff", purchasing: "fulfillment_staff", "settings-purchasing": "fulfillment_staff", delivery: "delivery_staff" };

function install(preview: Preview): Preview {
  const client = supabase as unknown as { from: unknown; rpc: unknown };
  client.from = fakeQuery;
  client.rpc = fakeRpc;
  queryClient.clear();
  return preview;
}

export default function SettingsPreview() {
  const [preview, setPreview] = useState<Preview>(() => install("more"));
  const [rolePreview, setRolePreview] = useState<RolePreview | null>(null);
  const role = ROLE_OF[preview] ?? "administrator";
  const value = useMemo(() => {
    const real = role === "administrator" ? USERS[0] : USERS.find((user) => user.role === role) ?? USERS[0];
    return {
      session: null, user: null, initialized: true, error: null, profile: previewedProfile(real, rolePreview),
      isActive: true, needsPasswordChange: false, welcomePending: false, knowsCurrentPassword: false,
      matchesSignInPassword: () => false,
      signIn: async () => null, changePassword: async () => ({ ok: true as const }), finishWelcome: () => {},
      signOut: async () => {}, refreshProfile: async () => null,
      realRole: real.role, previewRole: activePreviewRole(real, rolePreview),
      startRolePreview: (next: ProfileRole) => setRolePreview({ userId: real.id, role: next }), endRolePreview: () => setRolePreview(null),
    };
  }, [role, rolePreview]);

  if (!__DEV__) return <Redirect href="/" />;

  function choose(next: Preview) {
    install(next);
    setRolePreview(next === "previewing" ? { userId: "ana", role: "delivery_staff" } : null);
    setPreview(next);
  }

  const screen = (() => {
    switch (preview) {
      case "users": return <UserManagementScreen />;
      case "settings": case "settings-purchasing": return <SettingsScreen />;
      case "password": return <SettingsScreen passwordOpen />;
      default: return <MoreScreen />;
    }
  })();

  return (
    <View style={styles.page}>
      <SafeAreaView edges={["top"]} style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {PREVIEWS.map((p) => <Chip key={p.key} label={p.label} selected={preview === p.key} onPress={() => choose(p.key)} />)}
        </ScrollView>
      </SafeAreaView>
      <View style={styles.screen}>
        <AuthContext.Provider value={value}>
          <RolePreviewFrame>
            <View key={preview} style={styles.screen}>{screen}</View>
          </RolePreviewFrame>
        </AuthContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  bar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  chips: { padding: spacing.sm, gap: spacing.sm },
  screen: { flex: 1 },
});
