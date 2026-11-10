import AsyncStorage from "@react-native-async-storage/async-storage";

import { recoverAfterRestart, expireOld, pruneSynced, type OutboxAction } from "./outboxLogic";

/**
 * Where the outbox lives. With "Keep me signed in" on, it is saved on the
 * phone so it survives a restart. With it off, it is kept in memory only,
 * like the session, and the app warns before accepting an offline change.
 * Each user has their own key: one person's changes are never shown to or
 * sent by another account on the same phone.
 */
const KEY_PREFIX = "meah.outbox.v1.";
const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`;

type State = { userId: string | null; durable: boolean; items: OutboxAction[]; loaded: boolean };

let state: State = { userId: null, durable: false, items: [], loaded: false };
const listeners = new Set<() => void>();
const memory = new Map<string, OutboxAction[]>();
/** Dev previews only: an account to use while nobody is signed in. */
let previewUser: string | null = null;

function emit() {
  for (const listener of listeners) listener();
}

async function save(next: State) {
  if (!next.userId) return;
  memory.set(next.userId, next.items);
  if (next.durable) {
    try {
      await AsyncStorage.setItem(keyFor(next.userId), JSON.stringify(next.items));
    } catch {
      // Storage full or unavailable: the in-memory copy still works until the app closes.
    }
  }
}

export const outboxStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(): State {
    return state;
  },
  /** Opens the outbox for the signed-in user. Called on sign-in, app start and account change. */
  async open(signedInUser: string | null, durable: boolean) {
    const userId = signedInUser ?? (__DEV__ ? previewUser : null);
    if (!userId) {
      state = { userId: null, durable, items: [], loaded: true };
      emit();
      return;
    }
    let items = memory.get(userId) ?? [];
    if (durable && !memory.has(userId)) {
      try {
        const raw = await AsyncStorage.getItem(keyFor(userId));
        items = raw ? (JSON.parse(raw) as OutboxAction[]) : [];
      } catch {
        items = [];
      }
    }
    // Only this user's changes, and anything interrupted mid-send goes back to waiting.
    items = expireOld(pruneSynced(recoverAfterRestart(items.filter((item) => item.userId === userId)), new Date()), new Date());
    state = { userId, durable, items, loaded: true };
    await save(state);
    emit();
  },
  /** Dev previews: use a pretend account's in-memory outbox (never saved). */
  async openPreview(userId: string | null) {
    if (!__DEV__) return;
    previewUser = userId;
    if (userId) memory.delete(userId);
    await this.open(userId, false);
  },
  /** Applies a change to the current user's outbox and saves it. */
  async change(fn: (items: OutboxAction[]) => OutboxAction[]) {
    if (!state.userId) return;
    state = { ...state, items: fn(state.items) };
    emit();
    await save(state);
  },
  /** Turning "Keep me signed in" on or off moves the outbox to or from the phone's storage. */
  async setDurable(durable: boolean) {
    if (state.durable === durable) return;
    state = { ...state, durable };
    if (!durable && state.userId) await AsyncStorage.removeItem(keyFor(state.userId)).catch(() => {});
    await save(state);
    emit();
  },
  /** Removes a user's outbox from the phone (logout with nothing left, or a confirmed discard). */
  async clear(userId: string) {
    memory.delete(userId);
    await AsyncStorage.removeItem(keyFor(userId)).catch(() => {});
    if (state.userId === userId) {
      state = { ...state, items: [] };
      emit();
    }
  },
};
