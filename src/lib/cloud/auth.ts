import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { KeyValueStore } from "../platform";

// Sign-in with a typed 6-digit email code, session restore and sign-out (Phase 2B-2 M1). Every function takes the
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
  | "unknown";

export type AuthResult<T = undefined> = { ok: true; value: T } | { ok: false; failure: AuthFailure };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email)) && email.length <= 254;
// Codes are often pasted with spaces ("123 456").
export const normalizeCode = (code: string) => code.replace(/\s+/g, "");
export const isValidCode = (code: string) => /^\d{6}$/.test(normalizeCode(code));

type ErrorLike = { name?: string; status?: number; code?: string; message?: string } | null | undefined;

export function authFailure(error: ErrorLike | unknown): AuthFailure {
  const e = (error ?? {}) as NonNullable<ErrorLike>;
  if (e.name === "AuthRetryableFetchError" || e.status === 0 || e instanceof TypeError) return "offline";
  if (e.status === 429 || e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit") return "rate-limited";
  if (e.code === "otp_expired") return "code-rejected";
  if (e.code === "signup_disabled" || e.code === "otp_disabled" || e.code === "email_provider_disabled") return "unavailable";
  if (e.code === "email_address_invalid" || e.code === "email_address_not_authorized") return "invalid-email";
  if (e.status === 403 || e.status === 401) return "code-rejected";
  return "unknown";
}

// Emails a 6-digit code. Creates the account on first use, so "Create an account" and "Log in" are the same step.
export async function requestEmailCode(client: SupabaseClient, email: string): Promise<AuthResult> {
  if (!isValidEmail(email)) return { ok: false, failure: "invalid-email" };
  try {
    const { error } = await client.auth.signInWithOtp({ email: normalizeEmail(email), options: { shouldCreateUser: true } });
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

// The signed-in parent as last known on this device.
export type StoredUser = { userId: string; email: string | null };

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

const userOf = (session: Session): StoredUser => ({ userId: session.user.id, email: session.user.email ?? null });

// The user recorded in the stored session, without contacting the server.
async function storedUser(storage: KeyValueStore): Promise<StoredUser | null> {
  try {
    const raw = await storage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const user = parsed?.user;
    return user && typeof user.id === "string" ? { userId: user.id, email: typeof user.email === "string" ? user.email : null } : null;
  } catch {
    return null;
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
