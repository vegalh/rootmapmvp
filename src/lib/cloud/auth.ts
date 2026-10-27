import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { KeyValueStore } from "../platform";

// Sign-in with a typed 6-digit email code or a password, session restore and sign-out (Phase 2B-2 M1; passwords
// 2026-10-27). An account is always created with a code, then a password is required (set right after, see
// `hasPassword`); later sign-ins use the password, and a forgotten password is replaced after signing in with a code. Every function takes the
// Supabase client, so the app (lib/cloud/client.ts) and the database tests use exactly the same code. Only types
// come from supabase-js here: the library itself is loaded lazily, and only in builds that can use the cloud.

// Where supabase-js keeps the session, inside the platform's session store (lib/platform).
export const SESSION_KEY = "auth";

// Auth options for every RootMap client. The session is kept in the platform's store and refreshed automatically.
// Sign-in never comes back through a URL (codes are typed), so URL detection is off, and so is PKCE: with PKCE,
// every code request leaves a verifier in the store that a typed code never uses. The Apple / Google redirect
// sign-in on the website (a later phase) will use PKCE for that flow.
export const authOptions = (storage: KeyValueStore) => ({
  storage,
  storageKey: SESSION_KEY,
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
  flowType: "implicit" as const,
});

// What went wrong, in terms a screen can explain. Server messages are never shown as they are.
export type AuthFailure =
  | "invalid-email" // not an email address
  | "invalid-code" // not 6 digits (checked before anything is sent)
  | "code-rejected" // wrong, already used, or expired
  | "rate-limited" // too many codes or attempts; try again shortly
  | "offline" // the server could not be reached
  | "unavailable" // sign-in is switched off on the server
  | "captcha" // the security check (CAPTCHA) didn't complete or the server refused its token
  | "password-rejected" // wrong email or password (never says which), or no password set yet
  | "weak-password" // shorter than PASSWORD_MIN or refused by the server's password rules
  | "reauth-needed" // the server wants a fresh sign-in before changing the password
  | "unknown";

export type AuthResult<T = undefined> = { ok: true; value: T } | { ok: false; failure: AuthFailure };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email)) && email.length <= 254;
// Codes are often pasted with spaces ("123 456").
export const normalizeCode = (code: string) => code.replace(/\s+/g, "");
export const isValidCode = (code: string) => /^\d{6}$/.test(normalizeCode(code));
// Passwords: at least 6 characters (the projects' Auth setting must match), at most 72 (what the server can check).
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72;
export const isValidPassword = (password: string) => password.length >= PASSWORD_MIN && new TextEncoder().encode(password).length <= PASSWORD_MAX;

type ErrorLike = { name?: string; status?: number; code?: string; message?: string } | null | undefined;

export function authFailure(error: ErrorLike | unknown): AuthFailure {
  const e = (error ?? {}) as NonNullable<ErrorLike>;
  if (e.name === "AuthRetryableFetchError" || e.status === 0 || e instanceof TypeError) return "offline";
  if (e.status === 429 || e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit") return "rate-limited";
  if (e.code === "otp_expired") return "code-rejected";
  if (e.code === "captcha_failed") return "captcha";
  if (e.code === "invalid_credentials") return "password-rejected";
  if (e.code === "weak_password") return "weak-password";
  if (e.code === "reauthentication_needed" || e.code === "reauthentication_not_valid") return "reauth-needed";
  if (e.code === "signup_disabled" || e.code === "otp_disabled" || e.code === "email_provider_disabled") return "unavailable";
  if (e.code === "email_address_invalid" || e.code === "email_address_not_authorized") return "invalid-email";
  if (e.status === 403 || e.status === 401) return "code-rejected";
  return "unknown";
}

// Emails a 6-digit code. Creates the account on first use, so signing up and signing in are the same step.
// `captchaToken` is required by the server when its CAPTCHA protection is on (see lib/cloud/captcha.ts).
export async function requestEmailCode(client: SupabaseClient, email: string, captchaToken?: string): Promise<AuthResult> {
  if (!isValidEmail(email)) return { ok: false, failure: "invalid-email" };
  try {
    const { error } = await client.auth.signInWithOtp({ email: normalizeEmail(email), options: { shouldCreateUser: true, ...(captchaToken ? { captchaToken } : {}) } });
    return error ? { ok: false, failure: authFailure(error) } : { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, failure: authFailure(e) };
  }
}

// Checks the code and, if right, signs in: the session is stored in the platform's session store.
export async function verifyEmailCode(client: SupabaseClient, email: string, code: string): Promise<AuthResult<Session>> {
  if (!isValidEmail(email)) return { ok: false, failure: "invalid-email" };
  if (!isValidCode(code)) return { ok: false, failure: "invalid-code" };
  try {
    const { data, error } = await client.auth.verifyOtp({ email: normalizeEmail(email), token: normalizeCode(code), type: "email" });
    if (error || !data.session) return { ok: false, failure: authFailure(error) };
    return { ok: true, value: data.session };
  } catch (e) {
    return { ok: false, failure: authFailure(e) };
  }
}

// Signs in with email and password. A wrong email, a wrong password and an account without a password all give the
// same "password-rejected", so nobody can find out which emails have accounts.
export async function signInWithPassword(client: SupabaseClient, email: string, password: string, captchaToken?: string): Promise<AuthResult<Session>> {
  if (!isValidEmail(email)) return { ok: false, failure: "invalid-email" };
  if (!password) return { ok: false, failure: "password-rejected" };
  try {
    const { data, error } = await client.auth.signInWithPassword({ email: normalizeEmail(email), password, ...(captchaToken ? { options: { captchaToken } } : {}) });
    if (error || !data.session) return { ok: false, failure: authFailure(error) };
    return { ok: true, value: data.session };
  } catch (e) {
    return { ok: false, failure: authFailure(e) };
  }
}

// Whether the account has set its password. Recorded in user metadata when the password is set; it only decides
// whether the app asks for one (the server checks the password itself), so it being user-editable is harmless.
export const PASSWORD_MARK = "rootmap_password";
type UserLike = { user_metadata?: Record<string, unknown> | null };
export const hasPassword = (user: UserLike | null | undefined) => user?.user_metadata?.[PASSWORD_MARK] === true;

// Sets (or changes) the signed-in parent's password, and records that it is set.
export async function setPassword(client: SupabaseClient, password: string): Promise<AuthResult> {
  if (!isValidPassword(password)) return { ok: false, failure: "weak-password" };
  try {
    const { error } = await client.auth.updateUser({ password, data: { [PASSWORD_MARK]: true } });
    if (!error) return { ok: true, value: undefined };
    // The same password as before: nothing to change, but it is set.
    if (error.code === "same_password") {
      const marked = await client.auth.updateUser({ data: { [PASSWORD_MARK]: true } });
      return marked.error ? { ok: false, failure: authFailure(marked.error) } : { ok: true, value: undefined };
    }
    return { ok: false, failure: authFailure(error) };
  } catch (e) {
    return { ok: false, failure: authFailure(e) };
  }
}

// The signed-in parent as last known on this device. `hasPassword` is false until the required password is set.
export type StoredUser = { userId: string; email: string | null; hasPassword: boolean };

export type RestoredSession =
  | { status: "signed-out" }
  // `offline`: the session could not be refreshed because the server was unreachable. The parent stays signed in
  // on this device (the app keeps working locally); the refresh is retried automatically.
  | { status: "signed-in"; user: StoredUser; offline: boolean };

// Reads the stored session at start-up, refreshing it if it has expired. A session the server has revoked (or that
// is unreadable) counts as signed out; an unreachable server does not.
export async function restoreSession(client: SupabaseClient, storage: KeyValueStore): Promise<RestoredSession> {
  try {
    const { data, error } = await client.auth.getSession();
    if (data.session) return { status: "signed-in", user: userOf(data.session), offline: false };
    if (error && authFailure(error) === "offline") {
      const stored = await storedUser(storage);
      if (stored) return { status: "signed-in", user: stored, offline: true };
    }
  } catch (e) {
    if (authFailure(e) === "offline") {
      const stored = await storedUser(storage);
      if (stored) return { status: "signed-in", user: stored, offline: true };
    }
  }
  return { status: "signed-out" };
}

export const userOf = (session: Session): StoredUser => ({ userId: session.user.id, email: session.user.email ?? null, hasPassword: hasPassword(session.user) });

// The user recorded in the stored session, without contacting the server.
export async function storedUser(storage: KeyValueStore): Promise<StoredUser | null> {
  try {
    const raw = await storage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const user = parsed?.user;
    return user && typeof user.id === "string" ? { userId: user.id, email: typeof user.email === "string" ? user.email : null, hasPassword: hasPassword(user) } : null;
  } catch {
    return null;
  }
}

// Whether the server still accepts this device's session. An access token keeps working until it expires (up to an
// hour) even after its session was revoked (signed out everywhere) or its account removed; Auth itself knows at
// once. "unknown" when the server can't be reached or has a problem of its own: that never signs anyone out.
export async function sessionValid(client: SupabaseClient): Promise<boolean | "unknown"> {
  try {
    const { error } = await client.auth.getUser();
    if (!error) return true;
    if (error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403 || error.status === 404) return false;
    return "unknown";
  } catch {
    return "unknown";
  }
}

// Signs out of this device: the server revokes this session's refresh token, and the stored session is removed.
// Other devices stay signed in. If the server can't be reached the stored session is still removed (supabase-js
// does this in every case; checked below), so nothing on this device can use it again; `serverRevoked` is false.
export async function signOut(client: SupabaseClient, storage: KeyValueStore): Promise<{ serverRevoked: boolean }> {
  let serverRevoked = false;
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    serverRevoked = !error;
  } catch {
    // reported through serverRevoked
  }
  // Belt and braces: never leave a session behind on this device.
  if (await storage.getItem(SESSION_KEY)) await storage.removeItem(SESSION_KEY);
  return { serverRevoked };
}
