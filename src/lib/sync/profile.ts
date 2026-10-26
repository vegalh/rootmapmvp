import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileInfo } from "../../types";
import { isPhotoId } from "../data/schema";

// The parent's own profile (name, photo, contact), across devices. Unlike children/entries/records/etc. this is
// a user-scoped singleton (table `profiles`, one row per `user_id`, no `change_seq`/revision history — see
// docs/data-architecture-phase2.md section 3), so it doesn't go through the record-sync engine's cursor/version
// machinery (engine.ts). Instead: pull the server row, and if it has changed since this device last saw it,
// adopt it; otherwise, if the local profile differs from what this device last knew the server to hold, push it.
// Conflicts (both sides changed while apart) are resolved by always pulling before pushing, so whichever device's
// change reached the server first "wins" and the later device adopts it instead of overwriting it — last write
// wins, without relying on device clocks, which can disagree.
//
// The profile photo is never uploaded here: `photo_ref` only carries a photo id. Picking a profile photo already
// stores it through the normal photo pipeline (lib/photos.ts → data/store.ts `savePhoto`), which queues it for
// sync like any other photo; the existing "photos" collection and photos.ts upload/download it the same way.

export type ProfileRow = { display_name: string; photo_ref: string | null; contact: string };

const EMPTY_PROFILE: ProfileInfo = { name: "", photo: "", contact: "" };
const EMPTY_ROW: ProfileRow = { display_name: "", photo_ref: null, contact: "" };

export const toProfileRow = (p: ProfileInfo): ProfileRow => ({ display_name: p.name, photo_ref: isPhotoId(p.photo) ? p.photo : null, contact: p.contact });
export const fromProfileRow = (row: ProfileRow): ProfileInfo => ({ name: row.display_name, photo: row.photo_ref ?? "", contact: row.contact });
const sameRow = (a: ProfileRow, b: ProfileRow): boolean => a.display_name === b.display_name && a.photo_ref === b.photo_ref && a.contact === b.contact;

export interface ProfileLocal {
  get(): ProfileInfo;
  set(next: ProfileInfo): void;
  // What this device last knew the server to hold (after a successful pull or push); null before the first sync.
  known(): ProfileRow | null;
  setKnown(row: ProfileRow): void;
}

export type ProfileAction =
  | { kind: "adopt"; row: ProfileRow } // the server has something this device hasn't seen: apply it locally
  | { kind: "push"; row: ProfileRow } // only this device changed: send it
  | { kind: "none" }; // nothing changed on either side

// Pure decision, so it can be tested without a server (tests/unit/profile.test.ts). `known` is null before the
// first sync this device has done (always "adopt" then, to pick up whatever the server already has).
export function nextProfileAction(remote: ProfileRow, known: ProfileRow | null, current: ProfileRow): ProfileAction {
  if (!known || !sameRow(remote, known)) return { kind: "adopt", row: remote };
  if (sameRow(current, known)) return { kind: "none" };
  return { kind: "push", row: current };
}

// One round: pull, adopt if the server changed, else push if this device changed. Throws on a network/auth
// error (the same as syncRound), so the caller's normal retry/back-off applies.
export async function syncProfile(client: SupabaseClient, userId: string, local: ProfileLocal): Promise<void> {
  const { data, error } = await client.from("profiles").select("display_name, photo_ref, contact").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const remote: ProfileRow = data ? { display_name: data.display_name ?? "", photo_ref: data.photo_ref ?? null, contact: data.contact ?? "" } : EMPTY_ROW;
  const action = nextProfileAction(remote, local.known(), toProfileRow(local.get()));
  if (action.kind === "adopt") {
    local.set(fromProfileRow(action.row));
    local.setKnown(action.row);
  } else if (action.kind === "push") {
    // A plain update, not an upsert: the row always exists by the time sync runs (ensureProfile, at sign-in,
    // before startSync). An upsert would need the server to run it as an INSERT ... ON CONFLICT DO UPDATE,
    // which (on this table's deliberately column-scoped grants — see migrations/20261012000600_grants.sql, kept
    // narrow so a client can never touch `user_id`/`created_at`) Postgres refuses unless the whole table is
    // grantable; a plain update only needs the per-column UPDATE grants already in place.
    const { error: upErr } = await client.from("profiles").update({ ...action.row, updated_at: new Date().toISOString() }).eq("user_id", userId);
    if (upErr) throw upErr;
    local.setKnown(action.row);
  }
}

export { EMPTY_PROFILE };
