// The early-access invite gate: a screen that asks for an invite code before the app opens (components/InviteGate.tsx,
// codes in config/inviteCodes.ts).
//
// What it is: a soft gate. It tells a visitor that RootMap is by invitation and keeps casual visitors on the front
// step. A correct code is remembered on the device (localStorage), so a returning family is not asked again.
//
// What it is not: protection. Everything here runs in the visitor's browser, so
//   - the codes ship inside the app's JavaScript and sit in a public repository: anyone can read them;
//   - setting the localStorage flag by hand, or switching off JavaScript checks, walks straight past it;
//   - the activities, books, songs and photographs are downloaded with the app whether or not a code is entered;
//   - a code can be passed on, and there is no record of who used which one, or how many times;
//   - it does not protect anyone's data: guest data never leaves the device, and accounts are protected by sign-in
//     and the server's own rules, not by this screen.
// Real invitation-only access needs the server to decide (for example, accounts that can only be created from an
// invited email address).
//
// Where it applies: production builds of the website. Not the iOS app, not the dev server (so the browser tests run
// as before), and not someone opening an invitation to a shared child profile (#/invite/<token>), who was invited by
// a family already inside. VITE_ROOTMAP_INVITE_GATE=off switches it off for a build, =on forces it on (to see it
// while developing).
import { INVITE_CODES } from "../config/inviteCodes";

export const INVITE_GATE_KEY = "rootmap.invite-gate";

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

// "grow 2026", "Grow-2026" and "GROW2026" are one code.
export const normalizeInviteCode = (code: string) => code.normalize("NFKC").toUpperCase().replace(/[\s\-_]+/g, "");

export function isInviteCode(code: string, codes: readonly string[] = INVITE_CODES): boolean {
  const entered = normalizeInviteCode(code);
  return entered.length > 0 && codes.some(c => normalizeInviteCode(c) === entered);
}

// Whether this device has already entered a valid code.
export function hasEnteredInviteCode(store: Store | null = local()): boolean {
  try { return store?.getItem(INVITE_GATE_KEY) === "entered"; } catch { return false; }
}

// Checks a code and, when it is valid, remembers on this device that the gate has been passed. If the browser
// won't store anything (private mode), the code still works for this visit.
export function enterInviteCode(code: string, store: Store | null = local(), codes: readonly string[] = INVITE_CODES): boolean {
  if (!isInviteCode(code, codes)) return false;
  try { store?.setItem(INVITE_GATE_KEY, "entered"); } catch { /* this visit only */ }
  return true;
}

export type GateContext = {
  // import.meta.env.PROD
  production: boolean;
  // VITE_ROOTMAP_INVITE_GATE
  setting?: string;
  ios: boolean;
  // Someone opening an invitation to a shared child profile.
  openingInvitation: boolean;
};

// Whether the gate stands in front of the app at all in this build and for this visit.
export function inviteGateApplies({ production, setting, ios, openingInvitation }: GateContext): boolean {
  if (ios || openingInvitation) return false;
  if (setting === "off") return false;
  if (setting === "on") return true;
  return production;
}
