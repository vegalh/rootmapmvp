import { useMemo, useSyncExternalStore } from "react";
import { cloudState, subscribeCloud, type CloudState } from "./session";
import { guestImportState, subscribe } from "../data/store";
import { guestImportProgress, subscribeSync, syncStatus } from "../sync/runner";
import type { SyncStatus } from "../sync/status";

// The parent's sign-in state (session.ts) for screens. Always { status: "off" } when this build has no cloud.
export function useCloudState(): CloudState {
  return useSyncExternalStore(subscribeCloud, cloudState);
}

// Backup status of the signed-in account's space (lib/sync/status.ts).
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSync, syncStatus);
}

// Bringing the guest data into the account (lib/sync/guestImport.ts): where it stands, for the Account page.
export type GuestImportSummary = { status: "dismissed" | "copied" | "complete" | null; done: number; total: number; likelyDuplicates: number; missingPhotos: number };
const subscribeImport = (listener: () => void) => {
  const a = subscribe(listener);
  const b = subscribeSync(listener);
  return () => { a(); b(); };
};
const importKey = () => {
  const state = guestImportState();
  const progress = guestImportProgress();
  return JSON.stringify({ status: state?.status ?? null, done: progress.done, total: progress.total, likelyDuplicates: state?.likelyDuplicates ?? 0, missingPhotos: state?.missingPhotos ?? 0 });
};
export function useGuestImport(): GuestImportSummary {
  const key = useSyncExternalStore(subscribeImport, importKey);
  return useMemo(() => JSON.parse(key) as GuestImportSummary, [key]);
}
