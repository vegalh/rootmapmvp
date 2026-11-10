// RootMapNativePlugin (ios/App/App/AppDelegate.swift), registered once for everything that calls it: lib/native.ts
// (haptics, status bar) and the share sheet below. Only ever loaded inside the iOS app.

export type Haptic = "light" | "medium" | "selection" | "success" | "warning" | "error";

type NativePlugin = {
  haptic(options: { kind: Haptic }): Promise<void>;
  setAppearance(options: { dark: boolean; background: string }): Promise<void>;
  shareImage(options: { data: string; fileName: string }): Promise<{ shared: boolean }>;
};

// Wrapped in an object: a Capacitor plugin proxy answers every property, `then` included, so it must never be the
// value a promise resolves to.
let plugin: Promise<{ native: NativePlugin } | null> | undefined;
export function nativePlugin() {
  plugin ??= import("@capacitor/core").then(m => ({ native: m.registerPlugin<NativePlugin>("RootMapNative") }), () => null);
  return plugin;
}

const base64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// iOS app: the picture in the system share sheet (save to Photos, Messages, WeChat…). A download, the website's
// fallback, does nothing inside the app's web view, so the app never relies on the browser's share support.
export async function nativeShareImage(fileName: string, blob: Blob): Promise<"shared" | "cancelled"> {
  const p = await nativePlugin();
  if (!p) throw new Error("native share unavailable");
  const { shared } = await p.native.shareImage({ data: await base64(blob), fileName });
  return shared ? "shared" : "cancelled";
}
