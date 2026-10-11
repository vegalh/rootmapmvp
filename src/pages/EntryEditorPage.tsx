import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { draftKey, readDraft, writeDraft } from "../lib/journalDrafts";
import { fmtLong, localIsoToday } from "../lib/dates";
import { resizePhoto } from "../lib/photos";
import type { Child, JournalDraft, JournalEntry, Lang } from "../types";
import type { Copy } from "../lib/i18n";

type Fields = Omit<JournalDraft, "savedAt">;
type DraftStatus = "idle" | "saving" | "saved" | "failed";

const sameFields = (a: Fields, b: Fields) =>
  a.date === b.date && a.title === b.title && a.text === b.text && a.photos.length === b.photos.length && a.photos.every((p, i) => p === b.photos[i]);
const hasContent = (f: Fields) => Boolean(f.title.trim() || f.text.trim() || f.photos.length);

// Distraction-free editor for creating or editing one journal entry. Unsaved changes are autosaved
// as a local draft; the published entry is only changed when the parent taps Save.
export function JournalEditorPage({ child, entry, lang, save, back, t }: {
  child: Child;
  entry?: JournalEntry;
  lang: Lang;
  // Returns false when the entry couldn't be stored (e.g. device out of space).
  save: (fields: Fields) => boolean;
  back: () => void;
  t: Copy;
}) {
  const key = draftKey(child.id, entry?.id);
  const base: Fields = entry
    ? { date: entry.date, title: entry.title || "", text: entry.text || "", photos: entry.photos }
    : { date: localIsoToday(), title: "", text: "", photos: [] };
  // A new-entry draft is only worth keeping once it has content; an edit draft once it differs from the entry.
  const isDirty = (f: Fields) => (entry ? !sameFields(f, base) : hasContent(f));

  const [initialDraft] = useState(() => readDraft(key));
  const [fields, setFields] = useState<Fields>(() => (initialDraft ? { date: initialDraft.date, title: initialDraft.title, text: initialDraft.text, photos: initialDraft.photos } : base));
  const [restored, setRestored] = useState(Boolean(initialDraft));
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const latest = useRef(fields);
  const done = useRef(false);
  const first = useRef(true);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const persistDraft = (f: Fields): DraftStatus => {
    if (!isDirty(f)) {
      writeDraft(key, null);
      return "idle";
    }
    return writeDraft(key, { ...f, savedAt: new Date().toISOString() }) ? "saved" : "failed";
  };

  // Debounced autosave after each change.
  useEffect(() => {
    latest.current = fields;
    if (first.current) { first.current = false; return; }
    setStatus("saving");
    const id = window.setTimeout(() => setStatus(persistDraft(fields)), 600);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  // Flush the latest edits if the parent leaves before the debounce fires.
  useEffect(() => () => { if (!done.current) persistDraft(latest.current); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  // Grow the writing area with its content so long entries read like a page, not a scroll box.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [fields.text]);

  const set = (patch: Partial<Fields>) => setFields(f => ({ ...f, ...patch }));

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setAdding(true);
    setError("");
    const results = await Promise.allSettled(Array.from(files).map(f => resizePhoto(f)));
    const added = results.flatMap(r => (r.status === "fulfilled" ? [r.value] : []));
    if (added.length < results.length) setError(t.photoUnsupported);
    setFields(f => ({ ...f, photos: [...f.photos, ...added] }));
    setAdding(false);
  };

  const canSave = hasContent(fields) && !adding;
  const submit = () => {
    if (!canSave) return;
    if (!save(fields)) { setError(t.journalStorageFull); return; }
    done.current = true;
    writeDraft(key, null);
  };

  const discard = () => {
    writeDraft(key, null);
    setRestored(false);
    setStatus("idle");
    // Skip the autosave pass for this reset.
    first.current = true;
    setFields(base);
  };

  return (
    <main className="journal-editor">
      <header className="journal-editor-bar">
        <button onClick={back}><Icon name="back" size={18} />{t.back}</button>
        <button className="journal-save" onClick={submit} disabled={!canSave}>{t.saveEntry}</button>
      </header>

      <label className="journal-date">
        <span>{fmtLong(fields.date, lang)}</span>
        <Icon name="down" size={16} />
        <input type="date" value={fields.date} max={localIsoToday()} onChange={e => e.target.value && set({ date: e.target.value })} aria-label={t.date} />
      </label>
      <p className={`journal-status ${status === "failed" ? "error" : ""}`} aria-live="polite">
        {status === "saving" ? t.draftSaving : status === "saved" ? t.draftSaved : status === "failed" ? t.draftFailed : entry ? t.entryChangedHint : " "}
      </p>

      {restored && (
        <div className="journal-restored">
          <span>{t.draftRestored}</span>
          <button onClick={discard}>{t.discardDraft}</button>
        </div>
      )}

      <div className={`journal-photos ${fields.photos.length ? "has-photos" : ""}`}>
        {fields.photos.map((p, i) => (
          <figure key={`${i}-${p.slice(-24)}`}>
            <img src={p} alt="" />
            <button aria-label={t.removePhoto} onClick={() => set({ photos: fields.photos.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>
          </figure>
        ))}
        <label className="journal-add-photo">
          <Icon name="plus" size={20} />
          <span>{adding ? "…" : t.addPhotos}</span>
          <input type="file" accept="image/*" multiple hidden onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />
        </label>
      </div>

      <input className="journal-title-input" value={fields.title} onChange={e => set({ title: e.target.value })} placeholder={t.journalTitlePlaceholder} aria-label={t.journalTitlePlaceholder} />
      <textarea ref={textRef} className="journal-text-input" value={fields.text} onChange={e => set({ text: e.target.value })} placeholder={t.journalPrompt} aria-label={t.journalPrompt} rows={8} />

      {error && <p className="journal-status error" role="alert">{error}</p>}
      {!hasContent(fields) && <p className="journal-hint">{t.entryEmptyHint}</p>}
    </main>
  );
}

export default JournalEditorPage;
