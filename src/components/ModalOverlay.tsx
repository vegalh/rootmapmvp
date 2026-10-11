import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Modal, Field } from "./ui";
import { fmtLong, isoToday, localIsoToday } from "../lib/dates";
import { resizePhoto } from "../lib/photos";
import { readText, storeText } from "../lib/storage";
import type { Activity, Child, ModalKind, Plan, Screen } from "../types";
import { groupOptionLabel, localizeActivity, recentOptionLabel, sortOptionLabel, type Copy } from "../lib/i18n";

export function ModalOverlay({ modal, close, childrenData, setChildrenData, filters, setFilters, selectedActivity, plans, setPlans, selectedChild, saveTried, addMemory, t }: {
  modal: ModalKind;
  close: (destination?: Screen | ModalKind) => void;
  childrenData: Child[];
  // Stores synchronously; false (with an error already shown) when the device couldn't save.
  setChildrenData: (c: Child[]) => boolean;
  filters: { age: string; group: string; recent: string; sort: string };
  setFilters: (f: { age: string; group: string; recent: string; sort: string }) => void;
  selectedActivity: Activity;
  plans: Plan[];
  // Stores synchronously; false (with an error already shown) when the device couldn't save.
  setPlans: (p: Plan[]) => boolean;
  selectedChild: string;
  // Records that `childId` tried the selected activity; returns an error message when it couldn't be stored.
  saveTried: (childId: string, date: string, notes: string) => string | null;
  // Opens the Moments editor for `childId`, prefilled with the selected activity as context.
  addMemory: (childId: string, date: string) => void;
  t: Copy;
}) {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("2023-01-01");
  const [group, setGroup] = useState("Primary");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState("");
  const [date, setDate] = useState(isoToday());
  const [chosen, setChosen] = useState<string[]>(selectedChild ? [selectedChild] : []);
  const [planNote, setPlanNote] = useState("");

  useEffect(() => {
    if (modal === "plan") setChosen(selectedChild ? [selectedChild] : []);
  }, [modal, selectedChild]);

  if (!modal) return null;

  // Profile pictures are shown as small avatars, so they're downscaled before being stored.
  const pickPhoto = (file: File | undefined, onLoad: (dataUrl: string) => void) => {
    if (!file) return;
    resizePhoto(file, 640, 0.85).then(onLoad, () => window.alert(t.photoUnsupported));
  };

  const addChild = () => {
    const [first, ...last] = name.trim().split(" ");
    if (!first) return;
    const added = setChildrenData([...childrenData, {
      id: `c-${Date.now()}`,
      first,
      last: last.join(" ") || "Child",
      dob,
      enrolled: "October 2026",
      lessons: 0,
      group,
      notes,
      photo: photo || "https://images.unsplash.com/photo-1606386666595-d135abc1e3b2?auto=format&fit=crop&w=300&q=85",
    }]);
    if (added) close();
  };

  if (modal === "tried") {
    return <TriedSheet activity={selectedActivity} childrenData={childrenData} saveTried={saveTried} addMemory={addMemory} close={() => close()} t={t} />;
  }

  if (modal === "quick") {
    return (
      <Modal title={t.quickAdd} close={close}>
        <div className="quick-actions">
          <button onClick={() => close("record")}><Icon name="book" />{t.recordLessonPresentation}</button>
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
          <button onClick={() => {
            const title = window.prompt(t.customActivityNamePrompt);
            if (!title) return;
            const existing = readText("rootmap-personal-notes");
            if (!storeText("rootmap-personal-notes", `${existing}${existing ? "\n\n" : ""}${t.customActivityLabel}: ${title}\n${t.materialsLabelShort}:\n${t.planLabel}:`)) return;
            close("notes");
          }}><Icon name="plus" />{t.createCustomActivity}</button>
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

  if (modal === "addChild") {
    return (
      <Modal title={t.addChild} close={close}>
        <div className="sheet-fields">
          <Field label={t.childFullName}><input value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label={t.dateOfBirth}><input type="date" value={dob} onChange={e => setDob(e.target.value)} /></Field>
          <div className="field child-photo-field">
            <span>{t.childPhotoLabel}</span>
            <div className="child-photo-row">
              {photo ? <img src={photo} alt="" className="child-photo-row-preview" /> : <i className="child-photo-row-placeholder"><Icon name="user" size={20} /></i>}
              <label className="wide-primary photo-upload-button">
                {t.uploadPhoto}
                <input type="file" accept="image/*" hidden onChange={e => pickPhoto(e.target.files?.[0], setPhoto)} />
              </label>
            </div>
          </div>
          <Field label={t.classroomGroupLabel}><select value={group} onChange={e => setGroup(e.target.value)}><option value="Toddler">{t.toddler}</option><option value="Primary">{t.primaryGroup}</option><option value="Other">{t.otherGroup}</option></select></Field>
          <Field label={t.notesOptional}><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        </div>
        <button className="modal-primary" onClick={addChild}>{t.addChild}</button>
      </Modal>
    );
  }

  // modal === "plan"
  const planActivity = localizeActivity(selectedActivity, t);
  return (
    <Modal title={t.addWeek} close={close}>
      <div className="sheet-fields">
        <div className="plan-activity"><img src={planActivity.image} alt="" /><strong>{planActivity.title}</strong></div>
        <Field label={t.date}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <fieldset>
          <legend>{t.selectChildren}</legend>
          <div className="child-checks">
            {childrenData.map(c => (
              <button className={chosen.includes(c.id) ? "active" : ""} onClick={() => setChosen(chosen.includes(c.id) ? chosen.filter(x => x !== c.id) : [...chosen, c.id])} key={c.id}>
                <img src={c.photo} alt="" />{c.first}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label={t.planningNote}><textarea value={planNote} onChange={e => setPlanNote(e.target.value)} /></Field>
      </div>
      <button className="modal-primary" onClick={() => { if (setPlans([...plans, { id: `p-${Date.now()}`, activityId: selectedActivity.id, date, childIds: chosen, note: planNote }])) close("week"); }}>{t.addWeek}</button>
    </Modal>
  );
}

// "Mark as Tried": a few-second record that a child tried this activity. Mounted fresh on every open.
function TriedSheet({ activity, childrenData, saveTried, addMemory, close, t }: {
  activity: Activity;
  childrenData: Child[];
  saveTried: (childId: string, date: string, notes: string) => string | null;
  addMemory: (childId: string, date: string) => void;
  close: () => void;
  t: Copy;
}) {
  const a = localizeActivity(activity, t);
  const [childId, setChildId] = useState(childrenData.length === 1 ? childrenData[0].id : "");
  const [date, setDate] = useState(localIsoToday());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [savedFor, setSavedFor] = useState<{ childId: string; date: string }>();
  // Guards against a double tap storing the same attempt twice before the sheet re-renders.
  const saving = useRef(false);

  const save = () => {
    if (saving.current) return;
    if (!childId) { setError(t.chooseChildFirst); return; }
    saving.current = true;
    const failure = saveTried(childId, date, notes.trim());
    if (failure) { setError(failure); saving.current = false; return; }
    setSavedFor({ childId, date });
  };

  if (savedFor) {
    const c = childrenData.find(x => x.id === savedFor.childId);
    return (
      <Modal title={t.markAsTried} close={close}>
        <div className="plan-activity"><img src={a.image} alt="" /><strong>{a.title}</strong></div>
        <p className="tried-done" role="status"><Icon name="check" size={18} />{t.markedTriedFor.replace("{name}", c?.first || "")} · {fmtLong(savedFor.date, t.code as "en" | "zh")}</p>
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
        <div className="plan-activity"><img src={a.image} alt="" /><strong>{a.title}</strong></div>
        <Field label={t.childLabel}>
          <select value={childId} onChange={e => { setChildId(e.target.value); setError(""); }}>
            <option value="" disabled>{t.selectChild}</option>
            {childrenData.map(c => <option value={c.id} key={c.id}>{c.first} {c.last}</option>)}
          </select>
        </Field>
        <Field label={t.date}><input type="date" value={date} max={localIsoToday()} onChange={e => e.target.value && setDate(e.target.value)} /></Field>
        <Field label={t.notesOptional}><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t.addNotePlaceholder} rows={2} /></Field>
      </div>
      {error && <p className="journal-status error" role="alert">{error}</p>}
      <div className="sheet-buttons">
        <button onClick={close}>{t.cancel}</button>
        <button onClick={save} disabled={!childId}>{t.save}</button>
      </div>
    </Modal>
  );
}
