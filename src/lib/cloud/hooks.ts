import { useSyncExternalStore } from "react";
import { cloudState, subscribeCloud, type CloudState } from "./session";

// The parent's sign-in state (session.ts) for screens. Always { status: "off" } when this build has no cloud.
export function useCloudState(): CloudState {
  return useSyncExternalStore(subscribeCloud, cloudState);
}
