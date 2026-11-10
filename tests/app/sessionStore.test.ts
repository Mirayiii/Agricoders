import assert from "node:assert/strict";
import { test } from "node:test";

import { CHUNK_SIZE, INDEX_KEY, createSessionStore } from "../../lib/sessionStore.ts";

// Secure session storage (task 0.6, Phase 10): secure store on phones, memory
// only with "Keep me signed in" off, older plain-storage sessions moved, and
// failures never stopping sign-in or exposing a token.

const KEY = "sb-abcd-auth-token";
const TOKEN = JSON.stringify({ access_token: `eyJ${"a".repeat(3000)}`, refresh_token: "r-secret-123", user: { id: "u1" } });

function store(limit = 2048, opts: { failWrites?: boolean; failReads?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    opts,
    async getItem(key: string) { if (opts.failReads) throw new Error(`read failed ${key}`); return data.get(key) ?? null; },
    async setItem(key: string, value: string) {
      if (opts.failWrites) throw new Error(`write failed ${key}`);
      if (value.length > limit) throw new Error("Value too large");
      data.set(key, value);
    },
    async removeItem(key: string) { data.delete(key); },
  };
}

function plainStore() {
  const s = store(Infinity);
  return { ...s, async getAllKeys() { return [...s.data.keys()]; }, async multiRemove(keys: string[]) { keys.forEach((key) => s.data.delete(key)); } };
}

test("phones: a session larger than one secure item is saved in chunks and read back whole", async () => {
  const secure = store();
  const plain = plainStore();
  const sessions = createSessionStore({ secure, plain });
  await sessions.setItem(KEY, TOKEN);
  assert.ok(TOKEN.length > CHUNK_SIZE);
  assert.equal(secure.data.get("sb-abcd-auth-token.count"), String(Math.ceil(TOKEN.length / CHUNK_SIZE)));
  assert.equal(plain.data.size, 0, "nothing in plain storage");
  const fresh = createSessionStore({ secure, plain }); // app restarted
  assert.equal(await fresh.getItem(KEY), TOKEN);
});

test("a cut-off write reads as signed out, not a broken session", async () => {
  const secure = store();
  const sessions = createSessionStore({ secure, plain: plainStore() });
  await sessions.setItem(KEY, TOKEN);
  secure.data.delete("sb-abcd-auth-token.1");
  assert.equal(await createSessionStore({ secure, plain: plainStore() }).getItem(KEY), null);
});

test("Keep me signed in off: memory only, and any saved session is removed", async () => {
  const secure = store();
  const plain = plainStore();
  const sessions = createSessionStore({ secure, plain });
  await sessions.setItem(KEY, TOKEN); // an earlier sign-in with it on
  plain.data.set("sb-old-auth-token", "legacy");
  await sessions.setPersistent(false);
  await sessions.setItem(KEY, TOKEN);
  assert.equal(secure.data.size, 0, "nothing in the secure store, index included");
  assert.equal(plain.data.size, 0);
  assert.equal(await sessions.getItem(KEY), TOKEN, "still signed in for this run");
  assert.equal(sessions.isPersistent(), false);
  assert.equal(await createSessionStore({ secure, plain }).getItem(KEY), null, "signed out after a restart");
});

test("migration: a session saved in plain storage by an earlier version moves to the secure store", async () => {
  const secure = store();
  const plain = plainStore();
  plain.data.set(KEY, TOKEN);
  const sessions = createSessionStore({ secure, plain });
  assert.equal(await sessions.getItem(KEY), TOKEN);
  assert.equal(plain.data.has(KEY), false, "removed from plain storage");
  assert.equal(await createSessionStore({ secure, plain }).getItem(KEY), TOKEN);
  assert.deepEqual(JSON.parse(secure.data.get(INDEX_KEY) ?? "[]"), [KEY]);
});

test("migration that fails keeps the person signed in and the old copy in place, to move later", async () => {
  const secure = store(2048, { failWrites: true });
  const plain = plainStore();
  plain.data.set(KEY, TOKEN);
  const problems: string[] = [];
  const sessions = createSessionStore({ secure, plain, onProblem: (reason) => problems.push(reason) });
  assert.equal(await sessions.getItem(KEY), TOKEN);
  assert.equal(plain.data.get(KEY), TOKEN);
  assert.equal(sessions.hadProblem(), true);
  assert.ok(problems.every((reason) => !reason.includes("r-secret") && !reason.includes("eyJ")), "no token in what is reported");
});

test("sign-out removes the session everywhere", async () => {
  const secure = store();
  const plain = plainStore();
  const sessions = createSessionStore({ secure, plain });
  await sessions.setItem(KEY, TOKEN);
  plain.data.set(KEY, "legacy copy");
  await sessions.removeItem(KEY);
  assert.equal(await sessions.getItem(KEY), null);
  assert.deepEqual([...secure.data.keys()], [INDEX_KEY]);
  assert.equal(plain.data.size, 0);
});

test("a failing secure store never stops sign-in or exposes the token", async () => {
  const secure = store(2048, { failWrites: true, failReads: true });
  const problems: string[] = [];
  const sessions = createSessionStore({ secure, plain: plainStore(), onProblem: (reason) => problems.push(reason) });
  await sessions.setItem(KEY, TOKEN);
  assert.equal(await sessions.getItem(KEY), TOKEN, "kept in memory for this run");
  await sessions.removeItem(KEY);
  assert.ok(problems.length > 0);
  assert.ok(problems.every((reason) => !reason.includes(TOKEN.slice(0, 20)) && !reason.includes("r-secret")));
});

test("web: no secure store, so the browser's storage is used as before", async () => {
  const plain = plainStore();
  const sessions = createSessionStore({ secure: null, plain });
  await sessions.setItem(KEY, TOKEN);
  assert.equal(plain.data.get(KEY), TOKEN);
  assert.equal(await createSessionStore({ secure: null, plain }).getItem(KEY), TOKEN);
  await sessions.setPersistent(false);
  assert.equal(plain.data.size, 0);
});
