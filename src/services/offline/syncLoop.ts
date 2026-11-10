import { classifyError, markSyncing, nextToSend, payloadFor, update, type ErrorLike, type OutboxAction } from "./outboxLogic";

/**
 * The sending loop, kept free of the app's singletons so it can be tested.
 * Sends one change at a time, oldest first, for one user only. Stops at the
 * first change with no answer (it stays queued) or when the session has ended
 * (it stays queued until the person signs in again). A refusal is kept for
 * review and later changes still go. Stops if the account changes meanwhile.
 */
export type SyncDeps = {
  userId: string;
  items: () => readonly OutboxAction[];
  currentUser: () => string | null;
  online: () => boolean;
  change: (fn: (items: OutboxAction[]) => OutboxAction[]) => Promise<void>;
  send: (rpc: string, payload: Record<string, unknown>) => Promise<{ data: unknown; error: ErrorLike | null }>;
  now?: () => Date;
};

export type SyncResult = { sent: number; rejected: number; permission: boolean; noAnswer: boolean; signedOut: boolean };

export async function drainOutbox(deps: SyncDeps): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const result: SyncResult = { sent: 0, rejected: 0, permission: false, noAnswer: false, signedOut: false };
  for (;;) {
    if (deps.currentUser() !== deps.userId || !deps.online()) break;
    const next = nextToSend(deps.items(), deps.userId);
    if (!next) break;
    await deps.change((items) => markSyncing(items, next.id, now()));
    let response: { data: unknown; error: ErrorLike | null };
    try {
      response = await deps.send(next.rpc, payloadFor(next));
    } catch (thrown) {
      response = { data: null, error: { message: thrown instanceof Error ? thrown.message : String(thrown), status: 0 } };
    }
    if (!response.error) {
      result.sent += 1;
      await deps.change((items) => update(items, next.id, { status: "synced", syncedAt: now().toISOString(), result: response.data }));
      continue;
    }
    const outcome = classifyError(response.error);
    if (outcome.type === "network") {
      await deps.change((items) => update(items, next.id, { status: "pending" }));
      result.noAnswer = true;
      break;
    }
    if (outcome.type === "signed_out") {
      await deps.change((items) => update(items, next.id, { status: "pending" }));
      result.signedOut = true;
      break;
    }
    result.rejected += 1;
    if (outcome.rejection.kind === "permission") result.permission = true;
    await deps.change((items) => update(items, next.id, { status: "rejected", rejection: { ...outcome.rejection, at: now().toISOString(), reported: false } }));
  }
  return result;
}
