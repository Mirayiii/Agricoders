import { supabase } from "@/services/supabase";
import { DataError } from "@/services/data/supabaseQuery";
import { connectivity } from "./connectivity";
import { classifyError, enqueue, payloadFor, type NewAction, type OutboxAction, type PriceChange } from "./outboxLogic";
import { outboxStore } from "./outboxStore";

export type RunResult<T> = { queued: false; result: T } | { queued: true; action: OutboxAction };

/** Thrown when a change can't be queued (the person said no to a memory-only change). */
export class NotQueuedError extends Error {}

/** A new order sent online whose prices differ from the ones shown: nothing was saved. */
export class PriceChangedError extends DataError {
  constructor(message: string, readonly changes: PriceChange[]) {
    super(message, "OFPRC");
  }
}

/**
 * Sends one of the four offline-safe changes now, or queues it.
 * - Online: sends it straight away through the same offline_* function the
 *   outbox uses, with the same request id, so a retry after a dropped
 *   connection is never applied twice.
 * - Offline, or no answer from the server: queues it. If the outbox only lives
 *   in memory ("Keep me signed in" off), `confirmMemoryOnly` asks first.
 * - A refusal is thrown as a DataError with the server's reason.
 */
export async function runOrQueue<T>(action: NewAction, confirmMemoryOnly: () => Promise<boolean>): Promise<RunResult<T>> {
  const now = new Date();
  const queue = async (): Promise<RunResult<T>> => {
    if (!outboxStore.get().durable && !(await confirmMemoryOnly())) throw new NotQueuedError("Not saved offline");
    await outboxStore.change((items) => enqueue(items, action, now));
    const queued = outboxStore.get().items.find((item) => item.id === action.id);
    if (!queued) throw new NotQueuedError("Not saved offline");
    return { queued: true, action: queued };
  };
  if (!connectivity.online()) return queue();
  const draft: OutboxAction = { ...action, queuedAt: now.toISOString(), status: "pending", attempts: 0 };
  let error: { message?: string; code?: string; details?: string | null; status?: number } | null = null;
  let data: unknown = null;
  try {
    const response = await supabase.rpc(action.rpc, payloadFor(draft));
    data = response.data;
    error = response.error ? { ...response.error, status: response.status } : null;
  } catch (thrown) {
    error = { message: thrown instanceof Error ? thrown.message : String(thrown), status: 0 };
  }
  if (!error) return { queued: false, result: data as T };
  const outcome = classifyError(error);
  if (outcome.type === "network") {
    connectivity.reportNoAnswer();
    return queue();
  }
  if (outcome.type === "signed_out") throw new DataError("Your session ended. Sign in again, then try once more.", "signed_out");
  if (outcome.rejection.kind === "price_changed") throw new PriceChangedError(outcome.rejection.reason, outcome.rejection.priceChanges ?? []);
  throw new DataError(outcome.rejection.reason, error.code);
}
