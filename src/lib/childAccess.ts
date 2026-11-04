import { unscope } from "./data/schema";

// What the parent can do with each child, in the app's own words (Shared Child Profiles Phase 3;
// docs/shared-child-profiles-phase3.md). The server's roles stay owner / editor / viewer and keep deciding what is
// allowed; screens only follow them, so nothing here is a security boundary.
//
//   owner  → "manage" (Manage Profile / 管理档案)  the child's profile, its records, deleting and restoring it
//   editor → "edit"   (Add & Edit / 一起记录)       adding, editing and tidying the child's records
//   viewer → "view"   (View Only / 看看成长)        looking only
//
// The user's own children (the user's own family, and everything in the guest space) are "manage", unless the user
// handed a child's profile to someone else (ownership transfer, Phase 5; ScopeState.home). A child shared from another
// family takes the role the server last confirmed (ScopeState.shared, lib/sync/scopes.ts).

export type Access = "manage" | "edit" | "view";
export type TechnicalRole = "owner" | "editor" | "viewer";

export const accessOfRole = (role: TechnicalRole | null | undefined): Access => (role === "owner" ? "manage" : role === "editor" ? "edit" : "view");

// The family a child's (or a child-linked record's) local id belongs to; null for the user's own family.
export const familyOfId = (id: string | undefined | null): string | null => (id ? unscope(id)?.familyId ?? null : null);

// `scopes` is SpaceMeta.scopes as stored (unknown shape until read here).
export function childAccess(childId: string, scopes: unknown): Access {
  const known = scopes as { shared?: Record<string, TechnicalRole>; home?: Record<string, TechnicalRole> } | undefined;
  if (familyOfId(childId) === null) return accessOfRole(known?.home?.[childId] ?? "owner");
  return accessOfRole(known?.shared?.[childId]);
}

export const canAddAndEdit = (access: Access) => access !== "view";
export const canManage = (access: Access) => access === "manage";

// Children a record or plan may be given to.
export const editableChildren = <C extends { id: string }>(children: C[], scopes: unknown) => children.filter(c => canAddAndEdit(childAccess(c.id, scopes)));
// My Week stays with the user's own family.
export const ownFamilyChildren = <C extends { id: string }>(children: C[]) => children.filter(c => familyOfId(c.id) === null);
// A record can only be given to a child of its own family (rows never move between families).
export const sameFamilyChildren = <C extends { id: string }>(children: C[], childId: string) => children.filter(c => familyOfId(c.id) === familyOfId(childId));

// Relationship labels a circle can show, in the order offered. Stored as these keys (child_memberships.relationship).
export const RELATIONSHIPS = ["mom", "dad", "grandma", "grandpa", "teacher", "caregiver", "family", "other"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
