import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components";
import { colors, spacing } from "@/constants/theme";
import { AuthContext } from "@/features/auth/AuthProvider";
import { CustomersScreen } from "@/features/customers";
import { ReportsScreen } from "@/features/reports";
import { SettingsScreen } from "@/features/settings";
import { SyncProblemsScreen, SyncScreen } from "@/features/sync";
import { queryClient } from "@/services/data";
import { connectivity, useIsOnline } from "@/services/offline";
import type { OutboxAction } from "@/services/offline/outboxLogic";
import { outboxStore } from "@/services/offline/outboxStore";
import { supabase } from "@/services/supabase";
import type { Profile, ProfileRole } from "@/types/auth";

// Dev-only (Phase 10): Offline changes, sign-out choices, the administrators'
// sync problems list, and read-only and offline screens, with pretend data.
// Nothing reaches a server.

const ME = "dev-office";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const base = { userId: ME, args: {}, seen: {}, attempts: 0 } as const;
const OUTBOX: OutboxAction[] = [
  { ...base, id: "a1", rpc: "offline_create_order", label: "New order · Casa Verde Restaurant · ₱2,450.00", targetId: "a1", queuedAt: hoursAgo(3), status: "rejected",
    rejection: { kind: "price_changed", reason: "Prices changed since this order was entered. Review the new prices before sending it.", at: hoursAgo(0.2), reported: false,
      priceChanges: [{ product_id: "tom", product_name: "Tomatoes", unit: "kg", seen_price: 80, current_price: 85 }, { product_id: "gar", product_name: "Garlic Peeled", unit: "kg", seen_price: 120, current_price: 118 }] } },
  { ...base, id: "a2", rpc: "offline_confirm_order", label: "Confirm ORD-1047", targetId: "o47", queuedAt: hoursAgo(2.5), status: "rejected",
    rejection: { kind: "conflict", reason: "The order was changed after your list was last updated, so it was not confirmed. Open it, check it, and confirm again.", at: hoursAgo(0.2), reported: true } },
  { ...base, id: "a3", rpc: "offline_confirm_order", label: "Confirm ORD-1049", targetId: "o49", queuedAt: hoursAgo(1), status: "pending", attempts: 1 },
  { ...base, id: "a4", rpc: "offline_create_order", label: "New order · Luntian Grocers · ₱1,180.00", targetId: "a4", queuedAt: hoursAgo(0.5), status: "pending" },
  { ...base, id: "a5", rpc: "offline_confirm_order", label: "Confirm ORD-1044", targetId: "o44", queuedAt: hoursAgo(5), status: "synced", syncedAt: hoursAgo(0.2) },
];
const REJECTIONS = [
  { id: "r1", action: "Mark delivered · ORD-1046", kind: "conflict", reason: "This stop was reassigned to Carlo Diaz after you marked it delivered. Check with the office.", queued_at: hoursAgo(4), rejected_at: hoursAgo(1), profiles: { full_name: "Rico Bautista", username: "rico.bautista" } },
  { id: "r2", action: "Packed Tomato · ORD-1050", kind: "conflict", reason: "Tomato was unticked by Ana Reyes after you ticked it. Check the line and tick it again if it’s packed.", queued_at: hoursAgo(6), rejected_at: hoursAgo(2), profiles: { full_name: "Nina Gomez", username: "nina.gomez" } },
  { id: "r3", action: "Mark delivered · ORD-1041", kind: "permission", reason: "Your account can no longer confirm deliveries", queued_at: hoursAgo(30), rejected_at: hoursAgo(26), profiles: { full_name: "Paul Santos", username: "paul.santos" } },
  { id: "r4", action: "Confirm ORD-1032", kind: "discarded", reason: "Discarded by the person before it was sent", queued_at: hoursAgo(50), rejected_at: hoursAgo(48), profiles: { full_name: "Liza Ramos", username: "liza.ramos" } },
];
const CUSTOMERS = [
  { id: "c1", customer_code: "C-0012", business_name: "Casa Verde Restaurant", brand_name: null, contact_person: "Maria Santos", phone: "0917 555 0101", status: "active", tin: null },
  { id: "c2", customer_code: "C-0018", business_name: "Luntian Grocers", brand_name: null, contact_person: "Jon Cruz", phone: "0917 555 0144", status: "active", tin: null },
];

function fakeQuery(table: string) {
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") {
        const rows = table === "sync_rejections" ? REJECTIONS : table === "customers" ? CUSTOMERS : table === "notification_preferences" ? [{ delivery_reminders: true }] : [];
        return (resolve: (value: unknown) => void) => setTimeout(() => resolve({ data: structuredClone(rows), error: null }), 120);
      }
      return () => chain;
    },
  });
  return chain;
}

async function fakeRpc(name: string) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (name === "get_customers") return { data: CUSTOMERS.map((row) => ({ ...row, order_count: 3, last_order_at: hoursAgo(30) })), error: null };
  return { data: null, status: 0, error: { message: "Network request failed", status: 0 } };
}

type Preview = "changes" | "signout" | "problems" | "reports" | "customers";
const PREVIEWS: { key: Preview; label: string }[] = [
  { key: "changes", label: "Offline changes" },
  { key: "signout", label: "Sign out with changes" },
  { key: "problems", label: "Sync problems (admin)" },
  { key: "reports", label: "Reports offline" },
  { key: "customers", label: "Customers offline" },
];

function install(preview: Preview): Preview {
  const client = supabase as unknown as { from: unknown; rpc: unknown };
  client.from = fakeQuery;
  client.rpc = fakeRpc;
  queryClient.clear();
  setTimeout(() => {
    void outboxStore.openPreview(ME).then(() => outboxStore.change(() => structuredClone(OUTBOX)));
    connectivity.force(true);
    // Customers load first (as if opened online earlier), then the connection drops.
    setTimeout(() => connectivity.force(preview === "problems"), preview === "customers" ? 900 : 0);
  }, 0);
  return preview;
}

const person = (role: ProfileRole, full_name: string): Profile => ({
  id: ME, full_name, email: "", username: "preview", role, status: "active",
  must_change_password: false, must_change_reason: null, temp_password_expires_at: null, created_at: "", updated_at: "",
});

export default function OfflinePreview() {
  const [preview, setPreview] = useState<Preview>(() => install("changes"));
  const online = useIsOnline();
  const admin = preview === "problems" || preview === "reports";
  const value = useMemo(() => ({
    session: null, user: null, initialized: true, error: null, profile: admin ? person("administrator", "Ana Mercado") : person("administrative_staff", "Liza Ramos"),
    isActive: true, needsPasswordChange: false, welcomePending: false, knowsCurrentPassword: false,
    matchesSignInPassword: () => false,
    signIn: async () => null, changePassword: async () => ({ ok: true as const }), finishWelcome: () => {},
    signOut: async () => {}, refreshProfile: async () => null, realRole: null, previewRole: null, startRolePreview: () => {}, endRolePreview: () => {},
  }), [admin]);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <View style={styles.page}>
      <SafeAreaView edges={["top"]} style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {PREVIEWS.map((p) => <Chip key={p.key} label={p.label} selected={preview === p.key} onPress={() => setPreview(install(p.key))} />)}
          <Chip label={online ? "Online" : "Offline"} selected={online} onPress={() => connectivity.force(!online)} />
        </ScrollView>
      </SafeAreaView>
      <View style={styles.screen}>
        <AuthContext.Provider value={value}>
          {preview === "changes" ? <SyncScreen key={preview} />
            : preview === "signout" ? <SettingsScreen key={preview} />
            : preview === "problems" ? <SyncProblemsScreen key={preview} />
            : preview === "reports" ? <ReportsScreen key={preview} />
            : <CustomersScreen key={preview} />}
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
