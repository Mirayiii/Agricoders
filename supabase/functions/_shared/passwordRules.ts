// D5 password rules, shared by every function that sets a password.
// The app has an identical copy for the live checklist on "Set your password"
// (src/features/auth/passwordRules.ts); tests/passwordRules.test.ts keeps them equal.

export const SPECIAL_CHARACTERS = "!@#$%^&*";

export const PASSWORD_RULES = [
  { id: "length", label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { id: "case", label: "At least one lowercase and one uppercase letter", test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { id: "number", label: "At least one number", test: (p: string) => /[0-9]/.test(p) },
  { id: "special", label: "At least one special character (!@#$%^&*)", test: (p: string) => /[!@#$%^&*]/.test(p) },
] as const;

/** Supabase Auth (bcrypt) ignores anything past 72 bytes, so longer passwords are refused. */
export const MAX_PASSWORD_BYTES = 72;

export function failedPasswordRules(password: string): string[] {
  const failed: string[] = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.id);
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) failed.push("too_long");
  return failed;
}
