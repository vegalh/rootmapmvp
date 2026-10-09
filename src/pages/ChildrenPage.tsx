import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { TreeLogo } from "../components/TreeLogo";
import { Empty } from "../components/ui";
import { initialRecords } from "../data/progress";
import { fmt } from "../lib/dates";
import type { Child, LessonRecord, Observation } from "../types";
import { childAge, childShortAge, lessonLabel, noteText, type Copy } from "../lib/i18n";

type ChildFilters = { age: string; group: string; recent: string; sort: string };

export function ChildrenPage({ childrenData, records, observations, goChild, openFilters, openNotifications, view, setView, filters, t }: {
  childrenData: Child[];
  records: LessonRecord[];
  observations: Observation[];
  goChild: (id: string) => void;
  openFilters: () => void;
  openNotifications: () => void;
  view: string;
  setView: (v: string) => void;
  filters: ChildFilters;
  t: Copy;
}) {
  const [query, setQuery] = useState("");
  const result = useMemo(() => {
    let list = childrenData.filter(c => `${c.first} ${c.last}`.toLowerCase().includes(query.toLowerCase()));
    if (filters.age === "0–3 Years") list = list.filter(c => c.ageYears < 3);
    if (filters.age === "3–6 Years") list = list.filter(c => c.ageYears >= 3 && c.ageYears < 6);
    if (filters.age === "6+ Years") list = list.filter(c => c.ageYears >= 6);
    if (filters.group !== "All Groups") list = list.filter(c => c.group === filters.group);
    if (filters.recent !== "Any Time") {
      const latestDate = observations.reduce((max, o) => (o.date > max ? o.date : max), "");
      const days = filters.recent === "Today" ? 0 : filters.recent === "This Week" ? 7 : 31;
      const cutoff = new Date(`${latestDate}T12:00:00`);
      cutoff.setDate(cutoff.getDate() - days);
      list = list.filter(c => {
        const recent = observations.filter(o => o.childId === c.id).sort((a, b) => b.date.localeCompare(a.date))[0];
        return recent && new Date(`${recent.date}T12:00:00`) >= cutoff;
      });
    }
    return [...list].sort((a, b) =>
      filters.sort === "Name Z–A" ? b.first.localeCompare(a.first) :
      filters.sort === "Age" ? a.ageYears - b.ageYears :
      filters.sort === "Most Recently Observed" ? (observations.find(o => o.childId === b.id)?.date || "").localeCompare(observations.find(o => o.childId === a.id)?.date || "") :
      a.first.localeCompare(b.first)
    );
  }, [childrenData, observations, query, filters]);

  const latest = (id: string) => observations.filter(o => o.childId === id).sort((a, b) => b.date.localeCompare(a.date))[0];

  return (
    <>
      <header className="brand-header">
        <TreeLogo />
        <button className="bell-button" onClick={openNotifications}><Icon name="bell" /><i /></button>
      </header>
      <main className="page-content children-page">
        <div className="hero-title"><h1>{t.myChildren}</h1><p>{t.childSubtitle}</p></div>
        <div className="search-row">
          <label className="search"><Icon name="search" size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={`${t.search}…`} /></label>
          <button className="square-primary" onClick={openFilters}><Icon name="filter" /></button>
        </div>
        <div className="section-line">
          <span>{result.length} {t.childrenWord}</span>
          <div className="view-toggle">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Icon name="grid" size={16} /></button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><Icon name="list" size={17} /></button>
          </div>
        </div>
        {view === "grid" ? (
          <div className="children-grid">
            {result.map(c => (
              <button className="child-card" onClick={() => goChild(c.id)} key={c.id}>
                <img src={c.photo} alt="" /><i />
                <strong>{c.first}</strong><span>{childShortAge(c, t)}</span>
                <small>{c.lessons + records.filter(r => r.childId === c.id && !initialRecords.some(x => x.id === r.id)).length} {t.lessonsWord}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="children-list">
            {result.map(c => (
              <button className="child-list-card" onClick={() => goChild(c.id)} key={c.id}>
                <img src={c.photo} alt="" />
                <div><strong>{c.first} {c.last}</strong><span>{childAge(c, t)} · {c.lessons} {t.lessonsWord}</span><small>{noteText(latest(c.id)?.notes, latest(c.id)?.notesZh, t) || t.noRecentObservation}</small></div>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        )}
        {!result.length && <Empty text={t.noResults} />}
        {!!result.length && (
          <>
            <div className="section-title recent-title"><h2>{t.recentActivityLabel}</h2></div>
            <div className="recent-activity">
              {observations.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map(o => {
                const c = childrenData.find(x => x.id === o.childId);
                if (!c) return null;
                return (
                  <button onClick={() => goChild(c.id)} key={o.id}>
                    <img src={c.photo} alt="" />
                    <span><strong>{c.first} {c.last}</strong><small>{o.lesson ? lessonLabel(o.lesson, t) : t.independentObservation} · {fmt(o.date)}</small><p>{noteText(o.notes, o.notesZh, t)}</p></span>
                    <Icon name="chevron" size={16} />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>
    </>
  );
}
