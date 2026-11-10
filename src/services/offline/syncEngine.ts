import { supabase } from "@/services/supabase";
import { queryClient } from "@/services/data/queryClient";
import { connectivity } from "./connectivity";
import { outboxStore } from "./outboxStore";
import { drainOutbox } from "./syncLoop";

/**
 * Sends queued changes one at a time, oldest first, for the signed-in user
 * only. Stops at the first network failure (and tries again when the
 * connection returns) or when the session has ended (and waits for the person
 * to sign in again). A refusal from the server is kept for the person to
 * review and reported to administrators (D-OF4); later changes still go.
 */
type SyncListener = (event: { type: "signed_out" } | { type: "done"; sent: number; rejected: number; permission: boolean }) => void;

let running: Promise<void> | null = null;
const syncListeners = new Set<SyncListener>();

export function onSyncEvent(listener: SyncListener) {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

export function syncNow(): Promise<void> {
  if (running) return running;
  running = run().finally(() => { running = null; });
  return running;
}

export function isSyncing(): boolean {
  return running !== null;
}

async function run() {
  const userId = outboxStore.get().userId;
  if (!userId || !connectivity.online()) return;
  const result = await drainOutbox({
    userId,
    items: () => outboxStore.get().items,
    currentUser: () => outboxStore.get().userId,
    online: () => connectivity.online(),
    change: (fn) => outboxStore.change(fn),
    send: async (rpc, payload) => {
      const response = await supabase.rpc(rpc, payload);
      return { data: response.data, error: response.error ? { ...response.error, status: response.status } : null };
    },
  });
  if (result.noAnswer) connectivity.reportNoAnswer();
  if (result.signedOut) for (const listener of syncListeners) listener({ type: "signed_out" });
  // Refresh every screen once, so they show the server's version of what was sent.
  if (result.sent || result.rejected) await queryClient.invalidateQueries();
  await reportRejections(userId);
  for (const listener of syncListeners) listener({ type: "done", sent: result.sent, rejected: result.rejected, permission: result.permission });
}

/**
 * Records refused changes on the server for administrators (D-OF4). A price
 * review isn't a final refusal, so it is not reported. Duplicates are ignored,
 * so a report that half-arrived is safe to send again.
 */
export async function reportRejections(userId: string, items = outboxStore.get().items, kindOverride?: "discarded") {
  const toReport = items.filter((item) => item.userId === userId && (kindOverride ? true : item.status === "rejected" && item.rejection && !item.rejection.reported && item.rejection.kind !== "price_changed"));
  if (!toReport.length || !connectivity.online()) return false;
  const rows = toReport.map((item) => ({
    request_id: item.id,
    action: item.label.slice(0, 200),
    rpc_name: item.rpc,
    kind: kindOverride ?? item.rejection?.kind ?? "error",
    reason: (kindOverride ? "Discarded by the person before it was sent" : item.rejection?.reason ?? "Refused").slice(0, 1000),
    queued_at: item.queuedAt,
  }));
  const { error } = await supabase.from("sync_rejections").upsert(rows, { onConflict: "user_id,request_id", ignoreDuplicates: true });
  if (error) return false;
  if (!kindOverride) {
    const ids = new Set(toReport.map((item) => item.id));
    await outboxStore.change((list) => list.map((item) => (ids.has(item.id) && item.rejection ? { ...item, rejection: { ...item.rejection, reported: true } } : item)));
  }
  return true;
}
