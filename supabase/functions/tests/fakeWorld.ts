// An in-memory stand-in for Supabase Auth and the Phase 1 SQL functions, with
// the same rules (lockout after 5, credential lock, password_version checks).
// The SQL itself is tested against Postgres in supabase/tests/phase1.
import type { AdminDeps, AdminRequestState } from "../_shared/adminRequests.ts";
import type { AdminCreateDeps } from "../_shared/adminCreate.ts";
import type { AdminResetDeps } from "../_shared/adminReset.ts";
import type { ChangePasswordDeps } from "../_shared/changePassword.ts";
import { sha256Hex, temporaryPassword } from "../_shared/crypto.ts";
import type { SignInDeps } from "../_shared/signIn.ts";
import type { Account, Role } from "../_shared/types.ts";

type User = Account & { username: string; password: string; is_admin_gate: boolean };
type Session = { id: string; userId: string; token: string };

export class FakeWorld {
  users = new Map<string, User>();
  sessions: Session[] = [];
  guard = new Map<string, { count: number; lockedUntil: number | null }>();
  locks = new Map<string, { holder: string; expires: number }>();
  requests = new Map<string, AdminRequestState & { rpc: string; hash: string }>();
  audit: { action: string; target: string }[] = [];
  now = new Date("2026-11-03T08:00:00Z");
  passwordChecks = 0;
  private seq = 0;

  addUser(partial: Partial<User> & { username: string; password: string; role?: Role }): User {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
    const user: User = {
      user_id: id, email: `${partial.username}@example.test`, full_name: partial.username,
      role: "administrative_staff", status: "active", must_change_password: false,
      must_change_reason: null, temp_password_expires_at: null, password_version: 1,
      is_admin_gate: false, ...partial,
    };
    this.users.set(id, user);
    return user;
  }

  openSession(userId: string): Session {
    const s = { id: `s${++this.seq}`, userId, token: `tok${this.seq}` };
    this.sessions.push(s);
    return s;
  }

  sessionsOf(userId: string) {
    return this.sessions.filter((s) => s.userId === userId);
  }

  private account(u: User): Account {
    const { username: _u, password: _p, is_admin_gate: _g, ...a } = u;
    return { ...a };
  }

  private reserve(key: string) {
    const g = this.guard.get(key) ?? { count: 0, lockedUntil: null };
    if (g.lockedUntil !== null && g.lockedUntil <= this.now.getTime()) { g.count = 0; g.lockedUntil = null; }
    this.guard.set(key, g);
    if (g.lockedUntil !== null || g.count >= 5) {
      return { allowed: false, lockedUntil: new Date(g.lockedUntil ?? this.now.getTime() + 900_000).toISOString() };
    }
    g.count += 1;
    return { allowed: true, lockedUntil: null };
  }

  private record(key: string, success: boolean) {
    const g = this.guard.get(key)!;
    if (success) { g.count = 0; g.lockedUntil = null; } else if (g.count >= 5) g.lockedUntil = this.now.getTime() + 900_000;
  }

  private async check(email: string, password: string) {
    this.passwordChecks += 1;
    const user = [...this.users.values()].find((u) => u.email === email);
    if (!user || user.password !== password) return { ok: false as const, reason: "invalid" as const };
    const s = this.openSession(user.user_id);
    return { ok: true as const, session: { access_token: s.token, refresh_token: `r${s.token}`, expires_in: 900 } };
  }

  private revokeToken(token: string) {
    this.sessions = this.sessions.filter((s) => s.token !== token);
  }

  private acquire(userId: string, holder: string) {
    const l = this.locks.get(userId);
    if (l && l.expires > this.now.getTime() && l.holder !== holder) return false;
    this.locks.set(userId, { holder, expires: this.now.getTime() + 30_000 });
    return true;
  }

  private release(userId: string, holder: string) {
    if (this.locks.get(userId)?.holder === holder) this.locks.delete(userId);
  }

  signInDeps(): SignInDeps {
    return {
      lookupByUsername: async (n) => { const u = [...this.users.values()].find((x) => x.username === n); return u ? this.account(u) : null; },
      lookupById: async (id) => { const u = this.users.get(id); return u ? this.account(u) : null; },
      reserveAttempt: async (k) => this.reserve(k),
      recordResult: async (k, ok) => this.record(k, ok),
      checkPassword: (e, p) => this.check(e, p),
      revokeSession: async (t) => this.revokeToken(t),
      now: () => this.now,
    };
  }

  changeDeps(extra: Partial<ChangePasswordDeps> = {}): ChangePasswordDeps {
    return {
      caller: async (token) => { const s = this.sessions.find((x) => x.token === token); return s ? { userId: s.userId, sessionId: s.id } : null; },
      lookupById: async (id) => { const u = this.users.get(id); return u ? this.account(u) : null; },
      newHolder: () => `h${++this.seq}`,
      acquireLock: async (id, h) => this.acquire(id, h),
      releaseLock: async (id, h) => this.release(id, h),
      reserveAttempt: async (k) => this.reserve(k),
      recordResult: async (k, ok) => this.record(k, ok),
      checkPassword: (e, p) => this.check(e, p),
      revokeSession: async (t) => this.revokeToken(t),
      confirmWindow: async (id, h, v) => {
        const l = this.locks.get(id);
        if (!l || l.holder !== h || l.expires <= this.now.getTime()) return false;
        l.expires = this.now.getTime() + 30_000;
        const u = this.users.get(id)!;
        return u.password_version === v && u.status === "active";
      },
      setPassword: async (id, p) => { this.users.get(id)!.password = p; return true; },
      completeChange: async (id, v) => {
        const u = this.users.get(id)!;
        if (u.password_version !== v) return false;
        Object.assign(u, { must_change_password: false, must_change_reason: null, temp_password_expires_at: null, password_version: v + 1 });
        this.audit.push({ action: "password_changed", target: id });
        return true;
      },
      revokeOtherSessions: async (id, keep) => { this.sessions = this.sessions.filter((s) => s.userId !== id || s.id === keep); },
      now: () => this.now,
      ...extra,
    };
  }

  adminDeps(): AdminDeps {
    return {
      callerAdmin: async (token) => {
        const s = this.sessions.find((x) => x.token === token);
        if (!s) return "unauthorized";
        const u = this.users.get(s.userId)!;
        return u.role === "administrator" && u.status === "active" && !u.must_change_password ? { userId: u.user_id } : "forbidden";
      },
      beginRequest: async (actor, req, rpc, hash, target, details) => {
        const key = `${actor}:${req}`;
        const row = this.requests.get(key);
        if (!row) {
          this.requests.set(key, { state: "pending", target_user_id: target, details, result: null, rpc, hash });
          return { state: "new", target_user_id: target, details, result: null };
        }
        if (row.rpc !== rpc || row.hash !== hash) return "request_id_reused";
        return { state: row.state, target_user_id: row.target_user_id, details: row.details, result: row.result };
      },
      finishRequest: async (actor, req, result) => Object.assign(this.requests.get(`${actor}:${req}`)!, { state: "done", result }),
      temporaryPassword: (req) => temporaryPassword("test-secret", req),
      hash: sha256Hex,
    };
  }

  resetDeps(extra: Partial<AdminResetDeps> = {}): AdminResetDeps {
    return {
      ...this.adminDeps(),
      userExists: async (id) => this.users.has(id),
      newHolder: () => `h${++this.seq}`,
      acquireLock: async (id, h) => this.acquire(id, h),
      releaseLock: async (id, h) => this.release(id, h),
      beginReset: async (actor, id) => {
        const u = this.users.get(id)!;
        Object.assign(u, {
          must_change_password: true, must_change_reason: "temporary_password",
          temp_password_expires_at: new Date(this.now.getTime() + 72 * 3600_000).toISOString(),
          password_version: u.password_version + 1,
        });
        this.audit.push({ action: "password_reset", target: id });
      },
      setPassword: async (id, p) => { this.users.get(id)!.password = p; return true; },
      revokeAllSessions: async (id) => { this.sessions = this.sessions.filter((s) => s.userId !== id); },
      wait: async () => {},
      ...extra,
    };
  }

  createDeps(extra: Partial<AdminCreateDeps> = {}): AdminCreateDeps {
    return {
      ...this.adminDeps(),
      usernameAvailable: async (n) => ![...this.users.values()].some((u) => u.username === n),
      findAuthUser: async (email) => [...this.users.values()].find((u) => u.email === email)?.user_id ?? null,
      createAuthUser: async ({ email, password, username }) => {
        if ([...this.users.values()].some((u) => u.email === email)) return "exists";
        // Like handle_new_user: a new profile starts inactive.
        const u = this.addUser({ username: `user_${this.seq}`, password, status: "inactive" });
        u.email = email;
        void username;
        return { userId: u.user_id };
      },
      setPassword: async (id, p) => { this.users.get(id)!.password = p; return true; },
      setRequestTarget: async (actor, req, id) => { this.requests.get(`${actor}:${req}`)!.target_user_id = id; },
      finishCreate: async ({ userId, username, fullName, role }) => {
        if ([...this.users.values()].some((u) => u.username === username && u.user_id !== userId)) return "username_taken";
        Object.assign(this.users.get(userId)!, {
          username, full_name: fullName, role, status: "active", must_change_password: true,
          must_change_reason: "temporary_password",
          temp_password_expires_at: new Date(this.now.getTime() + 72 * 3600_000).toISOString(),
        });
        return "ok";
      },
      ...extra,
    };
  }
}
