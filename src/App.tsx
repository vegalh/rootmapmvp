import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Shell, PageHeader } from "./components/ui";
import { ModalOverlay } from "./components/ModalOverlay";
import { Icon } from "./components/Icon";
import { ChildrenPage } from "./pages/ChildrenPage";
import { DiscoverPage } from "./pages/DiscoverPage";
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
import { BackupPage } from "./pages/BackupPage";
import { DeletedChildrenPage } from "./pages/DeletedChildrenPage";
import { AccountPage } from "./pages/AccountPage";
import OpeningExperience from "./components/OpeningExperience";
import { onStorageError, type StorageFailure } from "./lib/storage";
import { LAST_BACKUP_KEY, RESTORED_AT_KEY, applyBackup } from "./lib/backup";
import { saveSetting, useCollection, useSetting } from "./lib/data/hooks";
import { activeSpace, backupData, dataMode, restoreData, syncMeta } from "./lib/data/store";
import { newRecordId } from "./lib/data/schema";
import { MIGRATED_KEY, hasPendingNotes, importObservations, notesEntry } from "./lib/entries";
import { copy, localizeActivity } from "./lib/i18n";
import { cloudConfig } from "./lib/cloud/config";
import { useCloudState } from "./lib/cloud/hooks";
import { cloudState, confirmSignInCode, sendSignInCode, signOutHere } from "./lib/cloud/session";
import { spaceMatches } from "./lib/cloud/space";
import { startSync } from "./lib/sync/runner";
import { WELCOME_KEY, welcomeAtStart, type WelcomeState } from "./lib/welcome";
import { initialChildren } from "./data/children";
import { initialRecords, initialObservations } from "./data/progress";
import { activities } from "./data/activities";
import { SEED_VERSION } from "./data/seedVersion";
import type { DeletedChild, Entry, LessonRecord, Lang, ModalKind, ProfileInfo, Screen } from "./types";
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

export default function App() {
  const [afterSwitch] = useState(readAfterSwitch);
  const [screen, setScreen] = useState<Screen>(afterSwitch?.screen ?? "children");
  const [previous, setPrevious] = useState<Screen>("children");
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedChild, setSelectedChild] = useState("emma");
  const [selectedActivity, setSelectedActivity] = useState("water-pouring");
  const [childTab, setChildTab] = useState("Journal");
  // Entry being viewed/edited; undefined in the editor means "new entry".
  const [selectedEntry, setSelectedEntry] = useState<string | undefined>();
  // Where the current entry flow started, so detail/editor return there ("child" = that child's Journal,
  // "activity" = the activity page a memory was added from after marking it as tried).
  const [entryOrigin, setEntryOrigin] = useState<"moments" | "child" | "activity">("moments");
  // Child preselected for a new entry.
  const [editorChild, setEditorChild] = useState<string | undefined>();
  // Editable starting title/date for a new entry (the activity just marked as tried).
  const [editorPrefill, setEditorPrefill] = useState<{ title: string; date: string } | undefined>();
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
  const [profile, setProfile] = useSetting<ProfileInfo>("rootmap-profile", { name: "Alex Hao", photo: alexPhoto, contact: "" });
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

  const afterSwitchTo = (next: AfterSwitch) => {
    try { sessionStorage.setItem(AFTER_SWITCH_KEY, JSON.stringify(next)); } catch { /* the reload still happens */ }
  };

  // When the bundled seed data changes (SEED_VERSION bumped), merge in new demo items without touching anything
  // already on the device (see mergeSeed). The parent's profile and all their own data are never reset.
  useEffect(() => {
    // A device without a seen-list has already received every current seed item (it's on this version, or it
    // predates the list); treating them all as seen means a demo child the parent deleted is never re-added.
    const seen = new Set(seenSeeds.length ? seenSeeds : seedIds);
    if (seedVersion < SEED_VERSION) {
      setChildrenData(current => mergeSeed(current, initialChildren, "child", seen));
      setRecords(current => mergeSeed(current, initialRecords, "record", seen));
      setObservations(current => mergeSeed(current, initialObservations, "obs", seen));
      // Hide saved-activity ids that no longer exist, which previously caused a white-screen crash.
      setSaved(current => current.filter(id => activities.some(a => a.id === id)));
      setSeedVersion(SEED_VERSION);
    }
    const all = [...new Set([...seen, ...seedIds])];
    if (all.length !== seenSeeds.length) setSeenSeeds(all);
  }, [seedVersion, seenSeeds, setChildrenData, setRecords, setObservations, setSaved, setSeedVersion, setSeenSeeds]);

  const t = copy[lang];
  const child = childrenData.find(c => c.id === selectedChild) || childrenData[0];
  const activity = activities.find(a => a.id === selectedActivity) || activities[0];
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

  useEffect(() => {
    const dark = appearance === "dark" || (appearance === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [appearance]);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const go = (s: Screen) => {
    setPrevious(screen);
    setScreen(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const topLevel = ["children", "discover", "observations", "profile"].includes(screen);
  const goChild = (id: string) => { setSelectedChild(id); setChildTab("Journal"); go("child"); };
  const originScreen: Screen = entryOrigin === "child" ? "child" : entryOrigin === "activity" ? "activity" : "observations";
  const openEntry = (id: string, origin: "moments" | "child") => { setSelectedEntry(id); setEntryOrigin(origin); go("entry"); };
  const startEntry = (origin: "moments" | "child" | "activity", childId?: string, prefill?: { title: string; date: string }) => {
    if (!childrenData.length) { setModal("addChild"); return; }
    setSelectedEntry(undefined);
    setEntryOrigin(origin);
    setEditorChild(childId);
    setEditorPrefill(prefill);
    go("entryEdit");
  };

  // "Mark as Tried": one more record in the existing activity history. Repeat attempts are separate records.
  const saveTried = async (childId: string, date: string, notes: string) => {
    const record: LessonRecord = { id: newRecordId("t"), childId, kind: "tried", activityId: activity.id, lesson: activity.title, date, createdAt: new Date().toISOString(), ...(notes ? { notes } : {}) };
    const failure = await commitRecords([record, ...records]);
    return failure ? storageMessage(failure) : null;
  };

  const closeModal = (destination?: Screen | ModalKind) => {
    setModal(null);
    if (destination === "record") go("record");
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
    if (screen === "children") {
      return (
        <ChildrenPage
          childrenData={childrenData}
          entries={entries}
          goChild={goChild}
          openAddChild={() => setModal("addChild")}
          openNotifications={() => go("notifications")}
          t={t}
        />
      );
    }
    if (screen === "discover") {
      return <DiscoverPage saved={saved} toggleSaved={id => setSaved(saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id])} open={id => { setSelectedActivity(id); go("activity"); }} t={t} />;
    }
    if (screen === "activity") {
      return (
        <ActivityDetailPage
          activity={activity}
          saved={saved.includes(activity.id)}
          toggleSaved={() => setSaved(saved.includes(activity.id) ? saved.filter(x => x !== activity.id) : [...saved, activity.id])}
          back={() => go(previous === "week" ? "week" : "discover")}
          openPlan={() => setModal("plan")}
          openTried={() => setModal("tried")}
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
          t={t}
        />
      );
    }
    if (screen === "profile") return <ProfilePage go={go} lang={lang} appearance={appearance} profile={profile} deletedCount={deletedChildren.length} cloud={cloud} t={t} />;
    if (screen === "account") return <AccountPage cloud={cloud} back={() => go("profile")} signOut={signOut} t={t} />;
    if (screen === "child") {
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
          edit={() => {
            const fullName = window.prompt(t.childFullName, `${child.first} ${child.last}`);
            if (!fullName?.trim()) return;
            const [first, ...last] = fullName.trim().split(" ");
            setChildrenData(childrenData.map(c => (c.id === child.id ? { ...c, first, last: last.join(" ") || c.last } : c)));
          }}
          remove={async () => {
            // The child's journal entries, activity records, plans and drafts are never deleted with the profile;
            // the warning says how much is attached so nothing disappears from view unexpectedly.
            const entryCount = entries.filter(e => e.childId === child.id).length;
            const recordCount = records.filter(r => r.childId === child.id).length;
            const message = entryCount || recordCount
              ? t.confirmDeleteChildWithData.split("{name}").join(child.first).replace("{entries}", String(entryCount)).replace("{records}", String(recordCount))
              : t.confirmDeleteChild.replace("{name}", `${child.first} ${child.last}`);
            if (!window.confirm(message)) return;
            // One write: the profile is soft-deleted (kept with its photo and id) and appears in Recently Deleted.
            if (!savedOk(await commitChildren(childrenData.filter(c => c.id !== child.id)))) return;
            go("children");
          }}
          back={() => go("children")}
          record={() => go("record")}
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
          child={child}
          cancel={() => go("child")}
          t={t}
          save={async r => {
            const item = { ...r, id: newRecordId("r"), childId: child.id, createdAt: new Date().toISOString() };
            // Activity notes stay on the activity record (Activities tab); memories are recorded through Moments.
            if (!savedOk(await commitRecords([item, ...records]))) return;
            go("child");
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
          back={() => go(originScreen)}
          edit={() => go("entryEdit")}
          remove={async () => {
            if (!(await storeEntries(entries.filter(e => e.id !== entry.id)))) { setToast(t.journalStorageFull); return; }
            setToast(t.entryDeleted);
            go(originScreen);
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
          childId={entry?.childId || (editorChild && childrenData.some(c => c.id === editorChild) ? editorChild : childrenData[0]?.id || "")}
          lockChild={entryOrigin === "child"}
          entry={entry}
          prefill={entry ? undefined : editorPrefill}
          lang={lang}
          back={() => go(entry ? "entry" : originScreen)}
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
            go(originScreen);
            return true;
          }}
          t={t}
        />
      );
    }
    if (screen === "goals") {
      return <GoalsPage goals={goals} setGoals={setGoals} back={() => go("profile")} openNotes={() => go("notes")} t={t} />;
    }
    if (screen === "week") {
      return (
        <MyWeekPage
          saved={saved}
          plans={plans}
          setPlans={setPlans}
          childFilter={weekFilter}
          setChildFilter={setWeekFilter}
          childrenData={childrenData}
          openActivity={id => { setSelectedActivity(id); go("activity"); }}
          openAdd={() => setModal("weekAdd")}
          back={() => go("profile")}
          t={t}
        />
      );
    }
    if (screen === "saved") {
      return (
        <main className="simple-page">
          <PageHeader title={t.savedActivities} back={() => go("profile")} />
          <div className="week-list">
            {saved.map(id => {
              const a = activities.find(x => x.id === id);
              if (!a) return null;
              return <ActivityRow a={a} t={t} action={<button onClick={() => { setSelectedActivity(id); go("activity"); }}><Icon name="chevron" /></button>} key={id} />;
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
          back={() => go("profile")}
          lang={lang}
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
            if (!window.confirm(t.confirmRestoreChild.replace("{name}", `${d.first} ${d.last}`))) return;
            // Clearing deletedAt brings the same record (same id) back, with its entries and records.
            const { deletedAt: _deletedAt, ...profile } = d;
            if (!savedOk(await commitChildren([...childrenData, profile]))) return;
            setToast(t.childRestored.replace("{name}", d.first));
          }}
          back={() => go("profile")}
          lang={lang}
          t={t}
        />
      );
    }
    if (screen === "notifications") {
      return <NotificationsPage childrenData={childrenData} back={() => go("children")} goChild={goChild} t={t} />;
    }
    return <SettingsPage screen={screen} back={() => go(screen === "notes" && previous === "goals" ? "goals" : "profile")} lang={lang} setLang={setLang} appearance={appearance} setAppearance={setAppearance} profile={profile} setProfile={setProfile} t={t} />;
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
      </div>
    );
  }

  if (OpeningPreview && previewOpening) {
    return <Suspense fallback={null}><OpeningPreview lang={lang} setLang={setLang} /></Suspense>;
  }

  return (
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
        t={t}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
