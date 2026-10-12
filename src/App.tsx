import { lazy, Suspense, useEffect, useState } from "react";
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
import { onStorageError, tryStore, useStored, type StorageFailure } from "./lib/storage";
import { LAST_BACKUP_KEY, RESTORED_AT_KEY } from "./lib/backup";
import { ENTRIES_KEY, MIGRATED_KEY, hasPendingNotes, importObservations, notesEntry } from "./lib/entries";
import { copy, localizeActivity } from "./lib/i18n";
import { initialChildren } from "./data/children";
import { initialRecords, initialObservations } from "./data/progress";
import { activities } from "./data/activities";
import { SEED_VERSION } from "./data/seedVersion";
import type { Child, DeletedChild, Entry, Goal, LessonRecord, Lang, ModalKind, Observation, Plan, ProfileInfo, Screen } from "./types";
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

// Unique even when two records are created within the same millisecond.
const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Profiles removed from My Children are kept here (with their photo) and can be restored from Profile.
const DELETED_CHILDREN_KEY = "rootmap-deleted-children";
// Development-only preview of the opening experience (`?opening`, `?opening=final`). Not part of navigation yet;
// in production builds this is null and the component isn't bundled.
const OpeningPreview = import.meta.env.DEV ? lazy(() => import("./dev/OpeningPreview")) : null;
const previewOpening = import.meta.env.DEV && new URLSearchParams(window.location.search).has("opening");

// Set just before the reload that follows a restore, so the reloaded app can confirm it.
const JUST_RESTORED_KEY = "rootmap-just-restored";

export default function App() {
  const [screen, setScreen] = useState<Screen>("children");
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
  const [toast, setToast] = useState("");

  const [childrenData, setChildrenData, commitChildren] = useStored<Child[]>("rootmap-children", initialChildren);
  const [records, setRecords, commitRecords] = useStored<LessonRecord[]>("rootmap-records", initialRecords);
  const [observations, setObservations] = useStored<Observation[]>("rootmap-observations", initialObservations);
  const [seedVersion, setSeedVersion] = useStored<number>("rootmap-seed-version", 0);
  // Every seed item this device has received ("child:emma", "record:r1", "obs:o1"); see mergeSeed.
  const [seenSeeds, setSeenSeeds] = useStored<string[]>("rootmap-seed-ids", []);
  const [profile, setProfile] = useStored<ProfileInfo>("rootmap-profile", { name: "Alex Hao", photo: alexPhoto, contact: "" });
  const [saved, setSaved] = useStored<string[]>("rootmap-saved", ["water-pouring", "dotting"]);
  const [plans, setPlans, commitPlans] = useStored<Plan[]>("rootmap-plans", []);
  // Moments/Journal entries (per child) and goals (per parent) are never part of the seed merge.
  const [entries, setEntries] = useStored<Entry[]>(ENTRIES_KEY, []);
  const [migrated, setMigrated] = useStored<string[]>(MIGRATED_KEY, []);
  const [goals, setGoals] = useStored<Goal[]>("rootmap-goals", []);
  const [deletedChildren, , commitDeleted] = useStored<DeletedChild[]>(DELETED_CHILDREN_KEY, []);
  const [lastBackup, setLastBackup] = useStored<string>(LAST_BACKUP_KEY, "");
  const [lang, setLang] = useStored<Lang>("rootmap-language", "en");
  const [appearance, setAppearance] = useStored<string>("rootmap-appearance", "light");
  const [view, setView] = useStored<string>("rootmap-child-view", "grid");
  const [filters, setFilters] = useStored<ChildFilters>("rootmap-child-filters", { age: "All Ages", group: "All Groups", recent: "Any Time", sort: "Name A–Z" });
  const [weekFilter, setWeekFilter] = useState("all");

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

  // Writes synchronously first so a full device (large photos) is reported instead of silently losing the entry.
  const storeEntries = (next: Entry[]) => {
    if (!tryStore(ENTRIES_KEY, next)) return false;
    setEntries(next);
    return true;
  };

  // Copies legacy observations into the entry collection once each (tracked in MIGRATED_KEY). Safe to run on
  // every load; the observations themselves stay in "rootmap-observations". If storage is full it retries next load.
  useEffect(() => {
    const result = importObservations(entries, observations, migrated);
    if (!result || !tryStore(ENTRIES_KEY, result.entries)) return;
    setEntries(result.entries);
    setMigrated(result.migrated);
  }, [entries, observations, migrated, setEntries, setMigrated]);

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
  const saveTried = (childId: string, date: string, notes: string) => {
    const record: LessonRecord = { id: newId("t"), childId, kind: "tried", activityId: activity.id, lesson: activity.title, date, createdAt: new Date().toISOString(), ...(notes ? { notes } : {}) };
    const failure = commitRecords([record, ...records]);
    return failure ? storageMessage(failure) : null;
  };

  const closeModal = (destination?: Screen | ModalKind) => {
    setModal(null);
    if (destination === "record") go("record");
    else if (destination === "entryEdit") startEntry("moments", momentsFilter === "All" ? undefined : momentsFilter);
    else if (destination === "addChild") setModal("addChild");
    else if (destination && destination !== "quick" && destination !== "filters" && destination !== "plan" && destination !== "weekAdd") go(destination as Screen);
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
    if (screen === "profile") return <ProfilePage go={go} lang={lang} appearance={appearance} profile={profile} deletedCount={deletedChildren.length} t={t} />;
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
          importNotes={() => {
            // Copies the legacy note into the collection once; `child.notes` itself is left untouched.
            if (!hasPendingNotes(child, entries, migrated)) return;
            if (!storeEntries([notesEntry(child), ...entries])) { setToast(t.journalStorageFull); return; }
            setMigrated([...migrated, `notes:${child.id}`]);
            setToast(t.entrySaved);
          }}
          edit={() => {
            const fullName = window.prompt(t.childFullName, `${child.first} ${child.last}`);
            if (!fullName?.trim()) return;
            const [first, ...last] = fullName.trim().split(" ");
            setChildrenData(childrenData.map(c => (c.id === child.id ? { ...c, first, last: last.join(" ") || c.last } : c)));
          }}
          remove={() => {
            // The child's journal entries, activity records, plans and drafts are never deleted with the profile;
            // the warning says how much is attached so nothing disappears from view unexpectedly.
            const entryCount = entries.filter(e => e.childId === child.id).length;
            const recordCount = records.filter(r => r.childId === child.id).length;
            const message = entryCount || recordCount
              ? t.confirmDeleteChildWithData.split("{name}").join(child.first).replace("{entries}", String(entryCount)).replace("{records}", String(recordCount))
              : t.confirmDeleteChild.replace("{name}", `${child.first} ${child.last}`);
            if (!window.confirm(message)) return;
            // The profile must be safely in the deleted list before it leaves My Children.
            if (!savedOk(commitDeleted([...deletedChildren, { ...child, deletedAt: new Date().toISOString() }]))) return;
            if (!savedOk(commitChildren(childrenData.filter(c => c.id !== child.id)))) return;
            go("children");
          }}
          back={() => go("children")}
          record={() => go("record")}
          deleteRecord={id => {
            if (!savedOk(commitRecords(records.filter(r => r.id !== id)))) return false;
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
          save={r => {
            const item = { ...r, id: newId("r"), childId: child.id, createdAt: new Date().toISOString() };
            // Activity notes stay on the activity record (Activities tab); memories are recorded through Moments.
            if (!savedOk(commitRecords([item, ...records]))) return;
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
          remove={() => {
            if (!storeEntries(entries.filter(e => e.id !== entry.id))) { setToast(t.journalStorageFull); return; }
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
          save={f => {
            const now = new Date().toISOString();
            const fields = { childId: f.childId, date: f.date, title: f.title.trim() || undefined, text: f.text.trim() ? f.text : undefined, photos: f.photos };
            if (entry) {
              // Same id and createdAt; a translated seed text no longer matches once the text is edited.
              const textZh = (entry.text || "") === (fields.text || "") ? entry.textZh : undefined;
              if (!storeEntries(entries.map(e => (e.id === entry.id ? { ...e, ...fields, textZh, updatedAt: now } : e)))) return false;
            } else {
              if (!storeEntries([{ id: newId("m"), ...fields, createdAt: now, updatedAt: now }, ...entries])) return false;
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
          shown={{
            "rootmap-children": childrenData, "rootmap-records": records, "rootmap-observations": observations, "rootmap-journal": entries,
            "rootmap-saved": saved, "rootmap-plans": plans, "rootmap-goals": goals, "rootmap-profile": profile,
            "rootmap-language": lang, "rootmap-appearance": appearance,
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
          restore={d => {
            if (childrenData.some(c => c.id === d.id)) return;
            if (!window.confirm(t.confirmRestoreChild.replace("{name}", `${d.first} ${d.last}`))) return;
            const { deletedAt: _deletedAt, ...profile } = d;
            if (!savedOk(commitChildren([...childrenData, profile]))) return;
            // If this second write fails the profile simply also stays listed here, marked as already restored.
            commitDeleted(deletedChildren.filter(x => x !== d));
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
        setChildrenData={next => savedOk(commitChildren(next))}
        filters={filters}
        setFilters={setFilters}
        selectedActivity={activity}
        plans={plans}
        setPlans={next => savedOk(commitPlans(next))}
        selectedChild={selectedChild}
        saveTried={saveTried}
        addMemory={(childId, date) => { setModal(null); startEntry("activity", childId, { title: localizeActivity(activity, t).title, date }); }}
        t={t}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
