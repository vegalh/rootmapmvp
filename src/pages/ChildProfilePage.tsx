import { useState } from "react";
import { Icon } from "../components/Icon";
import { EntryTimeline, SearchField, WriteButton } from "../components/EntryTimeline";
import { TreeLogo } from "../components/TreeLogo";
import { Modal } from "../components/ui";
import { draftKey, readDraft } from "../lib/journalDrafts";
import { matchesQuery, newestFirst } from "../lib/entries";
import { fmt, fmtLong } from "../lib/dates";
import { photoUrl } from "../lib/photos";
import { recordView } from "../lib/activityRecords";
import type { Child, Entry, Lang, LessonRecord } from "../types";
import { childAge, childTabLabel, groupOptionLabel, noteText, skillLabel, type Copy } from "../lib/i18n";

export function ChildProfilePage({ child, records, entries, pendingNotes, tab, setTab, lang, openEntry, writeEntry, importNotes, edit, back, record, remove, deleteRecord, t }: {
  child: Child;
  records: LessonRecord[];
  // The shared Moments collection; the Journal tab shows this child's part of it.
  entries: Entry[];
  // Legacy `child.notes` not yet saved as an entry.
  pendingNotes: boolean;
  // Active tab is owned by App so returning from an entry lands back on the Journal tab.
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
  // Deletes one activity record by id; false (with an error already shown) when the device couldn't save.
  deleteRecord: (id: string) => Promise<boolean>;
  t: Copy;
}) {
  // Several attempts on the same day keep the order they were recorded in (newest first).
  const lessons = records.filter(r => r.childId === child.id).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
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
        <img src={photoUrl(child.photo)} alt="" />
        <h1>{child.first} {child.last}</h1>
        <p>{childAge(child, t)}</p>
        <small>{groupOptionLabel(child.group, t)}</small>
      </section>
      <div className="tabs">
        {["Journal", "Activities"].map(x => (
          <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{childTabLabel(x, t)}</button>
        ))}
      </div>
      <div className="child-body">
        {tab === "Activities" ? (
          <>
            <div className="section-title"><h2>{t.lessonHistory}</h2></div>
            <LessonList records={lessons} lang={lang} deleteRecord={deleteRecord} t={t} />
            <button className="wide-primary" onClick={record}><Icon name="plus" size={18} />{t.addActivity}</button>
          </>
        ) : (
          <ChildJournal child={child} entries={entries} pendingNotes={pendingNotes} lang={lang} open={openEntry} write={writeEntry} importNotes={importNotes} t={t} />
        )}
      </div>
    </main>
  );
}

// One child's view of the shared Moments collection, read like a memory book.
function ChildJournal({ child, entries, pendingNotes, lang, open, write, importNotes, t }: {
  child: Child;
  entries: Entry[];
  pendingNotes: boolean;
  lang: Lang;
  open: (id: string) => void;
  write: () => void;
  importNotes: () => void;
  t: Copy;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const mine = entries.filter(e => e.childId === child.id).sort(newestFirst);
  const shown = mine.filter(e => matchesQuery(e, query));
  const legacyNotes = pendingNotes ? child.notes?.trim() : "";

  return (
    <div className="journal">
      <div className="journal-head">
        <h2>{t.journalOf.replace("{name}", child.first)}</h2>
        <button className="icon-button" aria-label={t.search} aria-pressed={searching} onClick={() => { setSearching(!searching); setQuery(""); }}>
          <Icon name={searching ? "close" : "search"} />
        </button>
      </div>
      {searching && <SearchField query={query} setQuery={setQuery} t={t} />}
      {!searching && <WriteButton label={t.writeEntry} draft={readDraft(draftKey(child.id))} write={write} lang={lang} t={t} />}

      {mine.length === 0 && !legacyNotes && !searching && <p className="journal-empty">{t.journalEmpty}</p>}
      {searching && query.trim() && shown.length === 0 && <p className="journal-empty">{t.journalNoResults}</p>}
      <EntryTimeline entries={shown} lang={lang} open={open} />

      {legacyNotes && !searching && (
        <section className="journal-legacy">
          <h3>{t.earlierNotes}</h3>
          <p className="journal-legacy-hint">{t.earlierNotesHint}</p>
          <p className="journal-legacy-text">{legacyNotes}</p>
          <button onClick={importNotes}>{t.saveToJournal}</button>
        </section>
      )}
    </div>
  );
}

function LessonList({ records, lang, deleteRecord, t }: { records: LessonRecord[]; lang: Lang; deleteRecord: (id: string) => Promise<boolean>; t: Copy }) {
  // Record shown in the detail sheet, where a mistaken one can be deleted.
  const [open, setOpen] = useState<LessonRecord>();
  const view = open && recordView(open, t);
  return (
    <div className="lesson-list">
      {records.map(r => {
        const v = recordView(r, t);
        if (r.kind === "tried") {
          // Parent-friendly: just the activity and when it was tried, no learning stage.
          return (
            <button key={r.id} onClick={() => setOpen(r)}>
              <i><Icon name={v.music ? "music" : "check"} size={18} /></i>
              <span><strong>{v.title}</strong><small>{t.triedOn.replace("{date}", fmtLong(r.date, lang))}</small></span>
              <b className="status tried">{t.tried}</b>
              <Icon name="chevron" size={15} />
            </button>
          );
        }
        return (
          <button key={r.id} onClick={() => setOpen(r)}>
            <i><Icon name={v.music ? "music" : "book"} size={18} /></i>
            <span><strong>{v.title}</strong><small>{v.area ? `${v.area} · ` : ""}{fmt(r.date)}</small></span>
            {v.stage ? <b className={`status ${r.stage!.toLowerCase()}`}>{v.stage}</b> : <b />}
            <Icon name="chevron" size={15} />
          </button>
        );
      })}
      {open && view && (
        <Modal title={view.title} close={() => setOpen(undefined)}>
          <div className="record-detail">
            {open.kind === "tried" ? <b className="status tried">{t.tried}</b> : view.stage && <b className={`status ${open.stage!.toLowerCase()}`}>{view.stage}</b>}
            <p>{open.kind === "tried" ? t.triedOn.replace("{date}", fmtLong(open.date, lang)) : [view.area, fmtLong(open.date, lang)].filter(Boolean).join(" · ")}</p>
            {open.skills?.length ? <p className="record-notes">{open.skills.map(s => skillLabel(s, t)).join(" · ")}</p> : null}
            {noteText(open.notes, open.notesZh, t) && <p className="record-notes">{noteText(open.notes, open.notesZh, t)}</p>}
          </div>
          <div className="sheet-buttons even">
            <button
              className="danger"
              onClick={() => {
                // Removes only this record (by id): other attempts, the Discover activity and journal entries stay.
                if (!window.confirm(t.confirmDeleteRecord)) return;
                void deleteRecord(open.id).then(ok => ok && setOpen(undefined));
              }}
            ><Icon name="trash" size={17} />{t.deleteRecord}</button>
            <button onClick={() => setOpen(undefined)}>{t.done}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
