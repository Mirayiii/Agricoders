import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { onlineManager } from "@tanstack/react-query";

/**
 * Whether the phone can reach the internet (plan 10.1). React Query pauses
 * fetches while offline, so screens keep showing the last saved data instead
 * of failing. A request that fails with no answer also marks the app offline
 * until the next check, because a phone can be "connected" to a network that
 * doesn't reach the server.
 */
type Connection = { online: boolean; checkedAt: number; serverUnreachable: boolean };

let connection: Connection = { online: true, checkedAt: Date.now(), serverUnreachable: false };
const listeners = new Set<() => void>();

function set(next: Connection) {
  const wasOnline = isOnline(connection);
  connection = next;
  onlineManager.setOnline(isOnline(next));
  for (const listener of listeners) listener();
  if (!wasOnline && isOnline(next)) for (const callback of backOnline) callback();
}

const backOnline = new Set<() => void>();

function isOnline(value: Connection) {
  return value.online && !value.serverUnreachable;
}

function fromNetInfo(info: NetInfoState): boolean {
  // isInternetReachable is null while unknown; treat unknown as online and let requests decide.
  return Boolean(info.isConnected) && info.isInternetReachable !== false;
}

let started = false;

export const connectivity = {
  start() {
    if (started) return;
    started = true;
    NetInfo.addEventListener((info) => set({ online: fromNetInfo(info), checkedAt: Date.now(), serverUnreachable: false }));
    // React Query's own detection would race with this one; this is the only source.
    onlineManager.setEventListener(() => () => {});
  },
  get(): Connection {
    return connection;
  },
  online(): boolean {
    return isOnline(connection);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  onBackOnline(callback: () => void) {
    backOnline.add(callback);
    return () => backOnline.delete(callback);
  },
  /** A request got no answer: treat the server as unreachable until the next check. */
  reportNoAnswer() {
    set({ ...connection, serverUnreachable: true, checkedAt: Date.now() });
  },
  /** Retry: ask the phone again, and clear "server unreachable". */
  async check(): Promise<boolean> {
    const info = await NetInfo.refresh();
    set({ online: fromNetInfo(info), checkedAt: Date.now(), serverUnreachable: false });
    return isOnline(connection);
  },
  /** For dev previews and tests only. */
  force(online: boolean) {
    set({ online, checkedAt: Date.now(), serverUnreachable: false });
  },
};
