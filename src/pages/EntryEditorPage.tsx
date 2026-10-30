import { useEffect, useRef, useState } from "react";
import { ChildPhoto } from "../components/ui";
import { Icon } from "../components/Icon";
import { draftKey, flushDraft, readDraft, writeDraft } from "../lib/journalDrafts";
import { fmtLong, localIsoToday } from "../lib/dates";
import { addPhoto, photoUrl } from "../lib/photos";
import type { Child, Entry, EntryDraft, Lang } from "../types";
import type { Copy } from "../lib/i18n";
import { childOptionLabel, childShortName } from "../lib/children";

// `childIds` is every child chosen (in family order); `childId` is always the first of them, or the one child.
type Fields = Required<Omit<EntryDraft, "savedAt">>;
type DraftStatus = "idle" | "saving" | "saved" | "failed";

// Starting values for a new entry (e.g. the activity just marked as tried, its note and the children who tried it).
export type EntryPrefill = { title: string; date: string; text?: string; childIds?: string[] };

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameFields = (a: Fields, b: Fields) =>
  a.childId === b.childId && sameList(a.childIds, b.childIds) && a.date === b.date && a.title === b.title && a.text === b.text && sameList(a.photos, b.photos);
const hasContent = (f: Fields) => Boolean(f.title.trim() || f.text.trim() || f.photos.length);

// The one editor for every memory, whether started from Moments or a child's Journal. Unsaved changes are
// autosaved as a local draft; the published entry is only changed when the parent taps Save.
export function EntryEditorPage({ childrenData, childId, lockChild, entry, prefill, lang, save, back, t }: {
  childrenData: Child[];
  // Preselected child (the Journal's child, or the Moments filter); ignored when editing.
  childId: string;
  // From a child's Journal the child is shown as read-only context instead of a picker.
  lockChild: boolean;
  entry?: Entry;
  // Starting values for a new entry (e.g. the activity just marked as tried); freely editable, never saved on its own.
  prefill?: EntryPrefill;
  lang: Lang;
  // Resolves to false when the entry couldn't be stored (e.g. device out of space). `draftKey` is the draft to
  // clear in the same write, so the saved entry can't be resumed from it and saved twice.
  save: (fields: Fields, draftKey: string) => Promise<boolean>;
  back: () => void;
  t: Copy;
}) {
  // A new moment, not tied to one child's Journal, can be about several children: it's saved as one entry each.
  // Editing an entry is always about its one child.
  const several = !entry && !lockChild && childrenData.length > 1;
  // In family order, only children still in the family.
  const inFamily = (ids: string[]) => childrenData.filter(c => ids.includes(c.id)).map(c => c.id);
  const withChildren = (f: Omit<Fields, "childId" | "childIds">, ids: string[]): Fields => {
    const childIds = several ? inFamily(ids) : ids.slice(0, 1);
    return { ...f, childIds, childId: childIds[0] || "" };
  };
  // An edit's draft stays under the entry's original child even if the parent picks another child. A new entry's
  // draft is stored under its first chosen child.
  const keyFor = (f: Fields) => (entry ? draftKey(entry.childId, entry.id) : draftKey(f.childId));
  const base: Fields = entry
    ? { childId: entry.childId, childIds: [entry.childId], date: entry.date, title: entry.title || "", text: entry.text || "", photos: entry.photos }
    : withChildren({ date: prefill?.date || localIsoToday(), title: prefill?.title || "", text: prefill?.text || "", photos: [] }, prefill?.childIds?.length ? prefill.childIds : childId ? [childId] : []);
  // A new-entry draft is only worth keeping once it has content beyond any prefill; an edit draft once it differs from the entry.
  const isDirty = (f: Fields) => (entry ? !sameFields(f, base) : hasContent(f) && !(prefill && sameFields(f, base)));

  const [initialDraft] = useState(() => readDraft(keyFor(base)));
  // A draft written before a moment could be for several children has only `childId`; it restores that one child.
  const [fields, setFields] = useState<Fields>(() => {
    if (!initialDraft) return base;
    const restoredFields = { date: initialDraft.date, title: initialDraft.title, text: initialDraft.text, photos: initialDraft.photos };
    if (entry) return { ...restoredFields, childId: initialDraft.childId || base.childId, childIds: [initialDraft.childId || base.childId] };
    return withChildren(restoredFields, initialDraft.childIds?.length ? initialDraft.childIds : [initialDraft.childId || base.childId]);
  });
  const [restored, setRestored] = useState(Boolean(initialDraft));
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const latest = useRef(fields);
  // Set while the entry is being saved and after it was: no draft may be written for it from then on.
  const done = useRef(false);
  const first = useRef(true);
  // Only the newest autosave may update the status line.
  const autosave = useRef(0);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const draftFor = (f: Fields) => (isDirty(f) ? { ...f, savedAt: new Date().toISOString() } : null);

  // "saved" is only shown once the draft is actually stored.
  const persistDraft = async (f: Fields): Promise<DraftStatus> => {
    const draft = draftFor(f);
    const ok = await writeDraft(keyFor(f), draft);
    return !draft ? "idle" : ok ? "saved" : "failed";
  };

  const chooseChild = (id: string) => set({ childId: id, childIds: [id] });

  // "Who is this moment about?": built from the latest state, so quick taps in a row all count.
  const toggleChild = (id: string) => setFields(f => {
    const next = withChildren(f, f.childIds.includes(id) ? f.childIds.filter(x => x !== id) : [...f.childIds, id]);
    return { ...f, childId: next.childId, childIds: next.childIds };
  });

  // A new entry's draft follows its (first) chosen child, so move it rather than leaving a copy behind: the copy
  // under the previous child is cleared, and the autosave writes it under the new one.
  const draftChild = useRef(fields.childId);
  useEffect(() => {
    if (entry || draftChild.current === fields.childId) return;
    void writeDraft(draftKey(draftChild.current), null);
    draftChild.current = fields.childId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.childId]);

  // Debounced autosave after each change.
  useEffect(() => {
    latest.current = fields;
    if (first.current) { first.current = false; return; }
    setStatus("saving");
    const run = ++autosave.current;
    const id = window.setTimeout(() => {
      if (done.current) return;
      void persistDraft(fields).then(next => { if (run === autosave.current && !done.current) setStatus(next); });
    }, 600);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  // Flush the latest edits if the parent leaves before the debounce fires: navigating away within the app,
  // or refreshing / closing / backgrounding the page (where unmount cleanup never runs).
  useEffect(() => {
    const flush = () => { if (!done.current) flushDraft(keyFor(latest.current), draftFor(latest.current)); };
    const onHidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grow the writing area with its content so long entries read like a page, not a scroll box.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [fields.text]);

  const set = (patch: Partial<Fields>) => setFields(f => ({ ...f, ...patch }));

  // Each photo is stored on this device as soon as it's added; the draft and the entry keep only its id.
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setAdding(true);
    setError("");
    const results = await Promise.allSettled(Array.from(files).map(f => addPhoto(f)));
    const added = results.flatMap(r => (r.status === "fulfilled" ? [r.value] : []));
    const reasons = results.flatMap(r => (r.status === "rejected" ? [String((r.reason as Error)?.message)] : []));
    if (reasons.includes("full")) setError(t.storageFull);
    else if (reasons.includes("failed")) setError(t.storageFailed);
    else if (reasons.length) setError(t.photoUnsupported);
    setFields(f => ({ ...f, photos: [...f.photos, ...added] }));
    setAdding(false);
  };

  const child = childrenData.find(c => c.id === fields.childId);
  const chosen = several ? inFamily(fields.childIds) : child ? [child.id] : [];
  // Never saved for a removed child or without one: with several children the parent picks at least one first.
  const canSave = hasContent(fields) && chosen.length > 0 && !adding && !saving;
  const submit = async () => {
    if (!canSave) return;
    done.current = true;
    setSaving(true);
    const ok = await save({ ...fields, childId: chosen[0], childIds: chosen }, keyFor(fields));
    if (ok) return;
    // Not stored: keep editing, and keep the draft.
    done.current = false;
    setSaving(false);
    setError(t.journalStorageFull);
  };

  const discard = () => {
    void writeDraft(keyFor(fields), null);
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
        <button className="journal-save" onClick={submit} disabled={!canSave}>{t.save}</button>
      </header>

      {several ? (
        <fieldset className="entry-children">
          <legend>{t.momentForChildren}</legend>
          <div className="child-checks">
            {childrenData.map(c => (
              <button aria-pressed={fields.childIds.includes(c.id)} className={fields.childIds.includes(c.id) ? "active" : ""} data-child={c.id} onClick={() => toggleChild(c.id)} key={c.id}>
                <ChildPhoto child={c} />{childShortName(c, childrenData)}
              </button>
            ))}
          </div>
          {!chosen.length && <p className="field-hint">{t.chooseChildForPlan}</p>}
        </fieldset>
      ) : lockChild ? (
        <div className="entry-child-pick">
          {child && <ChildPhoto child={child} />}
          <span><small>{t.childLabel}</small><strong>{child ? `${child.first} ${child.last}`.trim() : ""}</strong></span>
        </div>
      ) : (
        <label className="entry-child-pick">
          {child && <ChildPhoto child={child} />}
          <span><small>{t.childLabel}</small><strong>{child ? childOptionLabel(child, childrenData, t) : t.selectChild}</strong></span>
          <Icon name="down" size={16} />
          <select value={child ? fields.childId : ""} onChange={e => chooseChild(e.target.value)} aria-label={t.childLabel}>
            {!child && <option value="" disabled>{t.selectChild}</option>}
            {childrenData.map(c => <option value={c.id} key={c.id}>{childOptionLabel(c, childrenData, t)}</option>)}
          </select>
        </label>
      )}

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
            <img src={photoUrl(p)} alt="" />
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

export default EntryEditorPage;
