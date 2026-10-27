import type { Session } from "@supabase/supabase-js";
import { platform } from "../platform";
import { ensureAccount, type Account } from "./account";
import { isValidEmail, requestEmailCode, restoreSession, setPassword, signInWithPassword, signOut, userOf, verifyEmailCode, type AuthResult, type StoredUser } from "./auth";
import { captchaSiteKey, captchaToken } from "./captcha";
import { getCloudClient } from "./client";

// The parent's sign-in state for the whole app, and the actions the sign-in screens (M2) will call. No screen
// uses this yet. With cloud features off it stays "off" and nothing here touches the network.

export type CloudState =
  | { status: "off" } // this build does not use the cloud
  | { status: "starting" }
  | { status: "signed-out" }
  // `account` is null until the family and profile are confirmed on the server (after the first successful contact).
  | { status: "signed-in"; user: StoredUser; account: Account | null; offline: boolean };

let state: CloudState = { status: "off" };
const listeners = new Set<() => void>();

export const cloudState = () => state;
export function subscribeCloud(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function setState(next: CloudState) {
  state = next;
  for (const listener of [...listeners]) listener();
}

let started: Promise<void> | undefined;

// Restores a saved session at start-up and follows later changes (token refreshes, sign-out in another tab).
// Does nothing when cloud features are off.
export function startCloud(): Promise<void> {
  started ??= (async () => {
    const client = await getCloudClient();
    if (!client) return;
    setState({ status: "starting" });
    const restored = await restoreSession(client, platform.sessionStore);
    setState(restored.status === "signed-in" ? { status: "signed-in", user: restored.user, account: null, offline: restored.offline } : { status: "signed-out" });
    // supabase-js holds its session lock while calling this listener, so work is deferred out of it.
    client.auth.onAuthStateChange((event, session) => { setTimeout(() => onAuthChange(event, session), 0); });
    if (restored.status === "signed-in" && !restored.offline) await completeAccount();
    // Started offline: confirm the account (and so start sync) once the device is back online.
    window.addEventListener("online", () => {
      if (state.status === "signed-in" && !state.account) void completeAccount();
    });
  })();
  return started;
}

function onAuthChange(event: string, session: Session | null) {
  if (event === "SIGNED_OUT" || !session) {
    if (state.status !== "off") setState({ status: "signed-out" });
    return;
  }
  // Also USER_UPDATED, after the password is set: `hasPassword` follows.
  const user = userOf(session);
  const account = state.status === "signed-in" && state.user.userId === user.userId ? state.account : null;
  setState({ status: "signed-in", user, account, offline: false });
}

// Confirms the family and profile on the server. On failure the parent stays signed in with `account` null; it is
// retried at the next sign-in or start.
async function completeAccount(): Promise<Account | null> {
  const client = await getCloudClient();
  if (!client) return null;
  try {
    const account = await ensureAccount(client);
    if (state.status === "signed-in" && state.user.userId === account.userId) setState({ ...state, account, offline: false });
    return account;
  } catch {
    return null;
  }
}

const cloudOff = { ok: false, failure: "unavailable" } as const;

// Step 1 of signing in (or creating an account): email a 6-digit code.
export async function sendSignInCode(email: string): Promise<AuthResult> {
  const client = await getCloudClient();
  if (!client) return cloudOff;
  if (!captchaSiteKey || !isValidEmail(email)) return requestEmailCode(client, email);
  // Open registration: the server only sends a code with a fresh CAPTCHA token (one token per request).
  const token = await captchaToken().catch(() => null);
  return token ? requestEmailCode(client, email, token) : { ok: false, failure: "captcha" };
}

// Step 2: check the code, then make sure the family and profile exist.
export async function confirmSignInCode(email: string, code: string): Promise<AuthResult<{ account: Account | null }>> {
  const client = await getCloudClient();
  if (!client) return cloudOff;
  const result = await verifyEmailCode(client, email, code);
  if (!result.ok) return result;
  setState({ status: "signed-in", user: userOf(result.value), account: null, offline: false });
  return { ok: true, value: { account: await completeAccount() } };
}

// Signing in with email and password (an account that has set its password). The same CAPTCHA rule as codes.
export async function signInWithPasswordHere(email: string, password: string): Promise<AuthResult<{ account: Account | null }>> {
  const client = await getCloudClient();
  if (!client) return cloudOff;
  let token: string | undefined;
  if (captchaSiteKey && isValidEmail(email)) {
    token = (await captchaToken().catch(() => null)) ?? undefined;
    if (!token) return { ok: false, failure: "captcha" };
  }
  const result = await signInWithPassword(client, email, password, token);
  if (!result.ok) return result;
  setState({ status: "signed-in", user: userOf(result.value), account: null, offline: false });
  return { ok: true, value: { account: await completeAccount() } };
}

// Sets or changes the signed-in parent's password (required once after the account is created).
export async function setAccountPassword(password: string): Promise<AuthResult> {
  const client = await getCloudClient();
  if (!client) return cloudOff;
  const result = await setPassword(client, password);
  if (result.ok && state.status === "signed-in") setState({ ...state, user: { ...state.user, hasPassword: true } });
  return result;
}

// Signs out of this device only. Local data is not touched here (what happens to it is decided in M3 / M7).
export async function signOutHere(): Promise<{ serverRevoked: boolean }> {
  const client = await getCloudClient();
  if (!client) return { serverRevoked: false };
  const result = await signOut(client, platform.sessionStore);
  setState({ status: "signed-out" });
  return result;
}
