/**
 * Whether the app has a usable Supabase address and publishable key.
 * Hosted projects must use https. Plain http is allowed only for a Supabase
 * running on this computer or the local network (`supabase start`), which
 * has no certificate and is reached as http://<PC address>:54321.
 */
export function isSupabaseConfig(url: string, publishableKey: string): boolean {
  if (publishableKey.length <= 20) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && isLocalHost(parsed.hostname);
}

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}
