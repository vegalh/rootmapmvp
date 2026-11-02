// An invitation link's token, kept out of the address bar (Shared Child Profiles release readiness, finding S2;
// docs/shared-child-profiles-release-readiness.md).
//
// A link arrives as #/invite/<token>. Anything running in the page can read the address (location.href,
// document.URL), including a third-party script such as the sign-in CAPTCHA, which loads only when a sign-in form is
// submitted. So the token is taken out of the address before the app renders (main.tsx) and whenever an address
// with one is opened while the app runs (App's popstate handler, and again right before the CAPTCHA script loads):
// the address becomes #/invite and the token is held here.
//
// Where it is held: in memory, and in sessionStorage so it survives the reload after signing in or a refresh.
// sessionStorage belongs to this tab only and ends with it; the token never goes to localStorage. It is forgotten as
// soon as the invitation is accepted, declined or can no longer be used, on signing out (except to switch to the
// account the invitation is for), and after MAX_AGE_MS in any case.
//
// What this does not do: a script running in this page could still read sessionStorage, as it could the sign-in
// session itself. The point is that the token is never in an address, so it can't leave in a URL, a Referer, a
// script's page-URL telemetry or a log line.

const KEY = "rootmap.pending-invite";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const INVITE_ADDRESS = /^#\/invite\/([^/?#]+)/;

let held: string | null = null;

const session = (): Storage | null => {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
};

// Moves a token from the current address into this module. Returns true if there was one.
export function captureInviteToken(): boolean {
  if (typeof window === "undefined") return false;
  const match = window.location.hash.match(INVITE_ADDRESS);
  if (!match) return false;
  let token = match[1];
  try { token = decodeURIComponent(token); } catch { /* kept as it is */ }
  held = token;
  try { session()?.setItem(KEY, JSON.stringify({ token, at: Date.now() })); } catch { /* memory only: lost on reload */ }
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#/invite`);
  return true;
}

// The invitation being opened in this tab, or null.
export function pendingInviteToken(): string | null {
  if (held) return held;
  try {
    const raw = session()?.getItem(KEY);
    if (!raw) return null;
    const { token, at } = JSON.parse(raw) as { token?: unknown; at?: unknown };
    if (typeof token !== "string" || !token || typeof at !== "number" || Date.now() - at > MAX_AGE_MS) {
      session()?.removeItem(KEY);
      return null;
    }
    held = token;
    return token;
  } catch {
    return null;
  }
}

export function forgetInviteToken() {
  held = null;
  try { session()?.removeItem(KEY); } catch { /* nothing kept */ }
}
