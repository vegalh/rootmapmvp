import { useEffect, useState } from "react";
import { Shell, PageHeader } from "./components/ui";
import { ModalOverlay } from "./components/ModalOverlay";
import { Icon } from "./components/Icon";
import { ChildrenPage } from "./pages/ChildrenPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { ActivityDetailPage } from "./pages/ActivityDetailPage";
import { ObservationsPage } from "./pages/ObservationsPage";
import { ChildProfilePage } from "./pages/ChildProfilePage";
import { ProfilePage } from "./pages/ProfilePage";
import { MyWeekPage, ActivityRow } from "./pages/MyWeekPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { RecordFormPage } from "./pages/RecordFormPage";
import { useStored } from "./lib/storage";
import { copy } from "./lib/i18n";
import { initialChildren } from "./data/children";
import { initialRecords, initialObservations } from "./data/progress";
import { activities } from "./data/activities";
import { SEED_VERSION } from "./data/seedVersion";
import type { Child, LessonRecord, Lang, ModalKind, Observation, Plan, ProfileInfo, Screen } from "./types";
import haoweiPhoto from "./assets/profile/haowei.jpg";

type ChildFilters = { age: string; group: string; recent: string; sort: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>("children");
  const [previous, setPrevious] = useState<Screen>("children");
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedChild, setSelectedChild] = useState("emma");
  const [selectedActivity, setSelectedActivity] = useState("water-pouring");

  const [childrenData, setChildrenData] = useStored<Child[]>("rootmap-children", initialChildren);
  const [records, setRecords] = useStored<LessonRecord[]>("rootmap-records", initialRecords);
  const [observations, setObservations] = useStored<Observation[]>("rootmap-observations", initialObservations);
  const [seedVersion, setSeedVersion] = useStored<number>("rootmap-seed-version", 0);
  const [profile, setProfile] = useStored<ProfileInfo>("rootmap-profile", { name: "HaoWei", photo: haoweiPhoto, contact: "" });
  const [saved, setSaved] = useStored<string[]>("rootmap-saved", ["water-pouring", "dotting"]);
  const [plans, setPlans] = useStored<Plan[]>("rootmap-plans", []);
  const [lang, setLang] = useStored<Lang>("rootmap-language", "zh");
  const [appearance, setAppearance] = useStored<string>("rootmap-appearance", "light");
  const [view, setView] = useStored<string>("rootmap-child-view", "grid");
  const [filters, setFilters] = useStored<ChildFilters>("rootmap-child-filters", { age: "All Ages", group: "All Groups", recent: "Any Time", sort: "Name A–Z" });
  const [weekFilter, setWeekFilter] = useState("all");

  // When the bundled seed data changes (SEED_VERSION bumped), reset saved children/lessons/observations
  // to the new seed so every device picks up the update instead of keeping its old cached copy.
  useEffect(() => {
    if (seedVersion >= SEED_VERSION) return;
    setChildrenData(initialChildren);
    setRecords(initialRecords);
    setObservations(initialObservations);
    // Drop any saved-activity ids that no longer exist, which previously caused a white-screen crash.
    setSaved(current => current.filter(id => activities.some(a => a.id === id)));
    setSeedVersion(SEED_VERSION);
  }, [seedVersion, setChildrenData, setRecords, setObservations, setSaved, setSeedVersion]);

  const t = copy[lang];
  const child = childrenData.find(c => c.id === selectedChild) || childrenData[0];
  const activity = activities.find(a => a.id === selectedActivity) || activities[0];

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

  const closeModal = (destination?: Screen | ModalKind) => {
    setModal(null);
    if (destination === "record") go("record");
    else if (destination === "observation") setModal("observation");
    else if (destination === "addChild") setModal("addChild");
    else if (destination && destination !== "quick" && destination !== "filters" && destination !== "plan" && destination !== "weekAdd") go(destination as Screen);
  };

  const content = () => {
    if (screen === "children") {
      return (
        <ChildrenPage
          childrenData={childrenData}
          records={records}
          observations={observations}
          goChild={id => { setSelectedChild(id); go("child"); }}
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
      return <ObservationsPage observations={observations} childrenData={childrenData} openForm={() => setModal("observation")} goChild={id => { setSelectedChild(id); go("child"); }} t={t} />;
    }
    if (screen === "profile") return <ProfilePage go={go} lang={lang} appearance={appearance} profile={profile} t={t} />;
    if (screen === "child") {
      return (
        <ChildProfilePage
          child={child}
          records={records}
          observations={observations}
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
            setRecords([item, ...records]);
            setObservations([{ id: `o-${Date.now()}`, childId: child.id, date: r.date, notes: r.notes || "", area: r.area, lesson: r.lesson, skills: r.skills || [], nextSteps: r.nextSteps }, ...observations]);
            go("child");
          }}
        />
      );
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
      return <NotificationsPage childrenData={childrenData} back={() => go("children")} goChild={id => { setSelectedChild(id); go("child"); }} t={t} />;
    }
    return <SettingsPage screen={screen} back={() => go("profile")} lang={lang} setLang={setLang} appearance={appearance} setAppearance={setAppearance} profile={profile} setProfile={setProfile} t={t} />;
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
        saveObservation={(o: Observation) => setObservations([o, ...observations])}
        t={t}
      />
    </div>
  );
}
