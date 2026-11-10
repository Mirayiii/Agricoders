import assert from "node:assert/strict";
import { test } from "node:test";

import { isSupabaseConfig } from "../../lib/supabaseConfig.ts";

const KEY = "sb_publishable_0123456789abcdef";

test("a hosted project needs https", () => {
  assert.equal(isSupabaseConfig("https://abcd.supabase.co", KEY), true);
  assert.equal(isSupabaseConfig("http://abcd.supabase.co", KEY), false);
  assert.equal(isSupabaseConfig("http://example.com:54321", KEY), false);
});

test("a local Supabase on this PC or the home network works over http", () => {
  for (const url of ["http://127.0.0.1:54321", "http://localhost:54321", "http://192.168.100.3:54321", "http://10.0.0.5:54321", "http://172.20.1.2:54321"]) {
    assert.equal(isSupabaseConfig(url, KEY), true, url);
  }
  assert.equal(isSupabaseConfig("http://172.40.1.2:54321", KEY), false);
});

test("a missing address or key is not configured", () => {
  assert.equal(isSupabaseConfig("", KEY), false);
  assert.equal(isSupabaseConfig("not a url", KEY), false);
  assert.equal(isSupabaseConfig("https://abcd.supabase.co", ""), false);
});
