import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmProvider, CopyContext, Shell, PageHeader } from "./components/ui";
import { ModalOverlay } from "./components/ModalOverlay";
import { Icon } from "./components/Icon";
import { TodayPage } from "./pages/TodayPage";
import { ChildrenPage } from "./pages/ChildrenPage";
import { DiscoverPage, type DiscoverTab } from "./pages/DiscoverPage";
import { ActivityDetailPage } from "./pages/ActivityDetailPage";
import { MomentsPage } from "./pages/MomentsPage";
import { ChildProfilePage } from "./pages/ChildProfilePage";
import { ProfilePage } from "./pages/ProfilePage";
import { MyWeekPage, ActivityRow } from "./pages/MyWeekPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { RecordFormPage } from "./pages/RecordFormPage";
import { EntryEditorPage } from "./pages/EntryEditorPage";
import { EntryDetailPage } from "./pages/EntryDetailPage";
import { GoalsPage } from "./pages/GoalsPage";
import { WeeklyRecapPage } from "./pages/WeeklyRecapPage";
import { BackupPage } from "./pages/BackupPage";
import { DeletedChildrenPage } from "./pages/DeletedChildrenPage";
import { AccountPage } from "./pages/AccountPage";
import { GuestImportPage } from "./pages/GuestImportPage";
import BookDetailPage from "./pages/BookDetailPage";
import MusicDetailPage from "./pages/MusicDetailPage";
import BookshelfPage from "./pages/BookshelfPage";
import OpeningExperience from "./components/OpeningExperience";
import BetaNotice from "./components/BetaNotice";
import { onStorageError, type StorageFailure } from "./lib/storage";
import { LAST_BACKUP_KEY, RESTORED_AT_KEY, applyBackup } from "./lib/backup";
import { saveSetting, useCollection, useSetting } from "./lib/data/hooks";
import { NO_DEMO_KEY, activeSpace, backupData, dataMode, guestImportState, readSetting, restoreData, syncMeta } from "./lib/data/store";
import { newRecordId } from "./lib/data/schema";
import { MIGRATED_KEY, hasPendingNotes, importObservations, notesEntry } from "./lib/entries";
import { copy, localizeActivity } from "./lib/i18n";
import { cloudConfig, isBeta } from "./lib/cloud/config";
import { useCloudState } from "./lib/cloud/hooks";
import { cloudState, confirmSignInCode, sendSignInCode, signOutHere } from "./lib/cloud/session";
import { spaceMatches } from "./lib/cloud/space";
import { prepareImport, startSync } from "./lib/sync/runner";
import { WELCOME_KEY, welcomeAtStart, type WelcomeState } from "./lib/welcome";
import { formatRoute, parseRoute, type Route } from "./lib/routes";
import { initialChildren } from "./data/children";
import { initialRecords, initialObservations } from "./data/progress";
import { activities } from "./data/activities";
import { books } from "./data/books";
import { musicActivities } from "./data/music";
import { findActivity, findMusic, isMusicId } from "./lib/catalog";
import { buildActivityRecord, planCompletionRecords, problemMessage, type RecordInput } from "./lib/activityRecords";
import { defaultChildId, isActiveChild } from "./lib/children";
import { localIsoToday } from "./lib/dates";
import { shelfOf, useBookshelf } from "./lib/bookshelf";
import { SEED_VERSION } from "./data/seedVersion";
import type { DeletedChild, Entry, Lang, LessonRecord, ModalKind, Plan, ProfileInfo, Screen } from "./types";
import alexPhoto from "./assets/profile/alex.svg";

type ChildFilters = { age: string; group: string; recent: string; sort: string };

// Merges bundled demo data into what's stored without ever overwriting it: a seed item already on the device
// only gains fields it lacks (the stored values always win), and a seed item is only added if this device has
// never had it, so a demo child the parent deleted doesn't come back. Nothing is ever removed.
function mergeSeed<T extends { id: string }>(current: T[], seed: T[], prefix: string, seen: Set<string>): T[] {
  const merged = current.map(x => {
    const s = seed.find(y => y.id === x.id);
    return s ? { ...s, ...x } : x;
  });
  const added = seed.filter(s => !seen.has(`${prefix}:${s.id}`) && !current.some(x => x.id === s.id));
  return [...merged, ...added];
}

const seedIds = [
  ...initialChildren.map(x => `child:${x.id}`),
  ...initialRecords.map(x => `record:${x.id}`),
  ...initialObservations.map(x => `obs:${x.id}`),
];

// Development-only preview of the opening experience (`?opening`, `?opening=final`). Not part of navigation yet;
// in production builds this is null and the component isn't bundled.
const OpeningPreview = import.meta.env.DEV ? lazy(() => import("./dev/OpeningPreview")) : null;
const previewOpening = import.meta.env.DEV && new URLSearchParams(window.location.search).has("opening");

// Set just before the reload that follows a restore, so the reloaded app can confirm it.
const JUST_RESTORED_KEY = "rootmap-just-restored";

// Signing in or out reloads the app into the other space (lib/cloud/space.ts). What to show after that reload:
// a confirmation and the screen to open.
const AFTER_SWITCH_KEY = "rootmap.after-space-switch";
// Reloads in a row, to stop a loop if the space can't follow the sign-in state (e.g. a session that can't be stored).
const SWITCH_COUNT_KEY = "rootmap.space-switches";
type AfterSwitch = { toast: string; screen?: Screen };

function readAfterSwitch(): AfterSwitch | null {
  try {
    const raw = sessionStorage.getItem(AFTER_SWITCH_KEY);
    sessionStorage.removeItem(AFTER_SWITCH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function reloadIntoSpace() {
  try {
    const [count, at] = JSON.parse(sessionStorage.getItem(SWITCH_COUNT_KEY) || "[0,0]") as [number, number];
    const recent = Date.now() - at < 30_000 ? count : 0;
    if (recent >= 3) { console.warn("RootMap: the local space does not follow the sign-in state; not reloading again."); return; }
    sessionStorage.setItem(SWITCH_COUNT_KEY, JSON.stringify([recent + 1, Date.now()]));
  } catch {
    // sessionStorage unavailable: reload anyway (each reload is caused by a real sign-in change)
  }
  window.location.reload();
}

// Pages that exist only in builds with cloud features; elsewhere their address opens Today.
const CLOUD_SCREENS: Screen[] = ["signIn", "account", "guestImport"];
function allowedRoute(r: Route | null): Route | null {
  return r && (cloudConfig.enabled || !CLOUD_SCREENS.includes(r.screen)) ? r : null;
}

export default function App() {
  const [afterSwitch] = useState(readAfterSwitch);
  // The page to open: after a sign-in switch the screen it asked for, otherwise the address in the URL (a refresh,
  // a shared link), otherwise Today.
  const [start] = useState<Route>(() => (afterSwitch?.screen ? { screen: afterSwitch.screen } : allowedRoute(parseRoute(window.location.hash))) ?? { screen: "today" });
  const [screen, setScreen] = useState<Screen>(start.screen);
  const [previous, setPrevious] = useState<Screen>("today");
  const [modal, setModal] = useState<ModalKind>(null);
  // The child whose page is open (or was last open); "" when none. Never assumed to exist: see lib/children.ts.
  const [selectedChild, setSelectedChild] = useState(start.child ?? "");
  // A Discover activity or a music activity: both share one id space (lib/catalog.ts).
  const [selectedActivity, setSelectedActivity] = useState(start.activity ?? "water-pouring");
  const [selectedBook, setSelectedBook] = useState(start.book ?? books[0]?.id ?? "");
  const [discoverTab, setDiscoverTab] = useState<DiscoverTab>(start.discoverTab ?? "activities");
  const [childTab, setChildTab] = useState<string>(start.childTab ?? "Journal");
  // Where Add Activity was opened: a child's Activities tab (child already known) or Quick Add (child chosen in the form).
  const [recordFrom, setRecordFrom] = useState<"child" | "quick">(start.screen === "record" && start.child ? "child" : "quick");
  // Entry being viewed/edited; undefined in the editor means "new entry".
  const [selectedEntry, setSelectedEntry] = useState<string | undefined>(start.entry);
  // Weekly recap: the week shown ("" lets the page choose) and the child it is narrowed to ("" = every child).
  const [recapWeek, setRecapWeek] = useState(start.week ?? "");
  const [recapChild, setRecapChild] = useState(start.screen === "recap" ? start.child ?? "" : "");
  // An activity record to open on its child's Activities tab (Today's Looking Back); cleared once it is shown.
  const [focusRecord, setFocusRecord] = useState<string>();
  // Where the current entry flow started, so detail/editor return there ("child" = that child's Journal,
  // "activity" = the activity page a memory was added from after marking it as tried, "today" = Looking Back,
  // "children" = Recent moments on Kids).
  const [entryOrigin, setEntryOrigin] = useState<"moments" | "child" | "activity" | "today" | "children" | "recap">("moments");
  // Child preselected for a new entry.
  const [editorChild, setEditorChild] = useState<string | undefined>(start.screen === "entryEdit" ? start.child : undefined);
  // Editable starting title/date for a new entry (the activity just marked as tried).
  const [editorPrefill, setEditorPrefill] = useState<{ title: string; date: string } | undefined>();
  const [editorReturn, setEditorReturn] = useState<Screen>("observations");
  const [momentsFilter, setMomentsFilter] = useState("All");
  const [toast, setToast] = useState(afterSwitch?.toast ?? "");

  // All persistent data comes from the data layer (src/lib/data): records are stored one by one with sync
  // timestamps, and removing one from a list soft-deletes it. A removed child is a soft-deleted child record,
  // which is what Recently Deleted lists.
  const children = useCollection("children");
  const { items: childrenData, set: setChildrenData, commit: commitChildren } = children;
  const deletedChildren = children.deleted as DeletedChild[];
  const { items: records, set: setRecords, commit: commitRecords } = useCollection("records");
  const { items: observations, set: setObservations } = useCollection("observations");
  const [seedVersion, setSeedVersion] = useSetting<number>("rootmap-seed-version", 0);
  // Every seed item this device has received ("child:emma", "record:r1", "obs:o1"); see mergeSeed.
  const [seenSeeds, setSeenSeeds] = useSetting<string[]>("rootmap-seed-ids", []);
  // Set on devices that started without demo data (a new family); they never receive any.
  const [noDemo, setNoDemo] = useSetting<boolean>(NO_DEMO_KEY, false);
  // Devices from the demo era keep the sample parent profile they always showed until it's edited; a new family's
  // profile starts empty.
  const [demoEra] = useState(() => !readSetting(NO_DEMO_KEY, false) && readSetting<number>("rootmap-seed-version", 0) > 0);
  const [profile, setProfile] = useSetting<ProfileInfo>("rootmap-profile", demoEra ? { name: "Alex Hao", photo: alexPhoto, contact: "" } : { name: "", photo: "", contact: "" });
  const savedActivities = useCollection("saved");
  const saved = useMemo(() => savedActivities.items.map(s => s.id), [savedActivities.items]);
  const setSavedRecords = savedActivities.set;
  // Saved activities are records keyed by activity id; screens keep working with the list of ids.
  const setSaved = useCallback((next: string[] | ((current: string[]) => string[])) => setSavedRecords(current => {
    const ids = typeof next === "function" ? next(current.map(s => s.id)) : next;
    return ids.map(id => current.find(s => s.id === id) || { id });
  }), [setSavedRecords]);
  const { items: plans, set: setPlans, commit: commitPlans } = useCollection("plans");
  // Moments/Journal entries (per child) and goals (per parent) are never part of the seed merge.
  const { items: entries, commit: commitEntries } = useCollection("entries");
  const [migrated, setMigrated] = useSetting<string[]>(MIGRATED_KEY, []);
  const { items: goals, set: setGoals } = useCollection("goals");
  const [lastBackup, setLastBackup] = useSetting<string>(LAST_BACKUP_KEY, "");
  const [lang, setLang] = useSetting<Lang>("rootmap-language", "en");
  const [appearance, setAppearance] = useSetting<string>("rootmap-appearance", "light");
  const [filters, setFilters] = useSetting<ChildFilters>("rootmap-child-filters", { age: "All Ages", group: "All Groups", recent: "Any Time", sort: "Name A–Z" });
  const [weekFilter, setWeekFilter] = useState("all");
  // The book Wishlist belongs to the family, not to a child (lib/bookshelf.ts).
  const bookshelf = useBookshelf();

  // Sign-in state (always "off" on the public website). New devices see the Welcome screen until the parent signs in
  // or continues without an account; devices that already have RootMap data open straight into the app. Decided
  // before the app records its first run (see lib/welcome.ts).
  const cloud = useCloudState();
  const [welcome, setWelcome] = useSetting<WelcomeState>(WELCOME_KEY, "");
  const [welcomeStart] = useState(() => (cloudConfig.enabled && activeSpace().kind === "guest" ? welcomeAtStart() : "skip"));
  useEffect(() => {
    if (welcomeStart === "show" && welcome === "") setWelcome("pending");
  }, [welcomeStart, welcome, setWelcome]);
  const showWelcome = welcomeStart === "show" && welcome !== "done" && cloud.status !== "signed-in";
  // Each space is opened by a fresh page load; see reloadIntoSpace. Held while a sign-in is completing.
  const holdSwitch = useRef(false);
  useEffect(() => {
    if (holdSwitch.current) return;
    if (!spaceMatches(activeSpace(), cloud)) reloadIntoSpace();
    else if (cloud.status === "signed-in" || cloud.status === "signed-out") {
      try { sessionStorage.removeItem(SWITCH_COUNT_KEY); } catch { /* nothing to reset */ }
    }
  }, [cloud]);
  // Record sync for the signed-in account's own space (lib/sync). Uses the family recorded in the space while the
  // account can't be confirmed (offline start), so changes made offline are sent as soon as the device is online.
  const syncUser = cloud.status === "signed-in" && spaceMatches(activeSpace(), cloud) ? cloud.user.userId : null;
  const syncFamily = cloud.status === "signed-in" ? cloud.account?.familyId ?? syncMeta().familyId : null;
  useEffect(() => {
    if (!syncUser || !syncFamily) return;
    return startSync({ userId: syncUser, familyId: syncFamily });
  }, [syncUser, syncFamily]);
  // Memories saved on this device before signing in (lib/sync/guestImport.ts): checked once per page load. If there
  // are some and the parent hasn't decided yet, the question opens once; the Account page offers it again.
  const [importAvailable, setImportAvailable] = useState(false);
  const importChecked = useRef(false);
  useEffect(() => {
    if (!syncUser || !syncFamily || importChecked.current) return;
    importChecked.current = true;
    const decided = guestImportState()?.status;
    if (decided === "copied" || decided === "complete") return;
    void prepareImport().then(p => {
      const available = !!p && !p.offer.nothingToImport;
      setImportAvailable(available);
      if (available && guestImportState() === null) go("guestImport");
    }, () => undefined); // offline: offered again at the next start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncUser, syncFamily]);

  const afterSwitchTo = (next: AfterSwitch) => {
    try { sessionStorage.setItem(AFTER_SWITCH_KEY, JSON.stringify(next)); } catch { /* the reload still happens */ }
  };

  // When the bundled seed data changes (SEED_VERSION bumped), merge in new demo items without touching anything
  // already on the device (see mergeSeed). The parent's profile and all their own data are never reset.
  // A new family (nothing stored, never seeded) gets no demo data, now or with any later seed version; only devices
  // that already had the demo family keep receiving its updates.
  const freshSpace = seedVersion === 0 && !seenSeeds.length && !childrenData.length && !deletedChildren.length && !records.length && !observations.length;
  useEffect(() => {
    if (noDemo || freshSpace) {
      if (!noDemo) setNoDemo(true);
      return;
    }
    // A device without a seen-list has already received every current seed item (it's on this version, or it
    // predates the list); treating them all as seen means a demo child the parent deleted is never re-added.
    const seen = new Set(seenSeeds.length ? seenSeeds : seedIds);
    if (seedVersion < SEED_VERSION) {
      setChildrenData(current => mergeSeed(current, initialChildren, "child", seen));
      setRecords(current => mergeSeed(current, initialRecords, "record", seen));
      setObservations(current => mergeSeed(current, initialObservations, "obs", seen));
      // Hide saved-activity ids that no longer exist, which previously caused a white-screen crash.
      setSaved(current => current.filter(id => !!findActivity(id)));
      setSeedVersion(SEED_VERSION);
    }
    const all = [...new Set([...seen, ...seedIds])];
    if (all.length !== seenSeeds.length) setSeenSeeds(all);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noDemo, seedVersion, seenSeeds, setChildrenData, setRecords, setObservations, setSaved, setSeedVersion, setSeenSeeds]);

  const t = copy[lang];
  // The open child's page; undefined once that child is removed (the page then returns to My Children).
  const child = childrenData.find(c => c.id === selectedChild);
  const activeChildIds = useMemo(() => childrenData.map(c => c.id), [childrenData]);
  const activity = findActivity(selectedActivity) || activities[0];
  const music = findMusic(selectedActivity) || musicActivities[0];
  const book = books.find(b => b.id === selectedBook) || books[0];
  const entry = entries.find(e => e.id === selectedEntry);

  const storageMessage = (failure: StorageFailure) => (failure === "full" ? t.storageFull : t.storageFailed);
  // For synchronous saves: shows the storage error and returns false when the write failed.
  const savedOk = (failure: StorageFailure | null) => {
    if (failure) setToast(storageMessage(failure));
    return !failure;
  };

  // Background writes (goals, profile, edits…) that fail are reported instead of being lost silently.
  useEffect(() => onStorageError(kind => setToast(kind === "full" ? copy[lang].storageFull : copy[lang].storageFailed)), [lang]);

  // After a restore every open RootMap tab reloads, so none can write its stale in-memory data back.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === RESTORED_AT_KEY) window.location.reload(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem(JUST_RESTORED_KEY)) return;
      sessionStorage.removeItem(JUST_RESTORED_KEY);
      setToast(copy[lang].restoreDone);
    } catch {
      // sessionStorage unavailable; the restore itself already succeeded.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolves to true only once the entries are stored, so a full device is reported instead of losing the entry.
  // `draft` is cleared in the same write, so a saved entry can never be resumed (and saved again) from its draft.
  const storeEntries = async (next: Entry[], draft?: string) =>
    !(await commitEntries(next, draft ? { drafts: [[draft, null]] } : undefined));

  // Copies legacy observations into the entry collection once each (tracked in MIGRATED_KEY). Safe to run on
  // every load; the observations themselves stay in their own collection. If storage is full it retries next load.
  useEffect(() => {
    const result = importObservations(entries, observations, migrated);
    if (!result) return;
    void commitEntries(result.entries).then(failure => { if (!failure) setMigrated(result.migrated); });
  }, [entries, observations, migrated, commitEntries, setMigrated]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  // "System Default" follows the device's setting, also when it changes while RootMap is open.
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = appearance === "dark" || (appearance === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    if (appearance !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const go = (s: Screen) => {
    setPrevious(screen);
    setScreen(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Returning to an earlier page (a back button, or leaving a form): see "Browser history" below.
  const goBack = (s: Screen) => {
    backNav.current = true;
    go(s);
  };

  // ── Browser history ────────────────────────────────────────────────────────────────────────────────────
  // The URL follows the page shown (lib/routes.ts). Opening a page adds a history entry. RootMap's own back buttons
  // (and leaving a form after saving or cancelling) go through `goBack`: when the page they return to is the one just
  // before in the browser history, that is a browser Back, so both Backs agree and the history doesn't grow;
  // otherwise the current entry is replaced. Browser Back/Forward set the page from the URL.
  const hash = formatRoute({
    screen,
    activity: selectedActivity,
    book: selectedBook,
    child: screen === "record" ? (recordFrom === "child" ? selectedChild : undefined) : screen === "entryEdit" ? editorChild : screen === "recap" ? recapChild || undefined : selectedChild,
    week: recapWeek || undefined,
    entry: selectedEntry,
    discoverTab,
    childTab: childTab === "Activities" ? "Activities" : "Journal",
  });
  const history = useRef<{ stack: string[]; idx: number } | null>(null);
  const backNav = useRef(false);
  useEffect(() => {
    const h = history.current;
    const isBack = backNav.current;
    backNav.current = false;
    if (!h) {
      // First render: this page is the current history entry.
      window.history.replaceState({ ...window.history.state, rmIdx: 0 }, "", hash);
      history.current = { stack: [hash], idx: 0 };
      return;
    }
    if (window.location.hash === hash) return;
    if (isBack && h.idx > 0 && h.stack[h.idx - 1] === hash) { window.history.back(); return; }
    // Switching tabs within a page (Discover's tabs, a child's tabs) updates the address without a new entry.
    const sameScreen = h.stack[h.idx]?.split("/")[1]?.split("?")[0] === hash.split("/")[1]?.split("?")[0] && (screen === "discover" || screen === "child" || screen === "recap");
    if (sameScreen || isBack) {
      window.history.replaceState({ ...window.history.state, rmIdx: h.idx }, "", hash);
      h.stack[h.idx] = hash;
      return;
    }
    h.stack = [...h.stack.slice(0, h.idx + 1), hash];
    h.idx += 1;
    window.history.pushState({ rmIdx: h.idx }, "", hash);
  }, [hash, screen]);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const h = history.current;
      const r = allowedRoute(parseRoute(window.location.hash)) ?? { screen: "today" as Screen };
      if (h) {
        // An address typed into the browser has no index yet: it becomes the next entry.
        const idx = typeof e.state?.rmIdx === "number" ? e.state.rmIdx : h.idx + 1;
        if (typeof e.state?.rmIdx !== "number") window.history.replaceState({ ...e.state, rmIdx: idx }, "", window.location.hash);
        h.stack = idx >= h.stack.length ? [...h.stack.slice(0, idx), window.location.hash] : h.stack;
        h.stack[idx] = window.location.hash;
        h.idx = idx;
      }
      setModal(null);
      setPrevious(screen);
      if (r.activity) setSelectedActivity(r.activity);
      if (r.book) setSelectedBook(r.book);
      if (r.discoverTab) setDiscoverTab(r.discoverTab);
      if (r.childTab) setChildTab(r.childTab);
      if (r.screen === "child" || r.screen === "record") setSelectedChild(r.child ?? "");
      if (r.screen === "record") setRecordFrom(r.child ? "child" : "quick");
      if (r.screen === "entry" || r.screen === "entryEdit") setSelectedEntry(r.entry);
      if (r.screen === "recap") { setRecapWeek(r.week ?? ""); setRecapChild(r.child ?? ""); }
      if (r.screen === "entryEdit" && !r.entry) { setEditorChild(r.child); setEditorPrefill(undefined); setEditorReturn("observations"); }
      setScreen(r.screen);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [screen]);

  // An address for something that no longer exists (a removed child or Moment, an activity or book taken out of the
  // catalog) opens the list it belonged to instead.
  useEffect(() => {
    if (screen === "child" && !child) setScreen("children");
    else if (screen === "entry" && !entry) setScreen("observations");
    else if ((screen === "activity" || screen === "music") && !findActivity(selectedActivity)) { setDiscoverTab(screen === "music" ? "music" : "activities"); setScreen("discover"); }
    else if (screen === "activity" && isMusicId(selectedActivity)) setScreen("music");
    else if (screen === "music" && !isMusicId(selectedActivity)) setScreen("activity");
    else if (screen === "book" && !books.some(b => b.id === selectedBook)) { setDiscoverTab("books"); setScreen("discover"); }
    else if (screen === "entryEdit" && selectedEntry && !entry) setScreen("observations");
  }, [screen, child, entry, selectedActivity, selectedBook, selectedEntry]);
  // Moments is no longer a tab, but keeps the bottom bar (it opens after saving a memory from Quick Add).
  const topLevel = ["today", "children", "discover", "observations", "profile"].includes(screen);
  const goChild = (id: string) => { setSelectedChild(id); setChildTab("Journal"); go("child"); };
  // An activity or music activity page (whichever is selected) opens through the same route.
  const activityScreen: Screen = isMusicId(selectedActivity) ? "music" : "activity";
  const openActivity = (id: string) => { setSelectedActivity(id); go(isMusicId(id) ? "music" : "activity"); };
  const toggleSaved = (id: string) => setSaved(saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id]);
  const originScreen: Screen = entryOrigin === "child" ? "child" : entryOrigin === "activity" ? activityScreen : entryOrigin === "today" ? "today" : entryOrigin === "children" ? "children" : entryOrigin === "recap" ? "recap" : "observations";
  const openEntry = (id: string, origin: "moments" | "child" | "today" | "children" | "recap") => { setSelectedEntry(id); setEntryOrigin(origin); go("entry"); };
  const startEntry = (origin: "moments" | "child" | "activity", childId?: string, prefill?: { title: string; date: string }) => {
    if (!childrenData.length) { setModal("addChild"); return; }
    setSelectedEntry(undefined);
    setEntryOrigin(origin);
    setEditorChild(defaultChildId(childrenData, childId) || undefined);
    setEditorPrefill(prefill);
    setEditorReturn(screen);
    go("entryEdit");
  };

  // Every activity record (Add Activity and Mark as Tried) is built and stored here, through the same builder.
  // Repeat attempts are separate records. Resolves to an error message, or null once stored.
  const addActivityRecord = async (input: RecordInput) => {
    const built = buildActivityRecord(input, newRecordId(input.kind === "tried" ? "t" : "r"), new Date().toISOString(), activeChildIds);
    if ("problem" in built) return problemMessage(built.problem, t);
    const failure = await commitRecords([built.record, ...records]);
    return failure ? storageMessage(failure) : null;
  };
  // Corrects a record's date, notes or child. Same id and everything else unchanged (stage, skills and the activity
  // stay as recorded). Resolves to an error message, or null once stored.
  const editActivityRecord = async (id: string, patch: { date: string; notes: string; childId: string }) => {
    if (!isActiveChild(childrenData, patch.childId)) return t.chooseChildFirst;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) return t.chooseDateFirst;
    const notes = patch.notes.trim();
    const next = records.map((r): LessonRecord => {
      if (r.id !== id) return r;
      // A translated seed note no longer matches once the note is edited.
      const notesZh = (r.notes || "") === notes ? r.notesZh : undefined;
      const { notes: _n, notesZh: _z, ...rest } = r;
      return { ...rest, childId: patch.childId, date: patch.date, ...(notes ? { notes } : {}), ...(notesZh ? { notesZh } : {}) };
    });
    const failure = await commitRecords(next);
    if (failure) return storageMessage(failure);
    setToast(t.recordUpdated);
    return null;
  };
  // My Week › complete: the plan is marked done and each of its children gets the activity in their history, through
  // the same record builder as Mark as Tried. Completing twice never adds a second record (planCompletionRecords).
  // Plans being completed right now: a second tap before the first save has finished is ignored.
  const completing = useRef(new Set<string>());
  const completePlan = async (plan: Plan) => {
    if (plan.completed || completing.current.has(plan.id)) return;
    completing.current.add(plan.id);
    try {
      const date = localIsoToday();
      const added = planCompletionRecords(plan, records, activeChildIds, date, new Date().toISOString(), () => newRecordId("t"));
      if (added.length && !savedOk(await commitRecords([...added, ...records]))) return;
      if (!savedOk(await commitPlans(plans.map(p => (p.id === plan.id ? { ...p, completed: true, completedDate: date } : p))))) return;
      setToast(added.length ? t.planCompletedRecorded : t.planCompleted);
    } finally {
      completing.current.delete(plan.id);
    }
  };
  // Completed › Repeat: the same activity planned again for today, for the children still in My Children.
  const repeatPlan = (plan: Plan) => {
    const childIds = plan.childIds.filter(id => isActiveChild(childrenData, id));
    setPlans(current => [...current, { id: newRecordId("p"), activityId: plan.activityId, date: localIsoToday(), childIds, ...(plan.note ? { note: plan.note } : {}) }]);
    setToast(t.planRepeated);
  };
  // "Mark as Tried": the quick record for the activity already open in Discover.
  const saveTried = (childId: string, date: string, notes: string) => addActivityRecord({ kind: "tried", childId, date, activityId: activity.id, notes });

  const closeModal = (destination?: Screen | ModalKind) => {
    setModal(null);
    // Closing without a destination (×, Cancel, tapping outside) stays where the parent was; a stray argument
    // such as a click event must never be treated as a screen (it used to fall through to Help & Support).
    if (typeof destination !== "string") return;
    if (destination === "record") {
      if (!childrenData.length) { setModal("addChild"); return; }
      setRecordFrom("quick");
      go("record");
    }
    else if (destination === "entryEdit") startEntry("moments", momentsFilter === "All" ? undefined : momentsFilter);
    else if (destination === "addChild") setModal("addChild");
    else if (destination && destination !== "quick" && destination !== "filters" && destination !== "plan" && destination !== "weekAdd") go(destination as Screen);
  };

  // The sign-in actions the opening screens use. Signing in creates the session and the empty family and profile on
  // the server, then the app reloads into the account's own space; nothing on this device is uploaded, moved or
  // changed. The reload waits until sign-in has finished.
  const openingAuth = {
    sendCode: sendSignInCode,
    confirmCode: async (email: string, code: string) => {
      holdSwitch.current = true;
      try {
        const result = await confirmSignInCode(email, code);
        if (result.ok) {
          if (welcomeStart === "show") await saveSetting(WELCOME_KEY, "done");
          afterSwitchTo({ toast: t.signedInAs.replace("{email}", email), screen: screen === "signIn" ? "profile" : undefined });
        }
        return result;
      } finally {
        holdSwitch.current = false;
        if (!spaceMatches(activeSpace(), cloudState())) reloadIntoSpace();
      }
    },
  };
  // Signs out of this device only, then reloads into the guest space. Everything stored on the device stays.
  const signOut = async () => {
    afterSwitchTo({ toast: t.signedOut, screen: "profile" });
    await signOutHere();
  };

  const content = () => {
    if (screen === "today") {
      return (
        <TodayPage
          entries={entries}
          records={records}
          childrenData={childrenData}
          lang={lang}
          openActivity={openActivity}
          openEntry={id => openEntry(id, "today")}
          openRecord={(childId, recordId) => { setSelectedChild(childId); setChildTab("Activities"); setFocusRecord(recordId); go("child"); }}
          openRecap={week => { setRecapWeek(week); setRecapChild(""); go("recap"); }}
          openDiscover={() => { setDiscoverTab("activities"); go("discover"); }}
          openAddChild={() => setModal("addChild")}
          t={t}
        />
      );
    }
    if (screen === "children") {
      return (
        <ChildrenPage
          childrenData={childrenData}
          entries={entries}
          goChild={goChild}
          openEntry={id => openEntry(id, "children")}
          openAddChild={() => setModal("addChild")}
          openMoments={() => go("observations")}
          t={t}
        />
      );
    }
    if (screen === "discover") {
      return <DiscoverPage tab={discoverTab} setTab={setDiscoverTab} saved={saved} toggleSaved={toggleSaved} open={openActivity} openBook={id => { setSelectedBook(id); go("book"); }} childrenData={childrenData} t={t} />;
    }
    if (screen === "music") {
      if (!music) return null;
      return (
        <MusicDetailPage
          music={music}
          saved={saved.includes(music.id)}
          toggleSaved={() => toggleSaved(music.id)}
          back={() => goBack(previous === "week" || previous === "today" ? previous : "discover")}
          openPlan={() => setModal("plan")}
          openTried={() => setModal("tried")}
          t={t}
        />
      );
    }
    if (screen === "book") {
      if (!book) return null;
      return (
        <BookDetailPage
          book={book}
          shelf={shelfOf(bookshelf.items, book.id)}
          place={bookshelf.place}
          back={() => goBack(previous === "bookshelf" ? "bookshelf" : "discover")}
          notify={setToast}
          t={t}
        />
      );
    }
    if (screen === "bookshelf") {
      return (
        <BookshelfPage
          items={bookshelf.items}
          openBook={id => { setSelectedBook(id); go("book"); }}
          explore={() => { setDiscoverTab("books"); go("discover"); }}
          back={() => goBack("profile")}
          t={t}
        />
      );
    }
    if (screen === "activity") {
      return (
        <ActivityDetailPage
          activity={activity}
          saved={saved.includes(activity.id)}
          toggleSaved={() => setSaved(saved.includes(activity.id) ? saved.filter(x => x !== activity.id) : [...saved, activity.id])}
          back={() => goBack(previous === "week" || previous === "today" ? previous : "discover")}
          openPlan={() => setModal("plan")}
          openTried={() => setModal("tried")}
          notify={setToast}
          t={t}
        />
      );
    }
    if (screen === "observations") {
      return (
        <MomentsPage
          entries={entries}
          childrenData={childrenData}
          childFilter={momentsFilter}
          setChildFilter={setMomentsFilter}
          lang={lang}
          open={id => openEntry(id, "moments")}
          write={childId => startEntry("moments", childId)}
          openRecap={childId => { setRecapWeek(""); setRecapChild(childId ?? ""); go("recap"); }}
          back={() => goBack("children")}
          t={t}
        />
      );
    }
    if (screen === "profile") return <ProfilePage go={go} lang={lang} appearance={appearance} profile={profile} deletedCount={deletedChildren.length} bookshelfCount={bookshelf.items.filter(i => books.some(b => b.id === i.bookId)).length} cloud={cloud} t={t} />;
    if (screen === "account") return <AccountPage cloud={cloud} back={() => goBack("profile")} signOut={signOut} openImport={importAvailable ? () => go("guestImport") : undefined} t={t} />;
    if (screen === "guestImport" && syncUser) {
      return <GuestImportPage userId={syncUser} back={() => goBack(previous === "account" ? "account" : "today")} done={started => { if (started) setToast(t.importStarted); setImportAvailable(false); go("account"); }} lang={lang} t={t} />;
    }
    if (screen === "child") {
      if (!child) return null;
      return (
        <ChildProfilePage
          child={child}
          records={records}
          entries={entries}
          pendingNotes={hasPendingNotes(child, entries, migrated)}
          tab={childTab}
          setTab={setChildTab}
          lang={lang}
          openEntry={id => openEntry(id, "child")}
          writeEntry={() => startEntry("child", child.id)}
          importNotes={async () => {
            // Copies the legacy note into the collection once; `child.notes` itself is left untouched.
            if (!hasPendingNotes(child, entries, migrated)) return;
            if (!(await storeEntries([notesEntry(child), ...entries]))) { setToast(t.journalStorageFull); return; }
            setMigrated([...migrated, `notes:${child.id}`]);
            setToast(t.entrySaved);
          }}
          edit={() => setModal("editChild")}
          remove={async () => {
            // Runs once the parent confirms in the page's dialog. The child's journal entries, activity records,
            // plans and drafts are never deleted with the profile.
            // One write: the profile is soft-deleted (kept with its photo and id) and appears in Recently Deleted.
            if (!savedOk(await commitChildren(childrenData.filter(c => c.id !== child.id)))) return;
            goBack("children");
          }}
          back={() => goBack("children")}
          record={() => { setRecordFrom("child"); go("record"); }}
          childrenData={childrenData}
          editRecord={editActivityRecord}
          focusRecord={focusRecord}
          focusedRecord={() => setFocusRecord(undefined)}
          deleteRecord={async id => {
            if (!savedOk(await commitRecords(records.filter(r => r.id !== id)))) return false;
            setToast(t.recordDeleted);
            return true;
          }}
          t={t}
        />
      );
    }
    if (screen === "record") {
      return (
        <RecordFormPage
          childrenData={childrenData}
          // From a child's page that child; from Quick Add the only child, or none so the parent chooses.
          childId={recordFrom === "child" && child ? child.id : defaultChildId(childrenData)}
          lockChild={recordFrom === "child" && !!child}
          records={records}
          // Cancel returns to wherever the form was opened (a child's page, or any tab through Quick Add).
          cancel={() => goBack(previous)}
          t={t}
          save={async r => {
            // Activity notes stay on the activity record (Activities tab); memories are recorded through Moments.
            const failure = await addActivityRecord(r);
            if (failure) return failure;
            setToast(t.entrySaved);
            setSelectedChild(r.childId);
            setChildTab("Activities");
            goBack("child");
            return null;
          }}
        />
      );
    }
    if (screen === "entry") {
      if (!entry) return null;
      return (
        <EntryDetailPage
          entry={entry}
          child={childrenData.find(c => c.id === entry.childId)}
          lang={lang}
          back={() => goBack(originScreen)}
          edit={() => go("entryEdit")}
          remove={async () => {
            if (!(await storeEntries(entries.filter(e => e.id !== entry.id)))) { setToast(t.journalStorageFull); return; }
            setToast(t.entryDeleted);
            goBack(originScreen);
          }}
          t={t}
        />
      );
    }
    if (screen === "entryEdit") {
      return (
        <EntryEditorPage
          key={`${entryOrigin}:${entry?.id || "new"}:${editorChild || ""}:${editorPrefill?.title || ""}`}
          childrenData={childrenData}
          childId={entry?.childId || defaultChildId(childrenData, editorChild)}
          lockChild={entryOrigin === "child"}
          entry={entry}
          prefill={entry ? undefined : editorPrefill}
          lang={lang}
          // Leaving without saving returns to where the editor was opened (a tab through Quick Add, a child, an activity,
          // Moments); saving still lands on the origin. The autosaved draft is kept either way.
          back={() => goBack(entry ? "entry" : editorReturn)}
          save={async (f, draft) => {
            const now = new Date().toISOString();
            const fields = { childId: f.childId, date: f.date, title: f.title.trim() || undefined, text: f.text.trim() ? f.text : undefined, photos: f.photos };
            if (entry) {
              // Same id and createdAt; a translated seed text no longer matches once the text is edited.
              const textZh = (entry.text || "") === (fields.text || "") ? entry.textZh : undefined;
              if (!(await storeEntries(entries.map(e => (e.id === entry.id ? { ...e, ...fields, textZh, updatedAt: now } : e)), draft))) return false;
            } else {
              if (!(await storeEntries([{ id: newRecordId("m"), ...fields, createdAt: now, updatedAt: now }, ...entries], draft))) return false;
            }
            setToast(t.entrySaved);
            goBack(originScreen);
            return true;
          }}
          t={t}
        />
      );
    }
    if (screen === "goals") {
      return <GoalsPage goals={goals} setGoals={setGoals} back={() => goBack("profile")} openNotes={() => go("notes")} t={t} />;
    }
    if (screen === "week") {
      return (
        <MyWeekPage
          saved={saved}
          plans={plans}
          setPlans={setPlans}
          completePlan={plan => void completePlan(plan)}
          repeatPlan={repeatPlan}
          childFilter={weekFilter}
          setChildFilter={setWeekFilter}
          childrenData={childrenData}
          openActivity={openActivity}
          openAdd={() => setModal("weekAdd")}
          back={() => goBack("profile")}
          t={t}
        />
      );
    }
    if (screen === "saved") {
      return (
        <main className="simple-page">
          <PageHeader title={t.savedActivities} back={() => goBack("profile")} />
          <div className="week-list">
            {saved.map(id => {
              const a = findActivity(id);
              if (!a) return null;
              return <ActivityRow a={a} t={t} action={<button onClick={() => openActivity(id)} aria-label={localizeActivity(a, t).title}><Icon name="chevron" /></button>} key={id} />;
            })}
          </div>
        </main>
      );
    }
    // Developer/migration utility only: no parent-facing navigation leads here. Saving is meant to be
    // automatic (see the planned cloud sync); the backup library in lib/backup.ts stays for migration.
    if (screen === "backup") {
      return (
        <BackupPage
          snapshot={backupData}
          restore={async backup => {
            if (dataMode() === "localStorage") return applyBackup(localStorage, backup);
            return (await restoreData(backup.data)) ? { ok: true as const } : { ok: false as const, rolledBack: true };
          }}
          lastBackup={lastBackup}
          setLastBackup={setLastBackup}
          restored={() => {
            try { localStorage.setItem(RESTORED_AT_KEY, new Date().toISOString()); } catch { /* other tabs just won't auto-reload */ }
            try { sessionStorage.setItem(JUST_RESTORED_KEY, "1"); } catch { /* no confirmation toast */ }
            window.location.reload();
          }}
          back={() => goBack("profile")}
          lang={lang}
          t={t}
        />
      );
    }
    if (screen === "recap") {
      return (
        <WeeklyRecapPage
          entries={entries}
          childrenData={childrenData}
          week={recapWeek}
          setWeek={setRecapWeek}
          child={recapChild}
          setChild={setRecapChild}
          lang={lang}
          open={id => openEntry(id, "recap")}
          back={() => goBack("today")}
          t={t}
        />
      );
    }
    if (screen === "deletedChildren") {
      return (
        <DeletedChildrenPage
          deleted={deletedChildren}
          childrenData={childrenData}
          entries={entries}
          records={records}
          restore={async d => {
            if (childrenData.some(c => c.id === d.id)) return;
            // Runs once the parent confirms in the page's dialog.
            // Clearing deletedAt brings the same record (same id) back, with its entries and records.
            const { deletedAt: _deletedAt, ...profile } = d;
            if (!savedOk(await commitChildren([...childrenData, profile]))) return;
            setToast(t.childRestored.replace("{name}", d.first));
          }}
          back={() => goBack("profile")}
          lang={lang}
          t={t}
        />
      );
    }
    if (screen === "notifications") {
      return <NotificationsPage back={() => goBack("children")} t={t} />;
    }
    return <SettingsPage screen={screen} back={() => goBack(screen === "notes" && previous === "goals" ? "goals" : "profile")} lang={lang} setLang={setLang} appearance={appearance} setAppearance={setAppearance} profile={profile} setProfile={setProfile} notify={setToast} t={t} />;
  };

  if (cloudConfig.enabled && (showWelcome || screen === "signIn")) {
    const fromProfile = !showWelcome;
    return (
      <div className="opening-screen">
        <div>
          <OpeningExperience
            lang={lang}
            setLang={setLang}
            startAt={fromProfile ? "final" : "animation"}
            auth={openingAuth}
            onContinueAsGuest={() => (fromProfile ? go("profile") : setWelcome("done"))}
          />
        </div>
        {isBeta && <BetaNotice t={t} />}
      </div>
    );
  }

  if (OpeningPreview && previewOpening) {
    return <Suspense fallback={null}><OpeningPreview lang={lang} setLang={setLang} /></Suspense>;
  }

  return (
    <CopyContext.Provider value={t}>
    <ConfirmProvider>
    <div className="app-shell">
      <Shell active={screen} go={go} openQuick={() => setModal("quick")} t={t} nav={topLevel}>
        {content()}
      </Shell>
      <ModalOverlay
        modal={modal}
        close={closeModal}
        childrenData={childrenData}
        setChildrenData={async next => savedOk(await commitChildren(next))}
        filters={filters}
        setFilters={setFilters}
        selectedActivity={activity}
        plans={plans}
        setPlans={async next => savedOk(await commitPlans(next))}
        selectedChild={selectedChild}
        saveTried={saveTried}
        addMemory={(childId, date) => { setModal(null); startEntry("activity", childId, { title: localizeActivity(activity, t).title, date }); }}
        notify={setToast}
        t={t}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
      {isBeta && <BetaNotice t={t} />}
    </div>
    </ConfirmProvider>
    </CopyContext.Provider>
  );
}
