/**
 * The outbox (Phase 10): changes made offline, kept per user and sent in order
 * when the connection returns. Pure functions only, so they can be tested and
 * replayed after a restart. The server re-checks everything (see the
 * offline_* functions in 202611030009_phase10_offline.sql).
 */

/** The four changes that may be queued offline (rollout plan 0.6 and 10.2 to 10.5). */
export type OfflineRpc = "offline_complete_delivery" | "offline_set_item_packed" | "offline_confirm_order" | "offline_create_order";

export type OutboxStatus = "pending" | "syncing" | "synced" | "rejected";

/** Why the server refused a change. Every refusal needs the person to review it. */
export type RejectionKind = "conflict" | "expired" | "price_changed" | "permission" | "error";

export type PriceChange = { product_id: string; product_name: string | null; unit: string; seen_price: number; current_price: number };

export type Rejection = { kind: RejectionKind; reason: string; at: string; priceChanges?: PriceChange[]; reported: boolean };

export type OutboxAction = {
  /** Also the client request id, so a replay is never applied twice. */
  id: string;
  userId: string;
  rpc: OfflineRpc;
  /** Arguments for the RPC, without p_client_request_id and p_offline. */
  args: Record<string, unknown>;
  /** What the person saw when they made the change, for the server's version checks. */
  seen: Record<string, unknown>;
  /** Shown in lists, e.g. "Mark delivered · ORD-1023". */
  label: string;
  /** The record this changes (delivery, order line or order), to show "waiting to sync" on it. */
  targetId: string;
  queuedAt: string;
  status: OutboxStatus;
  attempts: number;
  lastTriedAt?: string;
  syncedAt?: string;
  result?: unknown;
  rejection?: Rejection;
  /** Set when the person reviewed changed prices on a queued new order and chose to send it. */
  acceptCurrentPrices?: boolean;
};

export const MAX_QUEUE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Synced changes stay listed for a day so people can see they went through. */
export const SYNCED_KEEP_MS = 24 * 60 * 60 * 1000;

export type NewAction = Pick<OutboxAction, "id" | "userId" | "rpc" | "args" | "seen" | "label" | "targetId"> & { acceptCurrentPrices?: boolean };

export function enqueue(list: readonly OutboxAction[], action: NewAction, now: Date): OutboxAction[] {
  if (list.some((item) => item.id === action.id)) return [...list];
  return [...list, { ...action, queuedAt: now.toISOString(), status: "pending", attempts: 0 }];
}

/** After a restart, a change that was being sent is sent again; the server returns the first result if it already arrived. */
export function recoverAfterRestart(list: readonly OutboxAction[]): OutboxAction[] {
  return list.map((item) => (item.status === "syncing" ? { ...item, status: "pending" } : item));
}

/** Changes queued more than 30 days ago are refused here too, never replayed as new (D-OF3). */
export function expireOld(list: readonly OutboxAction[], now: Date): OutboxAction[] {
  return list.map((item) =>
    item.status === "pending" && now.getTime() - Date.parse(item.queuedAt) > MAX_QUEUE_AGE_MS
      ? {
        ...item,
        status: "rejected",
        rejection: { kind: "expired", reason: "This change was saved offline more than 30 days ago, so it was not sent. Enter it again if it is still needed.", at: now.toISOString(), reported: false },
      }
      : item,
  );
}

export function nextToSend(list: readonly OutboxAction[], userId: string): OutboxAction | undefined {
  return list
    .filter((item) => item.userId === userId && item.status === "pending")
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))[0];
}

export function update(list: readonly OutboxAction[], id: string, change: Partial<OutboxAction>): OutboxAction[] {
  return list.map((item) => (item.id === id ? { ...item, ...change } : item));
}

export function markSyncing(list: readonly OutboxAction[], id: string, now: Date): OutboxAction[] {
  return list.map((item) => (item.id === id ? { ...item, status: "syncing", attempts: item.attempts + 1, lastTriedAt: now.toISOString() } : item));
}

/** Waiting, sending, or refused and not yet reviewed: these block a quiet logout (D-OF2). */
export function unsynced(list: readonly OutboxAction[], userId: string): OutboxAction[] {
  return list.filter((item) => item.userId === userId && item.status !== "synced");
}

/** A person may cancel a change that hasn't been sent, or dismiss one that was refused. Not while it is being sent. */
export function canRemove(item: OutboxAction): boolean {
  return item.status === "pending" || item.status === "rejected" || item.status === "synced";
}

export function remove(list: readonly OutboxAction[], id: string): OutboxAction[] {
  return list.filter((item) => !(item.id === id && canRemove(item)));
}

export function pruneSynced(list: readonly OutboxAction[], now: Date): OutboxAction[] {
  return list.filter((item) => item.status !== "synced" || now.getTime() - Date.parse(item.syncedAt ?? item.queuedAt) < SYNCED_KEEP_MS);
}

export type Counts = { pending: number; syncing: number; rejected: number; synced: number };

export function countsFor(list: readonly OutboxAction[], userId: string): Counts {
  const counts: Counts = { pending: 0, syncing: 0, rejected: 0, synced: 0 };
  for (const item of list) if (item.userId === userId) counts[item.status] += 1;
  return counts;
}

/** The latest queued change for a record, to show its state on screen. */
export function latestFor(list: readonly OutboxAction[], userId: string, targetId: string): OutboxAction | undefined {
  return list.filter((item) => item.userId === userId && item.targetId === targetId).sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))[0];
}

// ---------------------------------------------------------------------------
// Errors: network, signed out, permission and server refusals are different.
// ---------------------------------------------------------------------------
export type ErrorLike = { message?: string; code?: string; details?: string | null; hint?: string | null; status?: number };

export type Outcome =
  | { type: "network" }
  | { type: "signed_out" }
  | { type: "rejected"; rejection: Omit<Rejection, "at" | "reported"> };

export function classifyError(error: ErrorLike | null | undefined): Outcome {
  const message = error?.message ?? "";
  const code = error?.code ?? "";
  // No answer from the server at all: keep the change and try again later.
  if (!error || error.status === 0 || /fetch|network|timed? ?out|load failed|connection/i.test(message) && !code) return { type: "network" };
  // The session ended (expired, revoked, or signed out elsewhere): sign in again; the change stays queued.
  if (error.status === 401 || code === "PGRST301" || code === "PGRST302" || /jwt|not authenticated|session/i.test(message) && !code.startsWith("4")) return { type: "signed_out" };
  if (code === "42501") return { type: "rejected", rejection: { kind: "permission", reason: message || "Your account can no longer make this change." } };
  if (code === "OFEXP") return { type: "rejected", rejection: { kind: "expired", reason: message } };
  if (code === "OFPRC") return { type: "rejected", rejection: { kind: "price_changed", reason: "Prices changed since this order was entered. Review the new prices before sending it.", priceChanges: parsePriceChanges(error.details) } };
  if (code === "OFCON") return { type: "rejected", rejection: { kind: "conflict", reason: message } };
  return { type: "rejected", rejection: { kind: "error", reason: message || "The server refused this change." } };
}

function parsePriceChanges(details: string | null | undefined): PriceChange[] {
  try {
    const parsed = JSON.parse(details ?? "[]") as PriceChange[];
    return Array.isArray(parsed) ? parsed.map((row) => ({ ...row, seen_price: Number(row.seen_price), current_price: Number(row.current_price) })) : [];
  } catch {
    return [];
  }
}

/** The RPC arguments for a queued change, with the request id and what the person saw. */
export function payloadFor(item: OutboxAction): Record<string, unknown> {
  const offline: Record<string, unknown> = { queued_at: item.queuedAt, seen: item.seen };
  if (item.rpc === "offline_create_order") {
    offline.seen_prices = item.seen.prices ?? [];
    if (item.acceptCurrentPrices) offline.accept_current_prices = true;
  }
  // Packing ticks and "delivered" carry the order's packing version, so a
  // change made after the screen was loaded is refused instead of overwritten.
  if (item.seen.packing_version != null) offline.packing_version = item.seen.packing_version;
  return { ...item.args, p_client_request_id: item.id, p_offline: offline };
}

/** After reviewing new prices, send the order again at today's prices. */
export function acceptPrices(list: readonly OutboxAction[], id: string): OutboxAction[] {
  return list.map((item) => (item.id === id && item.rejection?.kind === "price_changed" ? { ...item, status: "pending", acceptCurrentPrices: true, rejection: undefined } : item));
}
