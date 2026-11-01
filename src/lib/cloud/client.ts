import type { SupabaseClient } from "@supabase/supabase-js";
import { platform } from "../platform";
import { authOptions } from "./auth";
import { cloudConfig } from "./config";

// The app's one Supabase client, created on first use and only when this build may use the cloud.
//
// The library is imported lazily, and only in builds that can enable the cloud: the condition below is decided
// when Vite builds the app, so a build without cloud features does not contain Supabase at all.
const loadSupabase = import.meta.env.VITE_ROOTMAP_CLOUD === "on" ? () => import("@supabase/supabase-js") : null;

let client: Promise<SupabaseClient | null> | undefined;

// Private photo files are never kept in the browser's HTTP cache: the cache is keyed by address, not by account, so
// another account signed in later on the same browser could otherwise be served a file it may not read. (The app keeps
// its own copy of every photo in IndexedDB, per account.)
const privateFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.includes("/storage/v1/object/") ? fetch(input, { ...init, cache: "no-store" }) : fetch(input, init);
};

// Resolves to null when cloud features are off (the default).
export function getCloudClient(): Promise<SupabaseClient | null> {
  client ??= (async () => {
    if (!cloudConfig.enabled || !loadSupabase) return null;
    const { createClient } = await loadSupabase();
    return createClient(cloudConfig.supabaseUrl, cloudConfig.publishableKey, { auth: authOptions(platform.sessionStore), global: { fetch: privateFetch } });
  })();
  return client;
}
