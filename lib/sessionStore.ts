/**
 * Where the Supabase session is kept (D8, and task 0.6 "session tokens in
 * secure storage", done in Phase 10). Kept free of React Native imports so it
 * can be tested; `sessionStorage.ts` wires it to the real stores.
 *
 * - "Keep me signed in" on: the session is saved in the phone's secure store
 *   (Keychain on iOS, Keystore-backed storage on Android). On the web there is
 *   no secure store, so it stays in the browser's storage as before.
 * - "Keep me signed in" off: the session lives only in memory, so closing the
 *   app signs the person out. Nothing is written to any store.
 * - Sessions saved in plain storage by earlier versions are moved into the
 *   secure store the first time they are read, then removed from plain storage.
 * - A store that fails never stops sign-in: the session is kept in memory for
 *   this run. Nothing here logs or throws token values.
 *
 * Secure stores limit how much one item may hold (about 2 KB on Android), and
 * a Supabase session is larger, so a value is saved as numbered chunks with a
 * count, and read back only when every chunk is there.
 */

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type SessionStoreOptions = {
  /** The phone's secure store, or null on the web. */
  secure: KeyValueStore | null;
  /** Plain storage (AsyncStorage): the web's store, and where older versions saved sessions. */
  plain: KeyValueStore & { getAllKeys(): Promise<readonly string[]>; multiRemove(keys: string[]): Promise<void> };
  /** Called with a short reason, never a key's value. */
  onProblem?: (reason: string) => void;
};

export const CHUNK_SIZE = 1800;
/** Names of the session keys saved in the secure store, so they can be removed when "Keep me signed in" is turned off. */
export const INDEX_KEY = "meah_session_index";

// Secure store keys may only use letters, digits, ".", "-" and "_".
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");
const countKey = (key: string) => `${safe(key)}.count`;
const chunkKey = (key: string, index: number) => `${safe(key)}.${index}`;

export function createSessionStore({ secure, plain, onProblem }: SessionStoreOptions) {
  const memory = new Map<string, string>();
  let persistent = true;
  let failed = false;

  const problem = (reason: string) => {
    failed = true;
    onProblem?.(reason);
  };

  async function readSecure(store: KeyValueStore, key: string): Promise<string | null> {
    const count = Number(await store.getItem(countKey(key)));
    if (!Number.isInteger(count) || count <= 0) return null;
    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = await store.getItem(chunkKey(key, index));
      if (part === null) return null; // half-written: treat as signed out
      parts.push(part);
    }
    return parts.join("");
  }

  async function removeSecure(store: KeyValueStore, key: string) {
    const count = Number(await store.getItem(countKey(key)).catch(() => null));
    await store.removeItem(countKey(key));
    const last = Number.isInteger(count) && count > 0 ? count : 0;
    for (let index = 0; index < last; index += 1) await store.removeItem(chunkKey(key, index));
  }

  async function writeSecure(store: KeyValueStore, key: string, value: string) {
    // The count is written last, so a cut-off write reads as no session rather than a broken one.
    await removeSecure(store, key);
    const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, "g")) ?? [""];
    for (let index = 0; index < parts.length; index += 1) await store.setItem(chunkKey(key, index), parts[index]);
    await store.setItem(countKey(key), String(parts.length));
    await remember(store, key);
  }

  async function savedKeys(store: KeyValueStore): Promise<string[]> {
    try {
      const raw = await store.getItem(INDEX_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  async function remember(store: KeyValueStore, key: string) {
    const keys = await savedKeys(store);
    if (!keys.includes(key)) await store.setItem(INDEX_KEY, JSON.stringify([...keys, key]));
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const held = memory.get(key);
      if (held !== undefined) return held;
      if (!persistent) return null;
      if (!secure) {
        try {
          return await plain.getItem(key);
        } catch {
          problem("Couldn’t read the saved session");
          return null;
        }
      }
      try {
        const saved = await readSecure(secure, key);
        if (saved !== null) return saved;
      } catch {
        problem("Couldn’t read the secure store");
      }
      // A session saved in plain storage by an earlier version: move it.
      let legacy: string | null = null;
      try {
        legacy = await plain.getItem(key);
      } catch {
        return null;
      }
      if (legacy === null) return null;
      memory.set(key, legacy);
      try {
        await writeSecure(secure, key, legacy);
        await plain.removeItem(key);
      } catch {
        // Kept where it was; moved on a later start. Signed in either way.
        problem("Couldn’t move the saved session to the secure store");
      }
      return legacy;
    },

    async setItem(key: string, value: string): Promise<void> {
      memory.set(key, value);
      if (!persistent) return;
      try {
        if (secure) {
          await writeSecure(secure, key, value);
          await plain.removeItem(key).catch(() => {});
        } else {
          await plain.setItem(key, value);
        }
      } catch {
        // Signed in for this run; the person signs in again after a restart.
        problem("Couldn’t save the session on this phone");
      }
    },

    /** Sign-out: removes the session from memory, the secure store and plain storage. */
    async removeItem(key: string): Promise<void> {
      memory.delete(key);
      if (secure) {
        try {
          await removeSecure(secure, key);
        } catch {
          problem("Couldn’t remove the saved session");
        }
      }
      await plain.removeItem(key).catch(() => problem("Couldn’t remove the saved session"));
    },

    /** Whether the session (and so the offline outbox and cache) is kept on the device. */
    isPersistent(): boolean {
      return persistent;
    },

    /** True once a store has failed this run (for diagnostics; never holds a value). */
    hadProblem(): boolean {
      return failed;
    },

    /** Called just before a new session is stored. Turning it off also removes any saved session. */
    async setPersistent(value: boolean): Promise<void> {
      persistent = value;
      if (value) return;
      if (secure) {
        const keys = await savedKeys(secure);
        for (const key of keys) await removeSecure(secure, key).catch(() => problem("Couldn’t remove the saved session"));
        await secure.removeItem(INDEX_KEY).catch(() => {});
      }
      try {
        const keys = await plain.getAllKeys();
        const saved = keys.filter((key) => key.startsWith("sb-"));
        if (saved.length) await plain.multiRemove(saved);
      } catch {
        problem("Couldn’t remove the saved session");
      }
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
