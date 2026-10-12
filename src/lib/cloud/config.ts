import { resolveCloudConfig } from "./environment";

// This build's cloud settings (see environment.ts). Cloud code checks `cloudConfig.enabled` before doing
// anything; when it is false the app is exactly the local-only RootMap, with no network calls.
// (`import.meta.env` exists only under Vite; elsewhere, e.g. the unit tests, cloud features are off.)
const env = import.meta.env ?? {};
export const cloudConfig = resolveCloudConfig(env);

// Cloud was asked for but the settings were refused: say why during development instead of failing quietly.
if (env.DEV && !cloudConfig.enabled && cloudConfig.reason !== "not-enabled") {
  console.warn(`RootMap cloud features are off (${cloudConfig.reason}). Check .env.${env.MODE}.local; see .env.example.`);
}
