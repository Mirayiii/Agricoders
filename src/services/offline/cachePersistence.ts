import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { persistQueryClientRestore, persistQueryClientSubscribe } from "@tanstack/react-query-persist-client";

import { queryClient } from "@/services/data/queryClient";

/**
 * Keeps the last loaded data on the phone so screens can show it offline
 * (plan 10.2 to 10.6). Only with "Keep me signed in" on; otherwise the cache
 * stays in memory and is gone when the app closes. One key per user, so a
 * second account on the same phone never sees the first one's data.
 * Reports are never saved: offline they show an empty state (plan 10.7).
 */
const KEY_PREFIX = "meah.cache.v1.";
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
// Bump when the shape of saved data changes, so old saves are dropped.
const BUSTER = "phase10-1";
const NOT_SAVED = new Set(["reports"]);

let stop: (() => void) | null = null;
let current: string | null = null;

export async function startCachePersistence(userId: string | null, durable: boolean) {
  const key = userId && durable ? `${KEY_PREFIX}${userId}` : null;
  if (key === current) return;
  stop?.();
  stop = null;
  current = key;
  if (!key) return;
  const persister = createAsyncStoragePersister({ storage: AsyncStorage, key, throttleTime: 2000 });
  await persistQueryClientRestore({ queryClient, persister, maxAge: MAX_AGE, buster: BUSTER });
  if (current !== key) return;
  stop = persistQueryClientSubscribe({
    queryClient,
    persister,
    buster: BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => query.state.status === "success" && !NOT_SAVED.has(String(query.queryKey[0])),
    },
  });
}

export async function clearSavedCache(userId: string) {
  if (current === `${KEY_PREFIX}${userId}`) {
    stop?.();
    stop = null;
    current = null;
  }
  await AsyncStorage.removeItem(`${KEY_PREFIX}${userId}`).catch(() => {});
}

/** The time of the newest data on screen, for "Showing data saved at …". */
export function newestDataAt(): number | null {
  let newest = 0;
  for (const query of queryClient.getQueryCache().getAll()) newest = Math.max(newest, query.state.dataUpdatedAt);
  return newest || null;
}
