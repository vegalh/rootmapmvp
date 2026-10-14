import type { Child } from "../types";
import { childShortAge, type Copy } from "./i18n";
import { photoUrl } from "./photos";
import { DEFAULT_CHILD_PHOTO } from "./sync/mapping";

// Choosing which child a record, Moment or plan belongs to. A record is only ever saved for a child who is in the
// current (not deleted) list; with one child that child is chosen automatically, with several the parent chooses.

export const isActiveChild = (children: Child[], id: string | undefined) => !!id && children.some(c => c.id === id);

// The child to preselect: `preferred` while it is an active child, otherwise the only child, otherwise none ("").
export function defaultChildId(children: Child[], preferred?: string): string {
  if (isActiveChild(children, preferred)) return preferred!;
  return children.length === 1 ? children[0].id : "";
}

export const fullName = (c: Pick<Child, "first" | "last">) => `${c.first} ${c.last}`.trim();

// A name that tells this child apart from the others: the full name, plus the age when two children share it.
export function childOptionLabel(c: Child, children: Child[], t: Copy): string {
  const name = fullName(c);
  const twin = children.some(o => o.id !== c.id && fullName(o).toLowerCase() === name.toLowerCase());
  return twin ? `${name} (${childShortAge(c, t)})` : name;
}

// Short name for chips and lists: the first name, with the last initial when another child shares the first name.
export function childShortName(c: Child, children: Child[]): string {
  const twin = children.some(o => o.id !== c.id && o.first.trim().toLowerCase() === c.first.trim().toLowerCase());
  return twin && c.last.trim() ? `${c.first} ${c.last.trim()[0]}.` : c.first;
}

// Initials for the default avatar ("MH", "小").
export function childInitials(c: Pick<Child, "first" | "last">): string {
  // Chinese names: the first character of the given name, as families usually shorten it.
  if (/[\u3400-\u9fff]/.test(c.first)) return Array.from(c.first.trim())[0] || "?";
  const letters = [c.first, c.last].map(x => x.trim()).filter(Boolean).map(x => Array.from(x)[0]);
  return (letters.join("") || "?").toUpperCase();
}

// Soft, warm backgrounds for the initials avatar, chosen from the child's id so it stays the same everywhere.
const AVATAR_COLORS: [string, string][] = [["#e7efe4", "#3f6b54"], ["#f6e5cf", "#8a5a24"], ["#efe2ea", "#7a4766"], ["#e2eaf2", "#3c5f80"], ["#f3e9d2", "#6e5b22"]];

// The picture to show for a child: their own photo, or an illustrated avatar with their initials. The old default
// (a stock photo of a real child that new profiles used to get) is never shown; the stored value is left as it is.
export function childPhotoSrc(c: Pick<Child, "id" | "first" | "last" | "photo">): string {
  const own = c.photo && c.photo !== DEFAULT_CHILD_PHOTO ? photoUrl(c.photo) : "";
  return own || childInitialsSrc(c);
}

// The initials avatar alone: also shown when the child's own photo can't be loaded (ChildPhoto in components/ui.tsx).
export function childInitialsSrc(c: Pick<Child, "id" | "first" | "last">): string {
  let hash = 0;
  for (const ch of c.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const text = childInitials(c).replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="Georgia, 'Songti SC', serif" font-size="${text.length > 1 ? 38 : 44}" font-weight="600" fill="${fg}">${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
