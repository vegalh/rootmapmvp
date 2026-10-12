import { GUEST, isUserId, type Space } from "../data/schema";
import { platform } from "../platform";
import { storedUser } from "./auth";
import { cloudConfig } from "./config";
import type { CloudState } from "./session";

// Which local space this page load uses (Phase 2B-2 M3; spaces are described in lib/data/schema.ts).
//
// Decided at start-up from the session stored on this device, without contacting the server, so a signed-in
// parent's own space opens offline too. Without cloud features it is always the guest space, as before.
export async function startSpace(): Promise<Space> {
  if (!cloudConfig.enabled) return GUEST;
  const user = await storedUser(platform.sessionStore);
  return user && isUserId(user.userId) ? { kind: "account", userId: user.userId } : GUEST;
}

// Whether the open space still matches the sign-in state. After signing in or out (here or in another tab), or
// when the server has revoked the session, it doesn't, and the app reloads into the right space. "starting" and
// "off" never ask for a reload.
export function spaceMatches(space: Space, state: CloudState): boolean {
  if (state.status === "signed-in") return space.kind === "account" && space.userId === state.user.userId;
  if (state.status === "signed-out") return space.kind === "guest";
  return true;
}
