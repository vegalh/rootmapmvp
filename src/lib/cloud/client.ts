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

// Resolves to null when cloud features are off (the default).
export function getCloudClient(): Promise<SupabaseClient | null> {
  client ??= (async () => {
    if (!cloudConfig.enabled || !loadSupabase) return null;
    const { createClient } = await loadSupabase();
    return createClient(cloudConfig.supabaseUrl, cloudConfig.publishableKey, { auth: authOptions(platform.sessionStore) });
  })();
  return client;
}
