import { webPlatform } from "./web";

// The only code that differs between the website and the iOS app (Capacitor). Everything else calls these
// adapters instead of a browser or native API. See docs/data-architecture-phase2.md, section 2.
//
// Only the web adapters exist so far. The iOS ones (Keychain session, share sheet, native sign-in, SQLite) are
// added with the iOS app, after the Capacitor proof of concept; until then the iOS shell uses the web adapters.

export type PlatformKind = "web" | "ios";

// Async key-value storage, in the shape Supabase Auth accepts for keeping its session.
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type Platform = {
  kind: PlatformKind;
  // Where the sign-in session is kept: localStorage on the website, the iOS Keychain in the app.
  sessionStore: KeyValueStore;
  // Hands a file to the parent: a download on the website, the share sheet on iOS. On the website it throws at
  // once if the browser refuses; it cannot tell whether the file was actually saved.
  saveFile(fileName: string, blob: Blob): Promise<void>;
};

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

// "ios" only inside the native iOS app; the website (including Safari on an iPhone) is "web".
export function detectPlatform(win: { Capacitor?: CapacitorGlobal } | undefined = typeof window !== "undefined" ? (window as never) : undefined): PlatformKind {
  try {
    const cap = win?.Capacitor;
    return cap?.isNativePlatform?.() && cap.getPlatform?.() === "ios" ? "ios" : "web";
  } catch {
    return "web";
  }
}

export const platform: Platform = { ...webPlatform(), kind: detectPlatform() };
