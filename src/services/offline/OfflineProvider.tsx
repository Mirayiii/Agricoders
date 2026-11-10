import { router } from "expo-router";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { sessionStorage } from "../../../lib/sessionStorage";
import { BottomSheet } from "@/components/BottomSheet";
import { Button } from "@/components/Button";
import { ConnectionBanner, type ConnectionBannerState } from "@/components/Connection";
import { colors, spacing, typography } from "@/constants/theme";
import { useAuth } from "@/features/auth/useAuth";
import { savedAtLabel } from "@/services/data/staleness";
import { clearSavedCache, newestDataAt, startCachePersistence } from "./cachePersistence";
import { connectivity } from "./connectivity";
import { runOrQueue, type RunResult } from "./offlineActions";
import { unsynced, type NewAction } from "./outboxLogic";
import { outboxStore } from "./outboxStore";
import { onSyncEvent, reportRejections, syncNow } from "./syncEngine";
import { useIsOnline, useOutbox } from "./useOffline";

type OfflineContextValue = {
  /** Sends one of the offline-safe changes now, or queues it (see runOrQueue). */
  run: <T>(action: Omit<NewAction, "userId">) => Promise<RunResult<T>>;
  /** Sign out with the D-OF2 choices when changes haven't synced. */
  requestSignOut: () => void;
  syncNow: () => Promise<void>;
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function useOffline() {
  const value = useContext(OfflineContext);
  if (!value) throw new Error("useOffline must be used within the OfflineProvider.");
  return value;
}

/** Outside the provider (dev previews), signing out just signs out. */
export function useOfflineOptional() {
  return useContext(OfflineContext);
}

let started = false;

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { session, profile, signOut, refreshProfile, error: authError } = useAuth();
  // The real account, even during a role preview (the id never changes then).
  const userId = session && profile ? profile.id : null;
  const [memoryAsk, setMemoryAsk] = useState<((ok: boolean) => void) | null>(null);
  const warnedMemoryOnly = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  // Whose session the server said had ended; a new sign-in clears it.
  const [endedFor, setEndedFor] = useState<string | null>(null);
  const sessionEnded = userId !== null && endedFor === userId;

  useEffect(() => {
    if (started) return;
    started = true;
    connectivity.start();
  }, []);

  // A deactivated account is signed out by the auth provider. Its queued
  // changes were already refused and recorded for administrators when it
  // synced, so its outbox and saved data are removed from the phone.
  const lastUser = useRef<string | null>(null);
  useEffect(() => {
    if (userId) {
      lastUser.current = userId;
      return;
    }
    const previous = lastUser.current;
    if (previous && authError?.startsWith("Account deactivated")) {
      lastUser.current = null;
      void outboxStore.clear(previous);
      void clearSavedCache(previous);
    }
  }, [userId, authError]);

  // Open this user's outbox and saved data; nothing from another account is used.
  useEffect(() => {
    const durable = sessionStorage.isPersistent();
    void outboxStore.open(userId, durable).then(() => (userId ? syncNow() : undefined));
    void startCachePersistence(userId, durable);
  }, [userId]);

  useEffect(() => {
    const offBack = connectivity.onBackOnline(() => void syncNow());
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") void syncNow(); });
    const offSync = onSyncEvent((event) => {
      if (event.type === "signed_out") setEndedFor(outboxStore.get().userId);
      // A permission refusal may mean the account was deactivated: check, and sign out if so.
      if (event.type === "done" && event.sent) setEndedFor(null);
      if (event.type === "done" && event.permission) void refreshProfile();
    });
    return () => { offBack(); appState.remove(); offSync(); };
  }, [refreshProfile]);

  const confirmMemoryOnly = useCallback(() => {
    if (warnedMemoryOnly.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const answer = (ok: boolean) => {
        if (ok) warnedMemoryOnly.current = true;
        setMemoryAsk(null);
        resolve(ok);
      };
      // Usually asked from inside a sheet. A system alert shows above it on
      // phones; on the web the warning sheet is mounted last so it's on top.
      if (Platform.OS !== "web") {
        Alert.alert("Save this change offline?", `${MEMORY_ONLY_TEXT}\n\n${MEMORY_ONLY_HINT}`, [
          { text: "Don’t save", style: "cancel", onPress: () => answer(false) },
          { text: "Save offline anyway", onPress: () => answer(true) },
        ], { cancelable: true, onDismiss: () => answer(false) });
      } else setMemoryAsk(() => answer);
    });
  }, []);

  const finishSignOut = useCallback(async (discard: boolean) => {
    const id = outboxStore.get().userId;
    if (id) {
      if (discard) {
        // Record the discarded changes for administrators only if the server can be reached (D-OF4).
        // Refusals keep their own reason; changes never sent are recorded as discarded.
        await reportRejections(id).catch(() => false);
        const neverSent = unsynced(outboxStore.get().items, id).filter((item) => item.status !== "rejected");
        await reportRejections(id, neverSent, "discarded").catch(() => false);
      }
      await outboxStore.clear(id);
      await clearSavedCache(id);
    }
    setSigningOut(false);
    setEndedFor(null);
    await signOut();
  }, [signOut]);

  const requestSignOut = useCallback(() => {
    const id = outboxStore.get().userId;
    if (id && unsynced(outboxStore.get().items, id).length) setSigningOut(true);
    else void finishSignOut(false);
  }, [finishSignOut]);

  const value = useMemo<OfflineContextValue>(() => ({
    run: (action) => {
      // Changes always belong to the account whose outbox is open, never a previous one.
      const owner = outboxStore.get().userId;
      if (!owner) return Promise.reject(new Error("Sign in again to save this change."));
      return runOrQueue({ ...action, userId: owner }, confirmMemoryOnly);
    },
    requestSignOut,
    syncNow,
  }), [confirmMemoryOnly, requestSignOut]);

  return (
    <OfflineContext.Provider value={value}>
      <OfflineFrame sessionEnded={sessionEnded} onSignIn={() => { setEndedFor(null); void signOut(); }}>{children}</OfflineFrame>
      {memoryAsk ? (
        <BottomSheet visible onClose={() => memoryAsk(false)}>
          <MemoryOnlyWarning onAnswer={memoryAsk} />
        </BottomSheet>
      ) : null}
      <BottomSheet visible={signingOut} onClose={() => setSigningOut(false)}>
        {signingOut ? <SignOutWithChanges onCancel={() => setSigningOut(false)} onDiscard={() => void finishSignOut(true)} onSignedOutAfterSync={() => void finishSignOut(false)} /> : null}
      </BottomSheet>
    </OfflineContext.Provider>
  );
}

const MEMORY_ONLY_TEXT = "You’re offline, and “Keep me signed in” was off when you signed in, so offline changes are kept only until the app closes. If the app closes or restarts before you’re back online, this change is lost.";
const MEMORY_ONLY_HINT = "To keep offline changes through a restart, sign in again with “Keep me signed in” on once you’re online.";

/** "Keep me signed in" is off: an offline change lives only until the app closes. */
function MemoryOnlyWarning({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">Save this change offline?</Text>
      <Text style={styles.body}>{MEMORY_ONLY_TEXT}</Text>
      <Text style={styles.body}>{MEMORY_ONLY_HINT}</Text>
      <Button label="Save offline anyway" size="lg" onPress={() => onAnswer(true)} />
      <Button label="Don’t save" type="secondary" size="lg" onPress={() => onAnswer(false)} />
    </>
  );
}

/** D-OF2: never trap someone in a session, never drop changes without a clear, confirmed choice. */
function SignOutWithChanges({ onCancel, onDiscard, onSignedOutAfterSync }: { onCancel: () => void; onDiscard: () => void; onSignedOutAfterSync: () => void }) {
  const { items } = useOutbox();
  const online = useIsOnline();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const waiting = items.filter((item) => item.status === "pending" || item.status === "syncing");
  const review = items.filter((item) => item.status === "rejected");
  const total = waiting.length + review.length;
  const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

  if (confirmDiscard) {
    return (
      <>
        <Text style={styles.title} accessibilityRole="header">Discard {changes(total)} and sign out?</Text>
        <Text style={styles.body}>
          {waiting.length ? `${changes(waiting.length)} you made offline will never be sent. ` : ""}This can’t be undone.
          {online ? " Administrators will see what was discarded." : " You’re offline, so this can’t be recorded for administrators."}
        </Text>
        {[...waiting, ...review].slice(0, 6).map((item) => <Text key={item.id} style={styles.item}>• {item.label}</Text>)}
        {total > 6 ? <Text style={styles.item}>and {total - 6} more</Text> : null}
        <Button label={`Discard and sign out`} type="danger" size="lg" onPress={onDiscard} />
        <Button label="Go back" type="secondary" size="lg" onPress={() => setConfirmDiscard(false)} />
      </>
    );
  }

  return (
    <>
      <Text style={styles.title} accessibilityRole="header">{changes(total)} not synced</Text>
      <Text style={styles.body}>
        {waiting.length ? `${changes(waiting.length)} haven’t been sent yet. ` : ""}
        {review.length ? `${changes(review.length)} were refused and need your review. ` : ""}
        Signing out removes them from this phone.
      </Text>
      {waiting.length ? (
        <Button
          label={online ? "Sync now" : "Sync now (you’re offline)"}
          size="lg"
          disabled={!online}
          loading={syncing}
          onPress={() => {
            setSyncing(true);
            void syncNow().finally(() => {
              setSyncing(false);
              const id = outboxStore.get().userId;
              if (id && !unsynced(outboxStore.get().items, id).length) onSignedOutAfterSync();
            });
          }}
        />
      ) : null}
      {review.length && !waiting.length ? <Button label="Review changes" size="lg" onPress={() => { onCancel(); router.push("/sync"); }} /> : null}
      <Button label="Cancel sign out" type="secondary" size="lg" onPress={onCancel} />
      <Button label="Discard and sign out" type="danger" size="lg" onPress={() => setConfirmDiscard(true)} />
    </>
  );
}

/** The connection banner above every screen (Figma Connection Banner). */
function OfflineFrame({ children, sessionEnded, onSignIn }: { children: ReactNode; sessionEnded: boolean; onSignIn: () => void }) {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const { counts, userId } = useOutbox();
  const [backOnline, setBackOnline] = useState(false);
  const wasOnline = useRef(online);

  useEffect(() => {
    if (!wasOnline.current && online) {
      setBackOnline(true);
      const timer = setTimeout(() => setBackOnline(false), 4000);
      wasOnline.current = online;
      return () => clearTimeout(timer);
    }
    wasOnline.current = online;
    return undefined;
  }, [online]);

  const waiting = counts.pending + counts.syncing;
  const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;
  let banner: { state: ConnectionBannerState; message: string; action?: string; onAction?: () => void } | null = null;
  if (!userId) banner = null;
  else if (!online) {
    const saved = newestDataAt();
    banner = {
      state: "offline",
      message: waiting ? `You’re offline · ${changes(waiting)} waiting to sync` : `You’re offline${saved ? ` · Showing data saved at ${savedAtLabel(saved)}` : ""}`,
      action: "Retry",
      onAction: () => void connectivity.check().then((ok) => (ok ? syncNow() : undefined)),
    };
  } else if (sessionEnded && waiting) banner = { state: "review", message: `Sign in again to send ${changes(waiting)}`, action: "Sign in", onAction: onSignIn };
  else if (counts.syncing) banner = { state: "syncing", message: `Syncing ${changes(waiting)}…` };
  else if (counts.rejected) banner = { state: "review", message: `${changes(counts.rejected)} need${counts.rejected === 1 ? "s" : ""} your review`, action: "Review", onAction: () => router.push("/sync") };
  else if (counts.pending) banner = { state: "syncing", message: `${changes(counts.pending)} waiting to sync`, action: "Sync now", onAction: () => void syncNow() };
  else if (backOnline) banner = { state: "backOnline", message: counts.synced ? "Back online · All changes synced" : "Back online" };

  // The tree around the app stays the same whether or not a banner shows, so
  // screens (and anything typed in them) are never remounted by a banner.
  return (
    <View style={styles.fill}>
      {banner ? (
        <View style={{ paddingTop: insets.top, backgroundColor: bannerColor(banner.state) }}>
          <ConnectionBanner state={banner.state} message={banner.message} actionLabel={banner.action} onAction={banner.onAction} />
        </View>
      ) : null}
      <SafeAreaInsetsContext.Provider value={banner ? { ...insets, top: 0 } : insets}>
        <View style={styles.fill}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

function bannerColor(state: ConnectionBannerState) {
  return { offline: colors.danger, syncing: colors.info, backOnline: colors.primary, review: colors.warning }[state];
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  body: { ...typography.body, lineHeight: 22, color: colors.textSecondary },
  item: { ...typography.caption, color: colors.text, paddingLeft: spacing.xs },
});
