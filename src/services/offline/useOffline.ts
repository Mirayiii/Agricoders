import { useSyncExternalStore } from "react";

import { connectivity } from "./connectivity";
import { countsFor, latestFor, type OutboxAction } from "./outboxLogic";
import { outboxStore } from "./outboxStore";

export function useConnection() {
  return useSyncExternalStore(connectivity.subscribe, connectivity.get, connectivity.get);
}

export function useIsOnline(): boolean {
  const connection = useConnection();
  return connection.online && !connection.serverUnreachable;
}

export function useOutbox() {
  const state = useSyncExternalStore(outboxStore.subscribe, outboxStore.get, outboxStore.get);
  const userId = state.userId ?? "";
  const items = state.items.filter((item) => item.userId === userId);
  return { items, durable: state.durable, counts: countsFor(state.items, userId), userId: state.userId };
}

/** The newest queued change for a record (a stop, an order line, an order), if any. */
export function useQueuedChange(targetId: string | null | undefined): OutboxAction | undefined {
  const state = useSyncExternalStore(outboxStore.subscribe, outboxStore.get, outboxStore.get);
  return targetId && state.userId ? latestFor(state.items, state.userId, targetId) : undefined;
}
