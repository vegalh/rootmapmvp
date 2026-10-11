import { useEffect, useState } from "react";
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
import { tryStore, useStored } from "./lib/storage";
import { ENTRIES_KEY, MIGRATED_KEY, hasPendingNotes, importObservations, notesEntry } from "./lib/entries";
import { copy } from "./lib/i18n";
import { initialChildren } from "./data/children";
import { initialRecords, initialObservations } from "./data/progress";
import { activities } from "./data/activities";
import { SEED_VERSION } from "./data/seedVersion";
import type { Child, Entry, Goal, LessonRecord, Lang, ModalKind, Observation, Plan, ProfileInfo, Screen } from "./types";
import alexPhoto from "./assets/profile/alex.svg";

type ChildFilters = { age: string; group: string; recent: string; sort: string };

// Refreshes seed-owned items (matched by id) to the bundled seed while keeping everything the parent added.
function refreshSeed<T extends { id: string }>(current: T[], seed: T[]): T[] {
  return [...seed, ...current.filter(x => !seed.some(s => s.id === x.id))];
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("children");
  const [previous, setPrevious] = useState<Screen>("children");
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedChild, setSelectedChild] = useState("emma");
  const [selectedActivity, setSelectedActivity] = useState("water-pouring");
  const [childTab, setChildTab] = useState("Journal");
  // Entry being viewed/edited; undefined in the editor means "new entry".
  const [selectedEntry, setSelectedEntry] = useState<string | undefined>();
  // Where the current entry flow started, so detail/editor return there ("child" = that child's Journal).
  const [entryOrigin, setEntryOrigin] = useState<"moments" | "child">("moments");
  // Child preselected for a new entry.
  const [editorChild, setEditorChild] = useState<string | undefined>();
  const [momentsFilter, setMomentsFilter] = useState("All");
  const [toast, setToast] = useState("");

  const [childrenData, setChildrenData] = useStored<Child[]>("rootmap-children", initialChildren);
  const [records, setRecords] = useStored<LessonRecord[]>("rootmap-records", initialRecords);
  const [observations, setObservations] = useStored<Observation[]>("rootmap-observations", initialObservations);
  const [seedVersion, setSeedVersion] = useStored<number>("rootmap-seed-version", 0);
  const [profile, setProfile] = useStored<ProfileInfo>("rootmap-profile", { name: "Alex Hao", photo: alexPhoto, contact: "" });
  const [saved, setSaved] = useStored<string[]>("rootmap-saved", ["water-pouring", "dotting"]);
  const [plans, setPlans] = useStored<Plan[]>("rootmap-plans", []);
  // Moments/Journal entries (per child) and goals (per parent) use their own keys, so seed-version resets never touch them.
  const [entries, setEntries] = useStored<Entry[]>(ENTRIES_KEY, []);
  const [migrated, setMigrated] = useStored<string[]>(MIGRATED_KEY, []);
  const [goals, setGoals] = useStored<Goal[]>("rootmap-goals", []);
  const [lang, setLang] = useStored<Lang>("rootmap-language", "en");
  const [appearance, setAppearance] = useStored<string>("rootmap-appearance", "light");
  const [view, setView] = useStored<string>("rootmap-child-view", "grid");
  const [filters, setFilters] = useStored<ChildFilters>("rootmap-child-filters", { age: "All Ages", group: "All Groups", recent: "Any Time", sort: "Name A–Z" });
  const [weekFilter, setWeekFilter] = useState("all");

  // When the bundled seed data changes (SEED_VERSION bumped), refresh the seed children/lessons/observations
  // so every device picks up the update, without dropping anything the parent created or renamed.
  useEffect(() => {
    if (seedVersion >= SEED_VERSION) return;
    setChildrenData(current => refreshSeed(current, initialChildren).map(c => {
      const mine = current.find(x => x.id === c.id);
      return mine ? { ...c, first: mine.first, last: mine.last, notes: mine.notes } : c;
    }));
    setRecords(current => refreshSeed(current, initialRecords));
    setObservations(current => refreshSeed(current, initialObservations));
    setProfile({ name: "Alex Hao", photo: alexPhoto, contact: "" });
    // Drop any saved-activity ids that no longer exist, which previously caused a white-screen crash.
    setSaved(current => current.filter(id => activities.some(a => a.id === id)));
    setSeedVersion(SEED_VERSION);
  }, [seedVersion, setChildrenData, setRecords, setObservations, setProfile, setSaved, setSeedVersion]);

  const t = copy[lang];
  const child = childrenData.find(c => c.id === selectedChild) || childrenData[0];
  const activity = activities.find(a => a.id === selectedActivity) || activities[0];
  const entry = entries.find(e => e.id === selectedEntry);

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
  const originScreen: Screen = entryOrigin === "child" ? "child" : "observations";
  const openEntry = (id: string, origin: "moments" | "child") => { setSelectedEntry(id); setEntryOrigin(origin); go("entry"); };
  const startEntry = (origin: "moments" | "child", childId?: string) => {
    if (!childrenData.length) { setModal("addChild"); return; }
    setSelectedEntry(undefined);
    setEntryOrigin(origin);
    setEditorChild(childId);
    go("entryEdit");
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
    if (screen === "profile") return <ProfilePage go={go} lang={lang} appearance={appearance} profile={profile} t={t} />;
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
            if (!window.confirm(t.confirmDeleteChild.replace("{name}", `${child.first} ${child.last}`))) return;
            setChildrenData(childrenData.filter(c => c.id !== child.id));
            go("children");
          }}
          back={() => go("children")}
          record={() => go("record")}
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
            const item = { ...r, id: `r-${Date.now()}`, childId: child.id };
            // Activity notes stay on the activity record (Activities tab); memories are recorded through Moments.
            setRecords([item, ...records]);
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
          key={`${entryOrigin}:${entry?.id || "new"}:${editorChild || ""}`}
          childrenData={childrenData}
          childId={entry?.childId || (editorChild && childrenData.some(c => c.id === editorChild) ? editorChild : childrenData[0]?.id || "")}
          lockChild={entryOrigin === "child"}
          entry={entry}
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
              if (!storeEntries([{ id: `m-${Date.now()}`, ...fields, createdAt: now, updatedAt: now }, ...entries])) return false;
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
    if (screen === "notifications") {
      return <NotificationsPage childrenData={childrenData} back={() => go("children")} goChild={goChild} t={t} />;
    }
    return <SettingsPage screen={screen} back={() => go(screen === "notes" && previous === "goals" ? "goals" : "profile")} lang={lang} setLang={setLang} appearance={appearance} setAppearance={setAppearance} profile={profile} setProfile={setProfile} t={t} />;
  };

  return (
    <div className="app-shell">
      <Shell active={screen} go={go} openQuick={() => setModal("quick")} t={t} nav={topLevel}>
        {content()}
      </Shell>
      <ModalOverlay
        modal={modal}
        close={closeModal}
        childrenData={childrenData}
        setChildrenData={setChildrenData}
        filters={filters}
        setFilters={setFilters}
        selectedActivity={activity}
        plans={plans}
        setPlans={setPlans}
        selectedChild={selectedChild}
        t={t}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
