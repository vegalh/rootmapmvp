import { useEffect, useSyncExternalStore } from "react";
import { resolveAnalyticsConfig } from "../cloud/environment";
import { cloudState } from "../cloud/session";
import { getCloudClient } from "../cloud/client";
import { uuid } from "../data/schema";
import { localIsoDate } from "../dates";
import type { Feature } from "./catalog";
import { createUsageTracker, type SendResult, type UsageBatch } from "./usage";

// Usage analytics on this device (docs/data-architecture-phase2.md section 20): the tracker in usage.ts wired to the
// page and the network. Runs only when the build allows it (VITE_ROOTMAP_ANALYTICS=on, never the public website)
// AND the parent has turned on "Share anonymous usage statistics" (off by default). Device-wide, like the device id:
// its keys don't start with "rootmap-", so they stay out of backups.
//
// Signed in, batches go to record_usage() with the session (counted for the account, no guest id). Otherwise they go
// anonymously with a random guest id that is used for nothing else: not sign-in, not a child, not sync.

const env = import.meta.env ?? {};
export const analyticsConfig = resolveAnalyticsConfig(env);
const SEND_EVERY_MS = 60_000;

let keepalive = false;
async function send(batch: UsageBatch, guestId: () => string): Promise<SendResult> {
  if (!analyticsConfig.enabled) return "later";
  const verdict = (code: string | undefined) => (code === "22023" || code === "54000" ? "refused" : "later");
  try {
    if (cloudState().status === "signed-in") {
      const client = await getCloudClient();
      if (!client) return "later";
      const { error } = await client.rpc("record_usage", { batch });
      return error ? verdict(error.code) : "sent";
    }
    const key = analyticsConfig.publishableKey;
    const res = await fetch(`${analyticsConfig.supabaseUrl}/rest/v1/rpc/record_usage`, {
      method: "POST",
      keepalive,
      headers: { "Content-Type": "application/json", apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify({ batch: { ...batch, guest_id: guestId() } }),
    });
    if (res.ok) return "sent";
    const body = await res.json().catch(() => null);
    return verdict(body?.code);
  } catch {
    return "later";
  }
}

const tracker = createUsageTracker({
  enabled: analyticsConfig.enabled,
  storage: typeof localStorage !== "undefined" ? localStorage : undefined,
  now: () => Date.now(),
  dayOf: ms => localIsoDate(new Date(ms)),
  newId: uuid,
  send,
});

// ── The parent's choice (Profile › Privacy & Data) ───────────────────────────────────────────────────────────
const listeners = new Set<() => void>();
export const usageSharingAvailable = () => analyticsConfig.enabled;
export const usageSharing = tracker.sharing;
export function useUsageSharing(): boolean {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, tracker.sharing, tracker.sharing);
}
export function setUsageSharing(on: boolean) {
  tracker.setSharing(on, typeof document !== "undefined" && document.visibilityState === "visible");
  for (const l of [...listeners]) l();
}

// ── Counting (App.tsx and a few pages) ───────────────────────────────────────────────────────────────────────
// A new page address: impressions may count again.
export const newPageVisit = tracker.newVisit;
export const trackImpression = (feature: Feature) => tracker.impression(feature);
export const trackClick = (feature: Feature) => tracker.click(feature);
// For a part of a page that isn't always there (Today's Looking Back, a playable recording): an impression once it
// is shown. Safe to run on every render; the visit's gate counts it once.
export function useImpression(feature: Feature, shown = true) {
  useEffect(() => { if (shown) trackImpression(feature); });
}

async function flush(beforeLeaving: boolean) {
  keepalive = beforeLeaving;
  await tracker.flush();
}

// Sends what is waiting now instead of within the minute (the browser tests).
export const flushUsageNow = () => flush(false);

// Once, at start-up. Does nothing in builds without analytics.
let started = false;
export function startUsageTracking() {
  if (started || !analyticsConfig.enabled || typeof window === "undefined") return;
  started = true;
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) window.addEventListener(type, tracker.activity, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tracker.shown();
    else { tracker.hidden(); void flush(true); }
  });
  window.addEventListener("pagehide", () => { tracker.hidden(); void flush(true); });
  window.setInterval(() => void flush(false), SEND_EVERY_MS);
  if (document.visibilityState === "visible") tracker.shown();
}
