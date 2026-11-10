import assert from "node:assert/strict";
import { test } from "node:test";

import * as app from "../../../src/features/auth/passwordRules.ts";
import { temporaryPassword } from "../_shared/crypto.ts";
import * as server from "../_shared/passwordRules.ts";

test("the app's checklist and the server use the same rules", () => {
  assert.deepEqual(app.PASSWORD_RULES.map((r) => [r.id, r.label]), server.PASSWORD_RULES.map((r) => [r.id, r.label]));
  assert.equal(app.SPECIAL_CHARACTERS, server.SPECIAL_CHARACTERS);
  assert.equal(app.MAX_PASSWORD_BYTES, server.MAX_PASSWORD_BYTES);
  for (const sample of ["", "short", "alllowercase1!", "ALLUPPER1!", "NoNumber!!", "NoSpecial12", "Good#Pass1", "é".repeat(40) + "Aa1!"]) {
    assert.deepEqual(app.failedPasswordRules(sample), server.failedPasswordRules(sample), sample);
  }
});

test("rule edge cases", () => {
  assert.deepEqual(server.failedPasswordRules("Abcdef1!"), []);
  assert.deepEqual(server.failedPasswordRules("Abcdef1?"), ["special"]);
  assert.ok(server.failedPasswordRules("A1!" + "a".repeat(70)).includes("too_long"));
});

test("temporary passwords meet the rules, repeat per request and differ between requests", async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i += 1) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const p = await temporaryPassword("secret", id);
    assert.equal(p.length, 12);
    assert.deepEqual(server.failedPasswordRules(p), [], p);
    assert.equal(await temporaryPassword("secret", id), p);
    seen.add(p);
  }
  assert.equal(seen.size, 300);
  assert.notEqual(await temporaryPassword("other", "x"), await temporaryPassword("secret", "x"));
});
