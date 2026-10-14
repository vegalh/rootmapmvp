import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, Empty } from "../components/ui";
import { findActivity } from "../lib/catalog";
import { childOptionLabel, childShortName } from "../lib/children";
import { fmt, fmtWeekday } from "../lib/dates";
import type { Activity, Child, Plan } from "../types";
import { discoverCategoryLabel, localizeActivity, type Copy } from "../lib/i18n";

export function MyWeekPage({ saved, plans, setPlans, completePlan, repeatPlan, childFilter, setChildFilter, childrenData, openActivity, openAdd, back, t }: {
  saved: string[];
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
  const [tab, setTab] = useState<"saved" | "plan" | "completed">("plan");
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
        {tab === "saved" && saved.map(id => {
          const a = findActivity(id);
          if (!a) return null;
          return <ActivityRow a={a} t={t} action={<button onClick={() => openActivity(a.id)} aria-label={localizeActivity(a, t).title}><Icon name="chevron" /></button>} key={id} />;
        })}
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
