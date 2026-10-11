import { useState } from "react";
import { PageHeader, Field } from "../components/ui";
import { areaLessons } from "../data/progress";
import type { Area, Child, LessonRecord, Stage } from "../types";
import { childAge, lessonLabel, recordAreaLabel, skillLabel, stageLabel, type Copy } from "../lib/i18n";

export function RecordFormPage({ child, save, cancel, t }: {
  child: Child;
  save: (r: Omit<LessonRecord, "id" | "childId">) => void;
  cancel: () => void;
  t: Copy;
}) {
  const [area, setArea] = useState<Area>("Practical Life");
  const [lesson, setLesson] = useState("Pouring Water");
  const [date, setDate] = useState("2026-10-08");
  const [stage, setStage] = useState<Stage>("Practicing");
  const [notes, setNotes] = useState(t.defaultRecordNoteTemplate.replace("{name}", child.first));
  const [skills, setSkills] = useState<string[]>(["Concentration"]);

  const changeArea = (a: Area) => { setArea(a); setLesson(areaLessons[a][0]); };

  return (
    <main className="form-page">
      <PageHeader title={t.recordLesson} back={cancel} />
      <section className="form-child">
        <img src={child.photo} alt="" />
        <span><small>{t.recordingFor.toUpperCase()}</small><strong>{child.first} {child.last}</strong><em>{childAge(child, t)}</em></span>
      </section>
      <div className="form-fields">
        <Field label={t.learningArea}>
          <select value={area} onChange={e => changeArea(e.target.value as Area)}>{Object.keys(areaLessons).map(x => <option value={x} key={x}>{recordAreaLabel(x, t)}</option>)}</select>
        </Field>
        <Field label={t.lessonActivityLabel}>
          <select value={lesson} onChange={e => setLesson(e.target.value)}>{areaLessons[area].map(x => <option value={x} key={x}>{lessonLabel(x, t)}</option>)}</select>
        </Field>
        <Field label={t.date}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <fieldset>
          <legend>{t.learningStage}</legend>
          <div className="stage-choices">
            {(["Introduced", "Practicing", "Independent"] as Stage[]).map(x => (
              <button className={stage === x ? "active" : ""} onClick={() => setStage(x)} key={x}>{stageLabel(x, t)}</button>
            ))}
          </div>
        </fieldset>
        <Field label={t.observationNotesLabel}><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} /></Field>
        <fieldset>
          <legend>{t.skillsObserved}</legend>
          <div className="chips">
            {["Hand-eye coordination", "Concentration", "Independence", "Fine motor control", "Order"].map(x => (
              <button className={skills.includes(x) ? "active" : ""} onClick={() => setSkills(skills.includes(x) ? skills.filter(y => y !== x) : [...skills, x])} key={x}>{skillLabel(x, t)}</button>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="form-bottom">
        <button onClick={() => save({ area, lesson, date, stage, notes, skills })}>{t.save}</button>
        <button onClick={cancel}>{t.cancel}</button>
      </div>
    </main>
  );
}
