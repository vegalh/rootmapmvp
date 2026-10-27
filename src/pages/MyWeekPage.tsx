import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, Empty, FilterPill } from "../components/ui";
import CollectionCard from "../components/CollectionCard";
import type { Collection } from "../data/collections";
import { collectionImages } from "../lib/collections";
import { ACTIVITY_SETTINGS, MATERIAL_TYPES, TIME_BANDS, findActivity, matchesMaterials, matchesSetting, matchesTime } from "../lib/catalog";
import { childOptionLabel, childShortName } from "../lib/children";
import { fmt, fmtWeekday } from "../lib/dates";
import type { Activity, Child, Plan } from "../types";
import { categoryOptionLabel, localizeActivity, materialsOptionLabel, settingOptionLabel, timeOptionLabel, type Copy } from "../lib/i18n";

export type WeekTab = "saved" | "plan" | "completed";

export function MyWeekPage({ tab, setTab, saved, savedCollections, openCollection, plans, setPlans, completePlan, repeatPlan, childFilter, setChildFilter, childrenData, openActivity, openAdd, back, t }: {
  // Kept by App, so coming back from an activity or a collection returns to the same tab.
  tab: WeekTab;
  setTab: (tab: WeekTab) => void;
  saved: string[];
  // Saved collections that are shown now (in season, see lib/collections.ts).
  savedCollections: Collection[];
  openCollection: (id: string) => void;
  plans: Plan[];
  setPlans: React.Dispatch<React.SetStateAction<Plan[]>>;
  // Marks a plan done and adds the activity to each planned child's history (App, through the shared recorder).
  completePlan: (plan: Plan) => void;
  // Plans a completed activity again for today.
  repeatPlan: (plan: Plan) => void;
  childFilter: string;
  setChildFilter: (s: string) => void;
  childrenData: Child[];
  openActivity: (id: string) => void;
  openAdd: () => void;
  back: () => void;
  t: Copy;
}) {
  const shownPlans = plans.filter(p => childFilter === "all" || p.childIds.includes(childFilter));
  const planned = shownPlans.filter(p => !p.completed).sort((a, b) => a.date.localeCompare(b.date));
  const complete = shownPlans.filter(p => p.completed);
  const lang = t.code === "zh" ? "zh" : "en";
  // Names of the plan's children still in My Children (a removed child's name is not shown).
  const names = (p: Plan) => p.childIds.map(id => childrenData.find(c => c.id === id)).filter((c): c is Child => !!c).map(c => childShortName(c, childrenData)).join(lang === "zh" ? "、" : ", ");
  return (
    <main className="week-page">
      <PageHeader title={t.myWeek} subtitle={t.weekSubtitle} back={back} action={<button className="round-add" onClick={openAdd} aria-label={t.add}><Icon name="plus" /></button>} />
      <div className="week-controls">
        <label>
          <span>{t.selectChildren}</span>
          <select value={childFilter} onChange={e => setChildFilter(e.target.value)}>
            <option value="all">{t.allChildren}</option>
            {childrenData.map(c => <option value={c.id} key={c.id}>{childOptionLabel(c, childrenData, t)}</option>)}
          </select>
        </label>
        <div className="segmented">
          {([["saved", t.saved], ["plan", t.weeklyPlan], ["completed", t.completed]] as const).map(([x, l]) => (
            <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{l}</button>
          ))}
        </div>
      </div>
      <div className="week-list">
        {tab === "saved" && <SavedList saved={saved} savedCollections={savedCollections} openCollection={openCollection} openActivity={openActivity} t={t} />}
        {tab === "plan" && (
          <>
            {planned.map(p => {
              const a = findActivity(p.activityId);
              if (!a) return null;
              return (
                <article className="day-plan" key={p.id}>
                  <time dateTime={p.date}><b>{fmtWeekday(p.date, lang)}</b>{Number(p.date.slice(8, 10))}</time>
                  <ActivityRow
                    a={a}
                    t={t}
                    subtitle={names(p) || t.noChildAssigned}
                    action={<div className="plan-actions">
                      <button onClick={() => completePlan(p)} aria-label={t.markDoneLabel.replace("{title}", localizeActivity(a, t).title)}><Icon name="check" size={16} /></button>
                      <button onClick={() => setPlans(x => x.filter(y => y.id !== p.id))} aria-label={t.removePlanLabel.replace("{title}", localizeActivity(a, t).title)}>×</button>
                    </div>}
                  />
                </article>
              );
            })}
            {!planned.length && <Empty text={t.noActivitiesPlanned} />}
          </>
        )}
        {tab === "completed" && (
          <>
            {complete.map(p => {
              const a = findActivity(p.activityId);
              if (!a) return null;
              return (
                <ActivityRow
                  a={a}
                  t={t}
                  subtitle={`${names(p) || t.unassigned} · ${fmt(p.completedDate || p.date, lang)}`}
                  action={<button onClick={() => repeatPlan(p)}>{t.repeat}</button>}
                  key={p.id}
                />
              );
            })}
            {!complete.length && <Empty text={t.completedActivitiesEmpty} />}
          </>
        )}
      </div>
    </main>
  );
}

type OpenFilter = "setting" | "materials" | "time" | null;

// Saved: the family's saved collections, then their saved activities with Discover's Setting and Materials filters
// plus Time. A filter only offers options some saved activity has.
function SavedList({ saved, savedCollections, openCollection, openActivity, t }: { saved: string[]; savedCollections: Collection[]; openCollection: (id: string) => void; openActivity: (id: string) => void; t: Copy }) {
  const [setting, setSetting] = useState("All");
  const [materials, setMaterials] = useState("All");
  const [time, setTime] = useState("All");
  const [openFilter, setOpenFilter] = useState<OpenFilter>(null);
  const activities = saved.map(findActivity).filter((a): a is Activity => !!a);
  const settingOptions = ["All", ...ACTIVITY_SETTINGS.filter(x => activities.some(a => matchesSetting(a, x)))];
  const materialsOptions = ["All", ...MATERIAL_TYPES.filter(x => activities.some(a => matchesMaterials(a, x)))];
  const timeOptions = ["All", ...TIME_BANDS.filter(x => activities.some(a => matchesTime(a, x)))];
  const shown = activities.filter(a => matchesSetting(a, setting) && matchesMaterials(a, materials) && matchesTime(a, time));
  const filtered = setting !== "All" || materials !== "All" || time !== "All";
  const clear = () => { setSetting("All"); setMaterials("All"); setTime("All"); };
  const pictures = collectionImages(savedCollections);
  const pill = (key: Exclude<OpenFilter, null>) => ({ isOpen: openFilter === key, onOpenChange: (o: boolean) => setOpenFilter(o ? key : null) });
  return (
    <>
      {savedCollections.length > 0 && (
        <section className="collection-strip" aria-label={t.myCollections}>
          <h2>{t.myCollections}</h2>
          <div className="collection-row">
            {savedCollections.map(c => <CollectionCard collection={c} image={pictures.get(c.id)} open={openCollection} t={t} key={c.id} />)}
          </div>
        </section>
      )}
      {activities.length > 0 && (
        <div className="filter-row saved-filters">
          {settingOptions.length > 1 && <FilterPill label={t.setting} value={setting} defaultValue="All" onChange={setSetting} options={settingOptions} renderLabel={v => settingOptionLabel(v, t)} columns={2} {...pill("setting")} />}
          {materialsOptions.length > 1 && <FilterPill label={t.materialsFilter} value={materials} defaultValue="All" onChange={setMaterials} options={materialsOptions} renderLabel={v => materialsOptionLabel(v, t)} columns={1} {...pill("materials")} />}
          {timeOptions.length > 1 && <FilterPill label={t.timeFilter} value={time} defaultValue="All" onChange={setTime} options={timeOptions} renderLabel={v => timeOptionLabel(v, t)} columns={1} align="right" {...pill("time")} />}
        </div>
      )}
      {shown.map(a => <ActivityRow a={a} t={t} action={<button onClick={() => openActivity(a.id)} aria-label={localizeActivity(a, t).title}><Icon name="chevron" /></button>} key={a.id} />)}
      {filtered && !shown.length && (
        <Empty text={t.noMatchingActivities}>
          <button className="reset-link" onClick={clear}>{t.clearFilters}</button>
        </Empty>
      )}
      {/* Nothing saved at all yet (no collections, no activities): unlike Weekly Plan and Completed, this tab had no
          message of its own and looked like a loading or broken page. */}
      {!savedCollections.length && !activities.length && <Empty text={t.noSavedActivities} />}
    </>
  );
}

export function ActivityRow({ a: rawActivity, subtitle, action, t }: { a: Activity; subtitle?: string; action: React.ReactNode; t: Copy }) {
  const a = localizeActivity(rawActivity, t);
  return (
    <div className="activity-row">
      <img src={a.image} alt="" />
      <span><strong>{a.title}</strong><small>{subtitle || `${a.age} · ${categoryOptionLabel(a.category, t)}`}</small><em><Icon name="clock" size={12} />{a.minutes} {t.min} · {a.materialsLabel}</em></span>
      {action}
    </div>
  );
}
