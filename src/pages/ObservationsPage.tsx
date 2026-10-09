import { useState } from "react";
import { PageHeader, FilterSelect, Empty } from "../components/ui";
import { Icon } from "../components/Icon";
import { fmt } from "../lib/dates";
import type { Child, Observation } from "../types";
import { lessonLabel, noteText, recordAreaLabel, skillLabel, type Copy } from "../lib/i18n";

export function ObservationsPage({ observations, childrenData, openForm, goChild, t }: {
  observations: Observation[];
  childrenData: Child[];
  openForm: () => void;
  goChild: (id: string) => void;
  t: Copy;
}) {
  const [child, setChild] = useState("All");
  const [area, setArea] = useState("All");
  const list = observations
    .filter(o => (child === "All" || o.childId === child) && (area === "All" || o.area === area))
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <main className="page-content observations-page">
      <PageHeader title={t.observations} subtitle={t.observationSubtitle} action={<button className="small-primary" onClick={openForm}><Icon name="plus" size={16} />{t.addObservation}</button>} />
      <div className="observation-filters">
        <FilterSelect
          label=""
          value={child}
          onChange={setChild}
          options={["All", ...childrenData.map(c => c.id)]}
          renderLabel={v => (v === "All" ? t.all : `${childrenData.find(c => c.id === v)?.first} ${childrenData.find(c => c.id === v)?.last}`)}
        />
        <FilterSelect
          label=""
          value={area}
          onChange={setArea}
          options={["All", "Practical Life", "Sensorial", "Language", "Mathematics", "Independent"]}
          renderLabel={v => (v === "All" ? t.all : recordAreaLabel(v, t))}
        />
      </div>
      <div className="observation-feed">
        {list.map(o => {
          const c = childrenData.find(x => x.id === o.childId)!;
          return (
            <article className="observation-card" key={o.id}>
              <button className="observation-person" onClick={() => goChild(c.id)}>
                <img src={c.photo} alt="" /><span><strong>{c.first} {c.last}</strong><small>{fmt(o.date)}</small></span><Icon name="chevron" size={16} />
              </button>
              <p>{noteText(o.notes, o.notesZh, t)}</p>
              {o.lesson && <span className="lesson-tag">{o.area ? recordAreaLabel(o.area, t) : ""} · {lessonLabel(o.lesson, t)}</span>}
              <div className="skill-tags">{o.skills.map(s => <span key={s}>{skillLabel(s, t)}</span>)}</div>
              {o.nextSteps && <footer><strong>{t.followUpWord}</strong>{noteText(o.nextSteps, o.nextStepsZh, t)}</footer>}
            </article>
          );
        })}
      </div>
      {!list.length && <Empty text={t.noResults} />}
    </main>
  );
}
