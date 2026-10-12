import { resolveCloudConfig } from "./environment";

// This build's cloud settings (see environment.ts). Cloud code checks `cloudConfig.enabled` before doing
// anything; when it is false the app is exactly the local-only RootMap, with no network calls.
export const cloudConfig = resolveCloudConfig(import.meta.env);

// Cloud was asked for but the settings were refused: say why during development instead of failing quietly.
if (import.meta.env.DEV && !cloudConfig.enabled && cloudConfig.reason !== "not-enabled") {
  console.warn(`RootMap cloud features are off (${cloudConfig.reason}). Check .env.${import.meta.env.MODE}.local; see .env.example.`);
}
