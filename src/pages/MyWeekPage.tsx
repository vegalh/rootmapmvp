import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, Empty } from "../components/ui";
import { activities } from "../data/activities";
import { newRecordId } from "../lib/data/schema";
import { fmt, isoToday } from "../lib/dates";
import type { Activity, Child, Plan } from "../types";
import { discoverCategoryLabel, localizeActivity, type Copy } from "../lib/i18n";

export function MyWeekPage({ saved, plans, setPlans, childFilter, setChildFilter, childrenData, openActivity, openAdd, back, t }: {
  saved: string[];
  plans: Plan[];
  setPlans: React.Dispatch<React.SetStateAction<Plan[]>>;
  childFilter: string;
  setChildFilter: (s: string) => void;
  childrenData: Child[];
  openActivity: (id: string) => void;
  openAdd: () => void;
  back: () => void;
  t: Copy;
}) {
  const [tab, setTab] = useState<"saved" | "plan" | "completed">("plan");
  const shownPlans = plans.filter(p => childFilter === "all" || p.childIds.includes(childFilter));
  const planned = shownPlans.filter(p => !p.completed).sort((a, b) => a.date.localeCompare(b.date));
  const complete = shownPlans.filter(p => p.completed);
  const mark = (id: string) => setPlans(current => current.map(p => (p.id === id ? { ...p, completed: true, completedDate: isoToday() } : p)));
  return (
    <main className="week-page">
      <PageHeader title={t.myWeek} subtitle={t.weekSubtitle} back={back} action={<button className="round-add" onClick={openAdd}><Icon name="plus" /></button>} />
      <div className="week-controls">
        <label>
          <span>{t.selectChildren}</span>
          <select value={childFilter} onChange={e => setChildFilter(e.target.value)}>
            <option value="all">{t.allChildren}</option>
            {childrenData.map(c => <option value={c.id} key={c.id}>{c.first}</option>)}
          </select>
        </label>
        <div className="segmented">
          {([["saved", t.saved], ["plan", t.weeklyPlan], ["completed", t.completed]] as const).map(([x, l]) => (
            <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{l}</button>
          ))}
        </div>
      </div>
      <div className="week-list">
        {tab === "saved" && saved.map(id => {
          const a = activities.find(x => x.id === id);
          if (!a) return null;
          return <ActivityRow a={a} t={t} action={<button onClick={() => openActivity(a.id)}><Icon name="chevron" /></button>} key={id} />;
        })}
        {tab === "plan" && (
          <>
            {planned.map(p => {
              const a = activities.find(x => x.id === p.activityId);
              if (!a) return null;
              return (
                <article className="day-plan" key={p.id}>
                  <time><b>{new Date(`${p.date}T12:00`).toLocaleDateString("en-US", { weekday: "short" })}</b>{new Date(`${p.date}T12:00`).getDate()}</time>
                  <ActivityRow
                    a={a}
                    t={t}
                    subtitle={p.childIds.length ? p.childIds.map(id => childrenData.find(c => c.id === id)?.first).join(", ") : t.noChildAssigned}
                    action={<div className="plan-actions"><button onClick={() => mark(p.id)}><Icon name="check" size={16} /></button><button onClick={() => setPlans(x => x.filter(y => y.id !== p.id))}>×</button></div>}
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
              const a = activities.find(x => x.id === p.activityId);
              if (!a) return null;
              return (
                <ActivityRow
                  a={a}
                  t={t}
                  subtitle={`${p.childIds.map(id => childrenData.find(c => c.id === id)?.first).join(", ") || t.unassigned} · ${fmt(p.completedDate || p.date)}`}
                  action={<button onClick={() => setPlans(x => [...x, { ...p, id: newRecordId("p"), date: isoToday(), completed: false }])}>{t.repeat}</button>}
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

export function ActivityRow({ a: rawActivity, subtitle, action, t }: { a: Activity; subtitle?: string; action: React.ReactNode; t: Copy }) {
  const a = localizeActivity(rawActivity, t);
  return (
    <div className="activity-row">
      <img src={a.image} alt="" />
      <span><strong>{a.title}</strong><small>{subtitle || `${a.age} · ${discoverCategoryLabel(a.area, t)}`}</small><em><Icon name="clock" size={12} />{a.minutes} {t.min} · {a.materialsLabel}</em></span>
      {action}
    </div>
  );
}
