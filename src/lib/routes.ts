import type { Screen } from "../types";

// Page addresses. RootMap keeps the current page in the URL hash ("#/activity/water-pouring"), so browser Back and
// Forward work, a refresh stays on the same page, and an activity or a book has a link that can be shared. A hash
// works on GitHub Pages as it is: the server always serves index.html, with no rewrite rules.
//
// Pure: App turns its navigation state into a route (`formatRoute`) and back (`parseRoute`).

export type DiscoverTabRoute = "activities" | "books" | "collections";
export type ChildTabRoute = "Journal" | "Activities";

export type Route = {
  screen: Screen;
  // activity / music page
  activity?: string;
  book?: string;
  // collection page (src/data/collections.ts)
  collection?: string;
  // child page, and the child Add Activity or a new Moment is for
  child?: string;
  // Moment page, or the Moment being edited
  entry?: string;
  discoverTab?: DiscoverTabRoute;
  childTab?: ChildTabRoute;
  // Weekly recap: the Monday that starts the week ("2026-10-05"); `child` narrows it to one child.
  week?: string;
};

// Screens addressed by name alone.
const NAMED: Partial<Record<Screen, string>> = {
  today: "today",
  children: "kids",
  observations: "moments",
  profile: "profile",
  bookshelf: "bookshelf",
  week: "my-week",
  saved: "saved",
  notes: "notes",
  goals: "goals",
  language: "language",
  appearance: "appearance",
  notifications: "notifications",
  notificationPrefs: "notification-settings",
  personal: "personal",
  privacy: "privacy",
  help: "help",
  backup: "backup",
  deletedChildren: "recently-deleted",
  account: "account",
  guestImport: "bring-memories",
  signIn: "sign-in",
};
const BY_NAME = Object.fromEntries(Object.entries(NAMED).map(([screen, name]) => [name, screen as Screen]));

const enc = encodeURIComponent;
const dec = (s: string) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

export function formatRoute(r: Route): string {
  const q = (child?: string) => (child ? `?child=${enc(child)}` : "");
  switch (r.screen) {
    case "discover":
      return `#/discover${r.discoverTab && r.discoverTab !== "activities" ? `/${r.discoverTab}` : ""}`;
    case "activity":
    case "music":
      return r.activity ? `#/${r.screen}/${enc(r.activity)}` : "#/discover";
    case "book":
      return r.book ? `#/book/${enc(r.book)}` : "#/discover/books";
    case "collection":
      return r.collection ? `#/collection/${enc(r.collection)}` : "#/discover";
    case "child":
      return r.child ? `#/child/${enc(r.child)}${r.childTab === "Activities" ? "/activities" : ""}` : "#/kids";
    case "record":
      return `#/add-activity${q(r.child)}`;
    case "entry":
      return r.entry ? `#/moment/${enc(r.entry)}` : "#/moments";
    case "entryEdit":
      return r.entry ? `#/moment/${enc(r.entry)}/edit` : `#/new-moment${q(r.child)}`;
    case "recap":
      return `#/moments-week${r.week ? `/${enc(r.week)}` : ""}${q(r.child)}`;
    default:
      return `#/${NAMED[r.screen] ?? "today"}`;
  }
}

// The route a hash names, or null when it names none (an empty hash, or an address RootMap doesn't know).
export function parseRoute(hash: string): Route | null {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw) return null;
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map(dec);
  const child = new URLSearchParams(query).get("child") || undefined;
  const [head, id, extra] = parts;
  switch (head) {
    case "discover":
      // "#/discover/music" (the former Music tab) opens Activities, where music is listed now.
      return { screen: "discover", discoverTab: id === "books" || id === "collections" ? id : "activities" };
    case "activity":
    case "music":
      return id ? { screen: head, activity: id } : { screen: "discover", discoverTab: "activities" };
    case "book":
      return id ? { screen: "book", book: id } : { screen: "discover", discoverTab: "books" };
    case "collection":
      return id ? { screen: "collection", collection: id } : { screen: "discover", discoverTab: "collections" };
    case "child":
      return id ? { screen: "child", child: id, childTab: extra === "activities" ? "Activities" : "Journal" } : { screen: "children" };
    case "add-activity":
      return { screen: "record", child };
    case "moment":
      if (!id) return { screen: "observations" };
      return extra === "edit" ? { screen: "entryEdit", entry: id } : { screen: "entry", entry: id };
    case "new-moment":
      return { screen: "entryEdit", child };
    case "moments-week":
      return { screen: "recap", week: id && /^\d{4}-\d{2}-\d{2}$/.test(id) ? id : undefined, child };
    default:
      return BY_NAME[head] ? { screen: BY_NAME[head] } : null;
  }
}
