import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { EntryTimeline, SearchField, SearchToggle, WriteButton } from "../components/EntryTimeline";
import { TreeLogo } from "../components/TreeLogo";
import { Modal, useConfirm, useLatest, ChildPhoto } from "../components/ui";
import { draftKey, readDraft } from "../lib/journalDrafts";
import { matchesQuery, newestFirst } from "../lib/entries";
import { fmt, fmtLong } from "../lib/dates";
import { recordView } from "../lib/activityRecords";
import type { Child, Entry, Lang, LessonRecord } from "../types";
import { childAge, childTabLabel, localizeActivity, noteText, skillLabel, type Copy } from "../lib/i18n";
import { childOptionLabel } from "../lib/children";
import { localIsoToday } from "../lib/dates";
import { Field } from "../components/ui";

export function ChildProfilePage({ child, childrenData, records, entries, pendingNotes, tab, setTab, lang, openEntry, writeEntry, importNotes, edit, back, record, remove, editRecord, deleteRecord, focusRecord, focusedRecord, t }: {
  child: Child;
  // Every child in My Children (a record can be moved to another child).
  childrenData: Child[];
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
  remove: () => Promise<void>;
  // Corrects one record's date, notes or child; resolves to an error message, or null once stored.
  editRecord: (id: string, patch: { date: string; notes: string; childId: string }) => Promise<string | null>;
  // Deletes one activity record by id; false (with an error already shown) when the device couldn't save.
  deleteRecord: (id: string) => Promise<boolean>;
  // A record to open on arrival (from Today's Looking Back), and the call that says it has been shown.
  focusRecord?: string;
  focusedRecord?: () => void;
  t: Copy;
}) {
  // Several attempts on the same day keep the order they were recorded in (newest first). Memoized so a family
  // with years of activity records doesn't re-filter/re-sort the whole list on every unrelated re-render.
  const lessons = useMemo(
    () => records.filter(r => r.childId === child.id).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || "")),
    [records, child.id],
  );
  const confirm = useConfirm();
  const latestRemove = useLatest(remove);
  // The profile is soft-deleted: its Moments and activity records stay, so the question says how many come back
  // with it from Recently Deleted.
  const confirmRemove = () => confirm({
    title: t.deleteChildTitle.replace("{name}", childOptionLabel(child, childrenData, t)),
    body: (
      <>
        <div className="confirm-facts">
          <div><span>{t.deleteChildMoments}</span><strong>{entries.filter(e => e.childId === child.id).length}</strong></div>
          <div><span>{t.deleteChildRecords}</span><strong>{lessons.length}</strong></div>
        </div>
        <p>{t.deleteChildRestoreNote.split("{name}").join(child.first)}</p>
      </>
    ),
    confirmLabel: t.deleteChild,
    destructive: true,
    onConfirm: () => latestRemove.current(),
  });
  return (
    <main className="child-profile">
      <header className="child-header">
        <button onClick={back} aria-label={t.backToChildren}><Icon name="back" size={18} /> {t.backToChildren}</button>
        <TreeLogo />
        <div className="child-header-actions">
          <button onClick={edit}>{t.edit}</button>
          <button onClick={confirmRemove} aria-label={t.deleteChildLabel.replace("{name}", child.first)}><Icon name="trash" size={18} /></button>
        </div>
      </header>
      <section className="profile-hero">
        <ChildPhoto child={child} />
        <h1>{child.first} {child.last}</h1>
        <p>{childAge(child, t)}</p>
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
            <LessonList records={lessons} childrenData={childrenData} lang={lang} editRecord={editRecord} deleteRecord={deleteRecord} focusRecord={focusRecord} focusedRecord={focusedRecord} t={t} />
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
  const mine = useMemo(() => entries.filter(e => e.childId === child.id).sort(newestFirst), [entries, child.id]);
  const shown = useMemo(() => mine.filter(e => matchesQuery(e, query)), [mine, query]);
  const legacyNotes = pendingNotes ? child.notes?.trim() : "";

  return (
    <div className="journal">
      <div className="journal-head">
        <h2>{t.journalOf.replace("{name}", child.first)}</h2>
        <SearchToggle searching={searching} setSearching={setSearching} setQuery={setQuery} t={t} />
      </div>
      {searching && <SearchField query={query} setQuery={setQuery} t={t} />}
      {!searching && <WriteButton label={t.writeEntry} draft={readDraft(draftKey(child.id))} write={write} lang={lang} t={t} />}

      {mine.length === 0 && !legacyNotes && !searching && <p className="journal-empty">{t.journalEmpty}</p>}
      {searching && query.trim() && shown.length === 0 && <p className="journal-empty">{t.journalNoResults}</p>}
      <EntryTimeline entries={shown} lang={lang} open={open} t={t} />

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

// Revealed up front, then grown by this many as the parent scrolls near the end (mirrors EntryTimeline.tsx).
const LESSON_INITIAL_REVEAL = 80;
const LESSON_REVEAL_STEP = 80;

function LessonList({ records, childrenData, lang, editRecord, deleteRecord, focusRecord, focusedRecord, t }: {
  records: LessonRecord[];
  childrenData: Child[];
  lang: Lang;
  editRecord: (id: string, patch: { date: string; notes: string; childId: string }) => Promise<string | null>;
  deleteRecord: (id: string) => Promise<boolean>;
  focusRecord?: string;
  focusedRecord?: () => void;
  t: Copy;
}) {
  // Record shown in the detail sheet, where a mistaken one can be corrected or deleted. Opens on arrival when Today's
  // Looking Back asked for it.
  const [open, setOpen] = useState<LessonRecord | undefined>(() => records.find(r => r.id === focusRecord));
  useEffect(() => { if (focusRecord) focusedRecord?.(); }, []);
  const [editing, setEditing] = useState(false);
  const confirm = useConfirm();
  const latestDelete = useLatest(deleteRecord);
  const view = open && recordView(open, t);
  const close = () => { setOpen(undefined); setEditing(false); };

  // A child with years of activity records can have hundreds of rows; render only as many as have scrolled into
  // view (same rows, same order) instead of all of them up front.
  const [revealed, setRevealed] = useState(LESSON_INITIAL_REVEAL);
  // Mirrors EntryTimeline.tsx's reset: scroll back to the top before paint too, or a parent scrolled deep into a
  // long history stays there as the page shrinks under them (and can silently reveal extra batches at once).
  useLayoutEffect(() => { setRevealed(LESSON_INITIAL_REVEAL); window.scrollTo(0, 0); }, [records]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = revealed < records.length;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setRevealed(n => n + LESSON_REVEAL_STEP); }, { rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore]);
  const visible = records.length > revealed ? records.slice(0, revealed) : records;

  return (
    <div className="lesson-list">
      {visible.map(r => {
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
            <span><strong>{v.title}</strong><small>{v.area ? `${v.area} · ` : ""}{fmt(r.date, lang)}</small></span>
            {v.stage ? <b className={`status ${r.stage!.toLowerCase()}`}>{v.stage}</b> : <b />}
            <Icon name="chevron" size={15} />
          </button>
        );
      })}
      {hasMore && <div ref={sentinelRef} aria-hidden="true" className="journal-timeline-sentinel" />}
      {open && view && editing && (
        <RecordEditSheet record={open} title={view.title} childrenData={childrenData} save={patch => editRecord(open.id, patch)} close={close} t={t} />
      )}
      {open && view && !editing && (
        <Modal title={view.title} close={close}>
          <div className="record-detail">
            {open.kind === "tried" ? <b className="status tried">{t.tried}</b> : view.stage && <b className={`status ${open.stage!.toLowerCase()}`}>{view.stage}</b>}
            <p>{open.kind === "tried" ? t.triedOn.replace("{date}", fmtLong(open.date, lang)) : [view.area, fmtLong(open.date, lang)].filter(Boolean).join(" · ")}</p>
            {open.skills?.length ? <p className="record-notes">{open.skills.map(s => skillLabel(s, t)).join(" · ")}</p> : null}
            {!open.skills?.length && view.activity?.domains.length ? (
              <div className="skill-tags activity-skills" aria-label={t.activitySkills}>{localizeActivity(view.activity, t).domains.map(x => <span key={x}>{x}</span>)}</div>
            ) : null}
            {noteText(open.notes, open.notesZh, t) && <p className="record-notes">{noteText(open.notes, open.notesZh, t)}</p>}
          </div>
          <div className="sheet-buttons even">
            <button
              className="danger"
              onClick={() => {
                // Removes only this record (by id): other attempts, the Discover activity and journal entries stay.
                confirm({
                  title: t.confirmDeleteRecord,
                  body: <p>{t.confirmDeleteRecordBody}</p>,
                  confirmLabel: t.deleteRecord,
                  destructive: true,
                  onConfirm: () => latestDelete.current(open.id).then(ok => ok && close()),
                });
              }}
            ><Icon name="trash" size={17} />{t.deleteRecord}</button>
            <button onClick={() => setEditing(true)}>{t.editRecord}</button>
            <button onClick={close}>{t.done}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Corrects a record: date, notes, and the child it belongs to. The activity, and any stage or skills recorded
// earlier, stay exactly as they were.
function RecordEditSheet({ record, title, childrenData, save, close, t }: {
  record: LessonRecord;
  title: string;
  childrenData: Child[];
  save: (patch: { date: string; notes: string; childId: string }) => Promise<string | null>;
  close: () => void;
  t: Copy;
}) {
  const [date, setDate] = useState(record.date);
  // The stored (original-language) note is what gets edited.
  const [notes, setNotes] = useState(record.notes || "");
  const [childId, setChildId] = useState(record.childId);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const submit = async () => {
    if (saving.current) return;
    saving.current = true;
    const failure = await save({ date, notes, childId });
    saving.current = false;
    if (failure) setError(failure);
    else close();
  };
  return (
    <Modal title={t.editRecordTitle} close={close}>
      <div className="sheet-fields">
        <p className="record-edit-title"><strong>{title}</strong></p>
        {childrenData.length > 1 && (
          <Field label={t.childLabel}>
            <select value={childId} onChange={e => { setChildId(e.target.value); setError(""); }}>
              {childrenData.map(c => <option value={c.id} key={c.id}>{childOptionLabel(c, childrenData, t)}</option>)}
            </select>
          </Field>
        )}
        <Field label={t.date}><input type="date" value={date} max={localIsoToday()} onChange={e => e.target.value && setDate(e.target.value)} /></Field>
        <Field label={`${t.notesLabel}${t.optionalSuffix}`}><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder={t.whatDidYouNotice} /></Field>
      </div>
      {error && <p className="journal-status error" role="alert">{error}</p>}
      <div className="sheet-buttons">
        <button onClick={close}>{t.cancel}</button>
        <button onClick={submit}>{t.save}</button>
      </div>
    </Modal>
  );
}
