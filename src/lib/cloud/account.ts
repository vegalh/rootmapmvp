import type { SupabaseClient } from "@supabase/supabase-js";

// The parent's family and profile on the server, created on first sign-in (Phase 2B-2 M1). Both steps are safe to
// repeat, from any number of devices at once: they find what exists and create only what is missing.
//
// Nothing from this device is uploaded here. The family gets no name and the profile only its owner; the parent's
// local profile, children and memories stay on the device until the first-login migration (M6) has checked them.

export type Account = { userId: string; email: string | null; familyId: string };

export class AccountError extends Error {
  readonly step: "session" | "family" | "profile";
  // The underlying Supabase error, if any.
  readonly reason: unknown;
  constructor(step: AccountError["step"], reason?: unknown) {
    const detail = reason && typeof reason === "object" && "message" in reason ? `: ${String(reason.message)}` : "";
    super(`account setup failed at ${step}${detail}`);
    this.step = step;
    this.reason = reason;
  }
}

// The family this user belongs to, created if there is none. create_family() refuses a second family, so when
// two devices race, one creates it and the other finds it.
export async function ensureFamily(client: SupabaseClient, userId: string): Promise<string> {
  const existing = await myFamily(client, userId);
  if (existing) return existing;
  const { data, error } = await client.rpc("create_family", { family_name: "" });
  if (!error && typeof data === "string") return data;
  // Another device created it in the meantime.
  const raced = await myFamily(client, userId);
  if (raced) return raced;
  throw new AccountError("family", error);
}

async function myFamily(client: SupabaseClient, userId: string): Promise<string | null> {
  // RLS returns only this user's own memberships. A user has at most one family (create_family() enforces it).
  const { data, error } = await client.from("family_members").select("family_id").eq("user_id", userId).order("created_at").limit(1);
  if (error) throw new AccountError("family", error);
  return data?.[0]?.family_id ?? null;
}

// Creates an empty profile if there is none; an existing profile is never changed.
export async function ensureProfile(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.from("profiles").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw new AccountError("profile", error);
}

// Family and profile for the signed-in parent. Run after every sign-in and at start-up, so an interrupted first
// sign-in is completed later.
export async function ensureAccount(client: SupabaseClient): Promise<Account> {
  const { data, error } = await client.auth.getSession();
  const user = data.session?.user;
  if (error || !user) throw new AccountError("session", error);
  const familyId = await ensureFamily(client, user.id);
  await ensureProfile(client, user.id);
  return { userId: user.id, email: user.email ?? null, familyId };
}
