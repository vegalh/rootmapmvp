/// <reference types="vite/client" />

// Client environment variables (see .env.example and src/lib/cloud/environment.ts). All optional: without
// them the app runs local-only.
interface ImportMetaEnv {
  readonly VITE_ROOTMAP_CLOUD?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
