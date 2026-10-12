import { useSyncExternalStore } from "react";
import { cloudState, subscribeCloud, type CloudState } from "./session";
import { subscribeSync, syncStatus } from "../sync/runner";
import type { SyncStatus } from "../sync/status";

// The parent's sign-in state (session.ts) for screens. Always { status: "off" } when this build has no cloud.
export function useCloudState(): CloudState {
  return useSyncExternalStore(subscribeCloud, cloudState);
}

// Backup status of the signed-in account's space (lib/sync/status.ts).
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSync, syncStatus);
}
