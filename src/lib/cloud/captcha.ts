import { cloudConfig } from "./config";

// CAPTCHA for open registration (the beta): with the server's CAPTCHA protection on (Supabase Auth, Cloudflare
// Turnstile), every request for a sign-in code must carry a fresh token. Off unless VITE_TURNSTILE_SITE_KEY is set
// (a public site key, not a secret) in a build that uses the cloud. The Turnstile script is loaded only when a code
// is first requested. The widget stays invisible unless Cloudflare needs the visitor to tick a box.

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};
declare global {
  interface Window { turnstile?: Turnstile }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Long enough for a visitor who has to tick the box; the code request is abandoned after that.
const TIMEOUT_MS = 120_000;

export const captchaSiteKey = cloudConfig.enabled ? (import.meta.env?.VITE_TURNSTILE_SITE_KEY ?? "").trim() : "";

let api: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  api ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not load")));
    script.onerror = () => reject(new Error("Turnstile did not load"));
    document.head.append(script);
  }).catch(e => {
    api = undefined; // try again next time (e.g. after coming back online)
    throw e;
  });
  return api;
}

let widgetId: string | undefined;
let pending: { resolve: (token: string) => void; reject: (e: Error) => void } | undefined;
const settle = (token: string | null, error = "CAPTCHA failed") => {
  const p = pending;
  pending = undefined;
  if (token) p?.resolve(token);
  else p?.reject(new Error(error));
};

// A fresh, single-use token. Rejects if the check fails, the script can't load, or it takes too long.
export async function captchaToken(): Promise<string> {
  const turnstile = await loadTurnstile();
  settle(null, "superseded");
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => settle(null, "CAPTCHA timed out"), TIMEOUT_MS);
    pending = {
      resolve: token => { window.clearTimeout(timer); resolve(token); },
      reject: e => { window.clearTimeout(timer); reject(e); },
    };
    if (widgetId === undefined) {
      const box = document.createElement("div");
      box.className = "captcha-box";
      document.body.append(box);
      widgetId = turnstile.render(box, {
        sitekey: captchaSiteKey,
        execution: "execute",
        appearance: "interaction-only",
        callback: (token: string) => settle(token),
        "error-callback": () => { settle(null); return true; },
        "expired-callback": () => settle(null, "CAPTCHA expired"),
        "timeout-callback": () => settle(null, "CAPTCHA timed out"),
      });
    } else {
      turnstile.reset(widgetId);
    }
    turnstile.execute(widgetId);
  });
}
