import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Modal, Field, ChildPhoto, SheetContext } from "./ui";
import { fmtLong, localIsoToday } from "../lib/dates";
import { addPhoto, photoUrl } from "../lib/photos";
import { DEFAULT_CHILD_PHOTO } from "../lib/sync/mapping";
import { newRecordId } from "../lib/data/schema";
import type { Activity, Child, Lang, ModalKind, Plan, Screen } from "../types";
import { categoryOptionLabel, groupOptionLabel, localizeActivity, recentOptionLabel, sortOptionLabel, type Copy } from "../lib/i18n";
import { childOptionLabel, childShortName, defaultChildId, isActiveChild } from "../lib/children";

type OverlayProps = Parameters<typeof ModalSheets>[0];

// The open sheet. `closing` while App keeps a just-closed sheet on screen for its slide-away animation.
export function ModalOverlay({ closing = false, ...props }: OverlayProps & { closing?: boolean }) {
  const sheet = useMemo(() => ({ closing }), [closing]);
  return <SheetContext.Provider value={sheet}><ModalSheets {...props} /></SheetContext.Provider>;
}

function ModalSheets({ modal, close, childrenData, setChildrenData, filters, setFilters, selectedActivity, plans, setPlans, selectedChild, saveTried, addMemory, notify, t }: {
  modal: ModalKind;
  close: (destination?: Screen | ModalKind) => void;
  childrenData: Child[];
  // Resolves to false (with an error already shown) when the device couldn't save.
  setChildrenData: (c: Child[]) => Promise<boolean>;
  filters: { age: string; group: string; recent: string; sort: string };
  setFilters: (f: { age: string; group: string; recent: string; sort: string }) => void;
  selectedActivity: Activity;
  plans: Plan[];
  // Resolves to false (with an error already shown) when the device couldn't save.
  setPlans: (p: Plan[]) => Promise<boolean>;
  selectedChild: string;
  // Records that `childId` tried the selected activity; resolves to an error message when it couldn't be stored.
  saveTried: (childId: string, date: string, notes: string) => Promise<string | null>;
  // Shows a short message in the app's toast (e.g. a photo that couldn't be added).
  notify: (message: string) => void;
  // Opens the Moments editor for `childId`, prefilled with the selected activity as context.
  addMemory: (childId: string, date: string) => void;
  t: Copy;
}) {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [photo, setPhoto] = useState("");
  const [childError, setChildError] = useState("");
  // Guards against a double tap adding the same child twice before the sheet closes.
  const savingChild = useRef(false);
  const [date, setDate] = useState(localIsoToday());
  const [chosen, setChosen] = useState<string[]>([]);
  const [planNote, setPlanNote] = useState("");
  const savingPlan = useRef(false);

  const editing = modal === "editChild" ? childrenData.find(c => c.id === selectedChild) : undefined;

  // A plan starts with today's date and the child already chosen (or the only child); never a removed child.
  useEffect(() => {
    if (modal !== "plan") return;
    const preset = defaultChildId(childrenData, selectedChild);
    setChosen(preset ? [preset] : []);
    setDate(localIsoToday());
    setPlanNote("");
    savingPlan.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, selectedChild]);

  // Add Child starts empty and Edit Child starts from the saved profile, so closing either one discards what was typed.
  // Only when the sheet opens: a sync arriving while it's open must not overwrite what the parent is typing.
  useEffect(() => {
    if (modal !== "addChild" && modal !== "editChild") return;
    setName(editing ? `${editing.first} ${editing.last}`.trim() : "");
    setDob(editing?.dob || "");
    setPhoto(editing?.photo || "");
    setChildError("");
    savingChild.current = false;
  }, [modal, editing?.id]);

  if (!modal || (modal === "editChild" && !editing)) return null;

  // Profile pictures are shown as small avatars, so they're downscaled before being stored on this device.
  const pickPhoto = (file: File | undefined, onLoad: (ref: string) => void) => {
    if (!file) return;
    addPhoto(file, 640, 0.85).then(onLoad, (e: Error) => notify(e.message === "full" ? t.storageFull : e.message === "failed" ? t.storageFailed : t.photoUnsupported));
  };

  const childProblem = childFormProblem(name, dob, t);
  const addChild = async () => {
    if (savingChild.current) return;
    if (childProblem) { setChildError(childProblem); return; }
    const [first, ...last] = name.trim().split(/\s+/);
    savingChild.current = true;
    let ok: boolean;
    if (editing) {
      // The same record (same id, photos, moments and records stay attached); only the fields on this form change.
      // Group and notes are no longer asked for; values saved earlier are kept as they are.
      const fields = { first, last: last.join(" "), dob, photo: photo || editing.photo };
      ok = await setChildrenData(childrenData.map(c => (c.id === editing.id ? { ...c, ...fields } : c)));
    } else {
      ok = await setChildrenData([...childrenData, {
        id: newRecordId("c"),
        first,
        last: last.join(" "),
        dob,
        enrolled: "",
        lessons: 0,
        group: "",
        // No picture chosen: an avatar with the child's initials is shown (lib/children.ts).
        photo,
      }]);
    }
    if (ok) close();
    else savingChild.current = false;
  };

  if (modal === "tried") {
    return <TriedSheet activity={selectedActivity} childrenData={childrenData} preferredChild={selectedChild} saveTried={saveTried} addMemory={addMemory} close={() => close()} t={t} />;
  }

  if (modal === "quick") {
    return (
      <Modal title={t.quickAdd} close={close}>
        <div className="quick-actions">
          <button onClick={() => close("record")}><Icon name="book" />{t.addActivity}</button>
          <button onClick={() => close("entryEdit")}><Icon name="note" />{t.addMoment}</button>
          <button onClick={() => close("addChild")}><Icon name="user" />{t.addChild}</button>
        </div>
      </Modal>
    );
  }

  if (modal === "weekAdd") {
    return (
      <Modal title={t.add} close={close}>
        <div className="quick-actions">
          <button onClick={() => close("discover")}><Icon name="compass" />{t.addActivityFromDiscover}</button>
          <button onClick={() => close("notes")}><Icon name="note" />{t.addPlanningNote}</button>
        </div>
      </Modal>
    );
  }

  if (modal === "filters") {
    return (
      <Modal title={t.filterChildren} close={close}>
        <div className="sheet-fields">
          <Field label={t.ageGroup}><select value={filters.age} onChange={e => setFilters({ ...filters, age: e.target.value })}>{["All Ages", "0–3 Years", "3–6 Years", "6+ Years"].map(x => <option value={x} key={x}>{x === "All Ages" ? t.ageAll : x}</option>)}</select></Field>
          <Field label={t.classroomGroupLabel}><select value={filters.group} onChange={e => setFilters({ ...filters, group: e.target.value })}>{["All Groups", "Toddler", "Primary", "Other"].map(x => <option value={x} key={x}>{groupOptionLabel(x, t)}</option>)}</select></Field>
          <Field label={t.recentActivityLabel}><select value={filters.recent} onChange={e => setFilters({ ...filters, recent: e.target.value })}>{["Any Time", "Today", "This Week", "This Month"].map(x => <option value={x} key={x}>{recentOptionLabel(x, t)}</option>)}</select></Field>
          <Field label={t.sortBy}><select value={filters.sort} onChange={e => setFilters({ ...filters, sort: e.target.value })}>{["Name A–Z", "Name Z–A", "Age", "Most Recently Observed"].map(x => <option value={x} key={x}>{sortOptionLabel(x, t)}</option>)}</select></Field>
        </div>
        <div className="sheet-buttons">
          <button onClick={() => setFilters({ age: "All Ages", group: "All Groups", recent: "Any Time", sort: "Name A–Z" })}>{t.reset}</button>
          <button onClick={() => close()}>{t.showResults}</button>
        </div>
      </Modal>
    );
  }

  if (modal === "addChild" || (modal === "editChild" && editing)) {
    return (
      <Modal title={editing ? t.editChild : t.addChild} close={close}>
        <div className="sheet-fields">
          <Field label={t.childFullName}><input value={name} onChange={e => { setName(e.target.value); setChildError(""); }} maxLength={80} autoComplete="off" aria-invalid={!!childError && !name.trim()} /></Field>
          <Field label={t.dateOfBirth}><input type="date" value={dob} max={localIsoToday()} onChange={e => { setDob(e.target.value); setChildError(""); }} aria-invalid={!!childError && !!name.trim()} /></Field>
          <div className="field child-photo-field">
            <span>{t.childPhotoLabel}</span>
            <div className="child-photo-row">
              {photo && photo !== DEFAULT_CHILD_PHOTO ? <img src={photoUrl(photo)} alt="" className="child-photo-row-preview" /> : <i className="child-photo-row-placeholder"><Icon name="user" size={20} /></i>}
              <label className="wide-primary photo-upload-button">
                {t.uploadPhoto}
                <input type="file" accept="image/*" hidden onChange={e => pickPhoto(e.target.files?.[0], setPhoto)} />
              </label>
            </div>
          </div>
        </div>
        {(childError || (dob > localIsoToday() ? t.childDobFuture : "")) && <p className="journal-status error" role="alert">{childError || t.childDobFuture}</p>}
        <button className="modal-primary" onClick={addChild}>{editing ? t.save : t.addChild}</button>
      </Modal>
    );
  }

  // modal === "plan"
  const planActivity = localizeActivity(selectedActivity, t);
  const validChosen = chosen.filter(id => isActiveChild(childrenData, id));
  return (
    <Modal title={t.addWeek} close={close}>
      <div className="sheet-fields">
        <div className="plan-activity"><img src={planActivity.image} alt="" /><strong>{planActivity.title}</strong></div>
        <Field label={t.date}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <fieldset>
          <legend>{t.selectChildren}</legend>
          <div className="child-checks">
            {childrenData.map(c => (
              <button aria-pressed={chosen.includes(c.id)} className={chosen.includes(c.id) ? "active" : ""} onClick={() => setChosen(chosen.includes(c.id) ? chosen.filter(x => x !== c.id) : [...chosen, c.id])} key={c.id}>
                <ChildPhoto child={c} />{childShortName(c, childrenData)}
              </button>
            ))}
          </div>
          {!validChosen.length && <p className="field-hint">{t.chooseChildForPlan}</p>}
        </fieldset>
        <Field label={t.planningNote}><textarea value={planNote} onChange={e => setPlanNote(e.target.value)} /></Field>
      </div>
      <button className="modal-primary" disabled={!validChosen.length} onClick={async () => {
        if (savingPlan.current || !validChosen.length) return;
        savingPlan.current = true;
        if (await setPlans([...plans, { id: newRecordId("p"), activityId: selectedActivity.id, date, childIds: validChosen, note: planNote }])) close("week");
        else savingPlan.current = false;
      }}>{t.addWeek}</button>
    </Modal>
  );
}

// "Mark as Tried": a few-second record that a child tried this activity. Mounted fresh on every open.
function TriedSheet({ activity, childrenData, preferredChild, saveTried, addMemory, close, t }: {
  activity: Activity;
  // The child the parent was last looking at; preselected only while still in the list.
  preferredChild: string;
  childrenData: Child[];
  saveTried: (childId: string, date: string, notes: string) => Promise<string | null>;
  addMemory: (childId: string, date: string) => void;
  close: () => void;
  t: Copy;
}) {
  const a = localizeActivity(activity, t);
  const [childId, setChildId] = useState(defaultChildId(childrenData, preferredChild));
  const valid = isActiveChild(childrenData, childId);
  const [date, setDate] = useState(localIsoToday());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [savedFor, setSavedFor] = useState<{ childId: string; date: string }>();
  // Guards against a double tap storing the same attempt twice before the sheet re-renders.
  const saving = useRef(false);

  const save = async () => {
    if (saving.current) return;
    if (!valid) { setError(t.chooseChildFirst); return; }
    saving.current = true;
    const failure = await saveTried(childId, date, notes.trim());
    if (failure) { setError(failure); saving.current = false; return; }
    setSavedFor({ childId, date });
  };

  if (savedFor) {
    const c = childrenData.find(x => x.id === savedFor.childId);
    return (
      <Modal title={t.markAsTried} close={close}>
        <div className="plan-activity"><img src={a.image} alt="" /><span><strong>{a.title}</strong><small>{categoryOptionLabel(a.category, t)}</small></span></div>
        <p className="tried-done" role="status"><Icon name="check" size={18} />{t.markedTriedFor.replace("{name}", c?.first || "")} · {fmtLong(savedFor.date, t.code as Lang)}</p>
        <div className="sheet-buttons">
          <button onClick={() => addMemory(savedFor.childId, savedFor.date)}>{t.addMemory}</button>
          <button onClick={close}>{t.done}</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t.markAsTried} close={close}>
      <div className="sheet-fields">
        <div className="plan-activity"><img src={a.image} alt="" /><span><strong>{a.title}</strong><small>{categoryOptionLabel(a.category, t)}</small></span></div>
        <Field label={t.childLabel}>
          <select value={childId} onChange={e => { setChildId(e.target.value); setError(""); }}>
            <option value="" disabled>{t.selectChild}</option>
            {childrenData.map(c => <option value={c.id} key={c.id}>{childOptionLabel(c, childrenData, t)}</option>)}
          </select>
        </Field>
        <Field label={t.date}><input type="date" value={date} max={localIsoToday()} onChange={e => e.target.value && setDate(e.target.value)} /></Field>
        {a.domains.length ? (
          <fieldset>
            <legend>{t.activitySkills}</legend>
            <div className="skill-tags activity-skills">{a.domains.map(x => <span key={x}>{x}</span>)}</div>
          </fieldset>
        ) : null}
        <Field label={`${t.notesLabel}${t.optionalSuffix}`}><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t.addNotePlaceholder} rows={2} /></Field>
      </div>
      {error && <p className="journal-status error" role="alert">{error}</p>}
      <div className="sheet-buttons">
        <button onClick={close}>{t.cancel}</button>
        <button onClick={save} disabled={!valid}>{t.save}</button>
      </div>
    </Modal>
  );
}

// Why the Add/Edit Child form can't be saved yet, or "" when it can.
export function childFormProblem(name: string, dob: string, t: Copy): string {
  if (!name.trim()) return t.childNameRequired;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return t.childDobRequired;
  if (dob > localIsoToday()) return t.childDobFuture;
  return "";
}
