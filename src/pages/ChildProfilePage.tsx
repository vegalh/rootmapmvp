import { Icon } from "../components/Icon";
import { JournalTimeline } from "../components/JournalTimeline";
import { TreeLogo } from "../components/TreeLogo";
import { Empty } from "../components/ui";
import { fmt } from "../lib/dates";
import type { Child, JournalEntry, Lang, LessonRecord, Observation } from "../types";
import { childAge, childTabLabel, groupOptionLabel, lessonLabel, noteText, recordAreaLabel, skillLabel, type Copy } from "../lib/i18n";

export function ChildProfilePage({ child, records, observations, journal, tab, setTab, lang, openEntry, writeEntry, importNotes, edit, back, record, remove, t }: {
  child: Child;
  records: LessonRecord[];
  observations: Observation[];
  journal: JournalEntry[];
  // Active tab is owned by App so returning from a journal entry lands back on the Journal tab.
  tab: string;
  setTab: (tab: string) => void;
  lang: Lang;
  openEntry: (id: string) => void;
  writeEntry: () => void;
  importNotes: () => void;
  edit: () => void;
  back: () => void;
  record: () => void;
  remove: () => void;
  t: Copy;
}) {
  const lessons = records.filter(r => r.childId === child.id).sort((a, b) => b.date.localeCompare(a.date));
  const obs = observations.filter(o => o.childId === child.id);
  return (
    <main className="child-profile">
      <header className="child-header">
        <button onClick={back}><Icon name="back" size={18} /> {t.backToChildren}</button>
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
        <small>{groupOptionLabel(child.group, t)}</small>
      </section>
      <div className="tabs">
        {["Moments", "Activities", "Journal"].map(x => (
          <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{childTabLabel(x, t)}</button>
        ))}
      </div>
      <div className="child-body">
        {tab === "Activities" && (
          <>
            <div className="section-title"><h2>{t.lessonHistory}</h2></div>
            <LessonList records={lessons} t={t} />
          </>
        )}
        {tab === "Moments" && (
          <div className="observation-feed">
            {!obs.length && <Empty text={t.noObservationsYet} />}
            {obs.map(o => (
              <article className="observation-card" key={o.id}>
                <small>{fmt(o.date)}</small>
                <p>{noteText(o.notes, o.notesZh, t)}</p>
                <div className="skill-tags">{o.skills.map(s => <span key={s}>{skillLabel(s, t)}</span>)}</div>
              </article>
            ))}
          </div>
        )}
        {tab === "Journal" && <JournalTimeline child={child} entries={journal} lang={lang} open={openEntry} write={writeEntry} importNotes={importNotes} t={t} />}
        {tab !== "Journal" && <button className="wide-primary" onClick={record}><Icon name="plus" size={18} />{t.recordLesson}</button>}
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
