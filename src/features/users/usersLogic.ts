import type { Profile, ProfileRole } from "@/types/auth";

export function displayName(user: Pick<Profile, "full_name" | "username">): string {
  return user.full_name ?? user.username ?? "Unnamed user";
}

/** Search matches the full name or username, ignoring case and a leading @. */
export function matchesSearch(user: Pick<Profile, "full_name" | "username">, query: string): boolean {
  const term = query.trim().toLowerCase().replace(/^@/, "");
  if (!term) return true;
  return `${user.full_name ?? ""} ${user.username ?? ""}`.toLowerCase().includes(term);
}

/** The prototype filters users by search and role only (no status filter). */
export function filterUsers<T extends Pick<Profile, "full_name" | "username" | "role">>(users: T[], filters: { query: string; role: ProfileRole | "all" }): T[] {
  return users.filter((user) => matchesSearch(user, filters.query) && (filters.role === "all" || user.role === filters.role));
}

/** Role chip counts are totals per role, as in the prototype; search does not change them. */
export function roleCounts<T extends Pick<Profile, "role">>(users: T[]): { all: number } & Record<ProfileRole, number> {
  const counts = { all: users.length, administrator: 0, administrative_staff: 0, fulfillment_staff: 0, delivery_staff: 0 };
  for (const user of users) counts[user.role] += 1;
  return counts;
}

/** What "Copy credentials" puts on the clipboard (AS-01), in the prototype's format. */
export function credentialsText(temp: { username: string; password: string }): string {
  return `Username: ${temp.username} | Password: ${temp.password}`;
}

/** The badge on a user card: a lock outranks the account status. */
export function userBadge(user: Pick<Profile, "id" | "status">, locks: ReadonlyMap<string, string>): { label: string; tone: "warning" | "success" | "neutral" } {
  if (locks.has(user.id)) return { label: "Locked", tone: "warning" };
  return user.status === "active" ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" };
}
