import { platform } from "./platform";

// Native touches for the iOS app: haptic feedback and a status bar that follows the app's theme. On the website
// every call does nothing. The native side is RootMapNativePlugin in ios/App/App/AppDelegate.swift; @capacitor/core
// is only loaded inside the app, so the website bundle doesn't carry it.

export type Haptic = "light" | "medium" | "selection" | "success" | "warning" | "error";

type NativePlugin = {
  haptic(options: { kind: Haptic }): Promise<void>;
  setAppearance(options: { dark: boolean; background: string }): Promise<void>;
};

// Wrapped in an object: a Capacitor plugin proxy answers every property, `then` included, so it must never be the
// value a promise resolves to.
let plugin: Promise<{ native: NativePlugin } | null> | undefined;
function native() {
  if (platform.kind !== "ios") return null;
  plugin ??= import("@capacitor/core").then(m => ({ native: m.registerPlugin<NativePlugin>("RootMapNative") }), () => null);
  return plugin;
}

// A short tap from the Taptic Engine. Use it for meaningful moments (something saved, a choice made, a destructive
// question), not for every tap.
export function haptic(kind: Haptic = "light") {
  void native()?.then(p => p?.native.haptic({ kind })).catch(() => undefined);
}

// The status bar's text colour (light on the dark theme) and the colour behind the web view (seen while the keyboard
// opens or a page loads).
export function setNativeAppearance(dark: boolean, background: string) {
  void native()?.then(p => p?.native.setAppearance({ dark, background })).catch(() => undefined);
}

export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Follows the on-screen keyboard through the visual viewport. While a field has the keyboard open, <html> gets the
// `keyboard-open` class (the bottom bars step aside) and `--keyboard-inset` (how much of the window it covers), so
// bottom sheets can sit just above it. Also makes `:active` styles work on iOS taps.
export function startViewportTracking(win: Window = window) {
  const root = win.document.documentElement;
  // iOS only applies :active while some touch listener exists.
  win.document.addEventListener("touchstart", () => undefined, { passive: true });
  const vv = win.visualViewport;
  if (!vv) return;
  let frame = 0;
  const update = () => {
    frame = 0;
    const inset = Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop));
    const el = win.document.activeElement as HTMLElement | null;
    const editing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    // Browser toolbars also shrink the visual viewport a little; only a keyboard covers this much.
    const open = editing && inset > 120;
    root.classList.toggle("keyboard-open", open);
    root.style.setProperty("--keyboard-inset", `${open ? inset : 0}px`);
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  win.addEventListener("focusin", schedule);
  // The keyboard closes a moment after the field loses focus.
  win.addEventListener("focusout", () => win.setTimeout(schedule, 50));
}

// A field focused inside a bottom sheet scrolls into the part of the sheet the keyboard leaves visible.
export function revealFocusedField(container: HTMLElement) {
  const onFocus = (e: FocusEvent) => {
    const el = e.target as HTMLElement;
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    // After the keyboard has finished rising.
    window.setTimeout(() => { if (document.activeElement === el) el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" }); }, 320);
  };
  container.addEventListener("focusin", onFocus);
  return () => container.removeEventListener("focusin", onFocus);
}
