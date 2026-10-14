import { useRef, useState } from "react";
import { PageHeader, Field, ChildPhoto } from "../components/ui";
import ActivityPicker from "../components/ActivityPicker";
import { catalogCategories, findActivity } from "../lib/catalog";
import type { RecordInput } from "../lib/activityRecords";
import { localIsoToday } from "../lib/dates";
import type { Child, LessonRecord } from "../types";
import { childAge, discoverCategoryLabel, localizeActivity, type Copy } from "../lib/i18n";
import { childOptionLabel, isActiveChild } from "../lib/children";

// The activity being recorded: one from the catalog, or the parent's own.
type Choice = { activityId: string } | { custom: true };

// Add Activity: pick an activity from the shared catalog (or Other / Custom Activity), then record the child's
// experience. Notes are optional. The activity's skills (Music: What Children Explore) are shown read-only as what
// the activity explores; they are not saved on the record. Saving goes through the same record builder as Mark as Tried.
export function RecordFormPage({ childrenData, childId: initialChild, lockChild, records, save, cancel, t }: {
  childrenData: Child[];
  childId: string;
  // Opened from a child's Activities tab: the child is known and not asked again.
  lockChild: boolean;
  records: LessonRecord[];
  // Resolves to an error message, or null once the record is stored.
  save: (r: RecordInput) => Promise<string | null>;
  cancel: () => void;
  t: Copy;
}) {
  const [choice, setChoice] = useState<Choice>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [childId, setChildId] = useState(initialChild);
  const child = childrenData.find(c => c.id === childId);

  const pick = (c: Choice) => { setChoice(c); window.scrollTo({ top: 0 }); };

  if (!choice) {
    return (
      <main className="form-page picker-page">
        <PageHeader title={t.addActivity} subtitle={lockChild && child ? `${t.recordingFor} ${child.first}` : undefined} back={cancel} />
        <ActivityPicker
          query={query} setQuery={setQuery} category={category} setCategory={setCategory}
          records={records} childId={childId}
          pick={activityId => pick({ activityId })} pickCustom={() => pick({ custom: true })}
          t={t}
        />
      </main>
    );
  }

  return (
    <RecordForm
      key={"activityId" in choice ? choice.activityId : "custom"}
      choice={choice}
      childrenData={childrenData}
      childId={childId}
      setChildId={setChildId}
      lockChild={lockChild}
      change={() => setChoice(undefined)}
      save={save}
      cancel={cancel}
      t={t}
    />
  );
}

function RecordForm({ choice, childrenData, childId, setChildId, lockChild, change, save, cancel, t }: {
  choice: Choice;
  childrenData: Child[];
  childId: string;
  setChildId: (id: string) => void;
  lockChild: boolean;
  change: () => void;
  save: (r: RecordInput) => Promise<string | null>;
  cancel: () => void;
  t: Copy;
}) {
  const activity = "activityId" in choice ? findActivity(choice.activityId) : undefined;
  const a = activity && localizeActivity(activity, t);
  const child = childrenData.find(c => c.id === childId);
  const validChild = isActiveChild(childrenData, childId);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [date, setDate] = useState(localIsoToday());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  // Guards against a double tap storing the same record twice.
  const saving = useRef(false);

  const submit = async () => {
    if (saving.current) return;
    if (!validChild) { setError(t.chooseChildFirst); return; }
    saving.current = true;
    const failure = await save(activity
      ? { childId, date, activityId: activity.id, notes }
      : { childId, date, customTitle: title, customArea: area, notes });
    saving.current = false;
    if (failure) setError(failure);
  };
  const optional = (label: string) => `${label}${t.optionalSuffix}`;

  return (
    <main className="form-page">
      <PageHeader title={t.addActivity} back={change} />
      {child && validChild ? (
        <section className="form-child">
          <ChildPhoto child={child} />
          <span><small>{t.recordingFor.toUpperCase()}</small><strong>{child.first} {child.last}</strong><em>{childAge(child, t)}</em></span>
        </section>
      ) : null}
      <div className="form-fields">
        {!lockChild && (
          <Field label={t.childLabel}>
            <select value={validChild ? childId : ""} onChange={e => { setChildId(e.target.value); setError(""); }} aria-invalid={!validChild}>
              {!validChild && <option value="" disabled>{t.selectChild}</option>}
              {childrenData.map(c => <option value={c.id} key={c.id}>{childOptionLabel(c, childrenData, t)}</option>)}
            </select>
          </Field>
        )}
        {a ? (
          <fieldset>
            <legend>{t.lessonActivityLabel}</legend>
            <div className="plan-activity picked-activity">
              <img src={a.image} alt="" />
              <span><strong>{a.title}</strong><small>{[discoverCategoryLabel(a.area, t), a.age].filter(Boolean).join(" · ")}</small></span>
              <button className="text-action" onClick={change}>{t.changeActivity}</button>
            </div>
          </fieldset>
        ) : (
          <>
            <Field label={t.customActivityNamePrompt}>
              <input value={title} onChange={e => { setTitle(e.target.value); setError(""); }} maxLength={200} />
            </Field>
            <Field label={t.learningArea}>
              <select value={area} onChange={e => { setArea(e.target.value); setError(""); }}>
                <option value="" disabled>{t.chooseArea}</option>
                {catalogCategories().map(c => <option value={c} key={c}>{discoverCategoryLabel(c, t)}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label={t.date}><input type="date" value={date} max={localIsoToday()} onChange={e => e.target.value && setDate(e.target.value)} /></Field>
        {a?.domains.length ? (
          <fieldset>
            <legend>{t.activitySkills}</legend>
            <div className="skill-tags activity-skills">
              {a.domains.map(x => <span key={x}>{x}</span>)}
            </div>
          </fieldset>
        ) : null}
        <Field label={optional(t.notesLabel)}><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder={t.whatDidYouNotice} /></Field>
        {error && <p className="journal-status error" role="alert">{error}</p>}
      </div>
      <div className="form-bottom">
        <button onClick={submit} disabled={!validChild}>{t.save}</button>
        <button onClick={cancel}>{t.cancel}</button>
      </div>
    </main>
  );
}
