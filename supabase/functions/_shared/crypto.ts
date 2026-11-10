import { SPECIAL_CHARACTERS } from "./passwordRules.ts";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS + SPECIAL_CHARACTERS;

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/**
 * A 12-character temporary password that meets D5, derived from the request id
 * and a server secret. The same request always gives the same password, so a
 * retried admin request sets (and shows) the same one without storing it.
 */
export async function temporaryPassword(secret: string, requestId: string): Promise<string> {
  const bytes = await hmac(secret, `meah-temporary-password:${requestId}`);
  const pick = (set: string, byte: number) => set[byte % set.length];
  const chars = [pick(UPPER, bytes[0]), pick(LOWER, bytes[1]), pick(DIGITS, bytes[2]), pick(SPECIAL_CHARACTERS, bytes[3])];
  for (let i = 4; i < 12; i += 1) chars.push(pick(ALL, bytes[i]));
  // Shuffle with the remaining bytes so the required characters are not always first.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = bytes[12 + (i % 20)] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads a claim from a JWT the caller sent. Only used after Supabase has verified the token. */
export function jwtClaim(token: string, claim: string): unknown {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded))[claim];
  } catch {
    return undefined;
  }
}
