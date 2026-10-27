// Which cloud backend a build may talk to, decided from its environment variables. Pure (no Vite, browser or
// Node APIs beyond `atob`), so the app, the Vite config (build guard) and the unit tests all use the same rules.
//
// Environments follow the Vite mode:
//   development (`npm run dev`)        → "local"       a local Supabase stack on this computer
//   staging (`--mode staging`)          → "staging"     the staging project, for a future preview build
//   production (`npm run build`), other → "production"  the public website
//
// Cloud features are off unless VITE_ROOTMAP_CLOUD is exactly "on", in every environment. Since 2026-10-27 (the
// owner's decision) the public website ("production") may turn them on; it uses the rootmap-staging project, the
// only one there is (docs/data-architecture-phase2.md section 19).

export type AppEnvironment = "local" | "staging" | "production";

export type CloudOffReason =
  | "not-enabled" // VITE_ROOTMAP_CLOUD is not "on" (the default)
  | "missing-url"
  | "invalid-url" // unparsable, or not allowed for this environment (see `urlAllowed`)
  | "missing-key"
  | "secret-key" // a secret / service-role key must never reach the browser
  | "invalid-key"; // not a recognisable publishable (anon) key

export type CloudConfig =
  | { enabled: false; environment: AppEnvironment; reason: CloudOffReason }
  | { enabled: true; environment: AppEnvironment; supabaseUrl: string; publishableKey: string };

export type CloudEnv = {
  MODE?: string;
  VITE_ROOTMAP_CLOUD?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

export function environmentForMode(mode: string | undefined): AppEnvironment {
  if (mode === "development") return "local";
  if (mode === "staging") return "staging";
  return "production";
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// "local" may only reach a stack on this computer (so a development build can never write to staging by
// mistake); every other environment needs HTTPS.
function urlAllowed(url: URL, environment: AppEnvironment) {
  if (environment === "local") return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK.has(url.hostname);
  return url.protocol === "https:";
}

// Payload of a legacy Supabase JWT key (anon or service_role), or null if the value is not a JWT.
function jwtPayload(value: string): Record<string, unknown> | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Supabase secret keys: the new `sb_secret_…` form, or a legacy JWT with the service_role role.
export function isSecretKey(value: string) {
  const v = value.trim();
  return v.startsWith("sb_secret_") || jwtPayload(v)?.role === "service_role";
}

// Keys that are safe in a browser: `sb_publishable_…`, or a legacy JWT with the anon role.
export function isPublishableKey(value: string) {
  const v = value.trim();
  return v.startsWith("sb_publishable_") || jwtPayload(v)?.role === "anon";
}

export function resolveCloudConfig(env: CloudEnv): CloudConfig {
  const environment = environmentForMode(env.MODE);
  const off = (reason: CloudOffReason): CloudConfig => ({ enabled: false, environment, reason });
  if (env.VITE_ROOTMAP_CLOUD !== "on") return off("not-enabled");

  const rawUrl = env.VITE_SUPABASE_URL?.trim();
  if (!rawUrl) return off("missing-url");
  let url: URL;
  try { url = new URL(rawUrl); } catch { return off("invalid-url"); }
  if (!urlAllowed(url, environment)) return off("invalid-url");

  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) return off("missing-key");
  if (isSecretKey(key)) return off("secret-key");
  if (!isPublishableKey(key)) return off("invalid-key");

  return { enabled: true, environment, supabaseUrl: url.origin, publishableKey: key };
}

// Usage analytics (src/lib/analytics): off unless VITE_ROOTMAP_ANALYTICS is exactly "on". It needs the project's
// URL and publishable key (the same rules as above) but not the cloud features, so a guest-only build can count
// anonymously. The same project rules as for the cloud.
export type AnalyticsEnv = CloudEnv & { VITE_ROOTMAP_ANALYTICS?: string };
export type AnalyticsConfig =
  | { enabled: false; reason: CloudOffReason }
  | { enabled: true; supabaseUrl: string; publishableKey: string };

export function resolveAnalyticsConfig(env: AnalyticsEnv): AnalyticsConfig {
  if (env.VITE_ROOTMAP_ANALYTICS !== "on") return { enabled: false, reason: "not-enabled" };
  const backend = resolveCloudConfig({ ...env, VITE_ROOTMAP_CLOUD: "on" });
  if (!backend.enabled) return { enabled: false, reason: backend.reason };
  return { enabled: true, supabaseUrl: backend.supabaseUrl, publishableKey: backend.publishableKey };
}

// Build-time guard, run by vite.config.ts for every dev server and build. Everything prefixed VITE_ is copied
// into the browser bundle, so no VITE_ variable may hold a secret key, in any mode. (`publicSite` is kept for the
// callers; the public website follows the same rules since 2026-10-27.)
export function assertSafeClientEnv(env: Record<string, string | undefined>, _site: { mode: string; publicSite: boolean }) {
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("VITE_") && value && isSecretKey(value)) {
      throw new Error(`${name} holds a Supabase secret key. Secret keys must never be put in client environment variables.`);
    }
  }
}
