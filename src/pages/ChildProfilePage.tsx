import { useState } from "react";
import { Icon } from "../components/Icon";
import { TreeLogo } from "../components/TreeLogo";
import { initialRecords } from "../data/progress";
import { fmt } from "../lib/dates";
import type { Child, LessonRecord, Observation } from "../types";
import { childAge, childEnrolled, childTabLabel, groupOptionLabel, lessonLabel, noteText, recordAreaLabel, skillLabel, type Copy } from "../lib/i18n";

// Fallback area stats (lessons/introduced/practicing/independent) layered under any lessons the user adds.
const baseStats: Record<string, [number, number, number, number]> = {
  "Practical Life": [12, 5, 5, 2],
  Sensorial: [8, 3, 4, 1],
  Language: [6, 4, 2, 0],
  Mathematics: [4, 2, 2, 0],
};

export function ChildProfilePage({ child, records, observations, edit, back, record, remove, t }: {
  child: Child;
  records: LessonRecord[];
  observations: Observation[];
  edit: () => void;
  back: () => void;
  record: () => void;
  remove: () => void;
  t: Copy;
}) {
  const [tab, setTab] = useState("Overview");
  const lessons = records.filter(r => r.childId === child.id).sort((a, b) => b.date.localeCompare(a.date));
  const obs = observations.filter(o => o.childId === child.id);
  return (
    <main className="child-profile">
      <header className="child-header">
        <button onClick={back}><Icon name="back" size={18} /> {t.classroom}</button>
        <TreeLogo />
        <div className="child-header-actions">
          <button onClick={edit}>{t.edit}</button>
          <button onClick={remove}><Icon name="trash" size={18} /></button>
        </div>
      </header>
      <section className="profile-hero">
        <img src={child.photo} alt="" />
        <h1>{child.first} {child.last}</h1>
        <p>{childAge(child, t)}</p>
        <small>{t.enrolledSince} {childEnrolled(child, t)} · {groupOptionLabel(child.group, t)}</small>
      </section>
      <div className="tabs">
        {["Overview", "Lessons", "Observations", "Notes"].map(x => (
          <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{childTabLabel(x, t)}</button>
        ))}
      </div>
      <div className="child-body">
        {tab === "Overview" && (
          <>
            <div className="section-title"><h2>{t.learningAreas}</h2></div>
            <div className="learning-grid">
              {Object.entries(baseStats).map(([area, s], i) => {
                const added = lessons.filter(r => r.area === area && !initialRecords.find(x => x.id === r.id));
                return (
                  <article className={`learning-card tone-${i}`} key={area}>
                    <i><Icon name={i === 0 ? "heart" : i === 1 ? "compass" : i === 2 ? "book" : "layers"} /></i>
                    <strong>{recordAreaLabel(area, t)}</strong>
                    <small>{s[0] + added.length} {t.lessonsWord}</small>
                    <div>
                      <span><b>{s[1] + added.filter(x => x.stage === "Introduced").length}</b>{t.introduced}</span>
                      <span><b>{s[2] + added.filter(x => x.stage === "Practicing").length}</b>{t.practicing}</span>
                      <span><b>{s[3] + added.filter(x => x.stage === "Independent").length}</b>{t.independent}</span>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="section-title"><h2>{t.recentLessons}</h2></div>
            <LessonList records={lessons.slice(0, 3)} t={t} />
          </>
        )}
        {tab === "Lessons" && (
          <>
            <div className="section-title"><h2>{t.lessonHistory}</h2></div>
            <LessonList records={lessons} t={t} />
          </>
        )}
        {tab === "Observations" && (
          <div className="observation-feed">
            {obs.map(o => (
              <article className="observation-card" key={o.id}>
                <small>{fmt(o.date)}</small>
                <p>{noteText(o.notes, o.notesZh, t)}</p>
                <div className="skill-tags">{o.skills.map(s => <span key={s}>{skillLabel(s, t)}</span>)}</div>
              </article>
            ))}
          </div>
        )}
        {tab === "Notes" && <div className="personal-note">{child.notes || t.noGeneralNotes}</div>}
        <button className="wide-primary" onClick={record}><Icon name="plus" size={18} />{t.recordLesson} / {t.addObservation}</button>
      </div>
    </main>
  );
}

function LessonList({ records, t }: { records: LessonRecord[]; t: Copy }) {
  return (
    <div className="lesson-list">
      {records.map(r => {
        const notes = noteText(r.notes, r.notesZh, t);
        return (
          <button key={r.id} onClick={() => window.alert(`${lessonLabel(r.lesson, t)}\n${recordAreaLabel(r.area, t)} · ${t[r.stage.toLowerCase() as "introduced" | "practicing" | "independent"]}\n${fmt(r.date)}${notes ? `\n\n${notes}` : ""}`)}>
            <i><Icon name="book" size={18} /></i>
            <span><strong>{lessonLabel(r.lesson, t)}</strong><small>{recordAreaLabel(r.area, t)} · {fmt(r.date)}</small></span>
            <b className={`status ${r.stage.toLowerCase()}`}>{t[r.stage.toLowerCase() as "introduced" | "practicing" | "independent"]}</b>
            <Icon name="chevron" size={15} />
          </button>
        );
      })}
    </div>
  );
}
