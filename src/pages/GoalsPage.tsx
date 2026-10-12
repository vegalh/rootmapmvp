import { useState } from "react";
import { readSetting } from "../lib/data/store";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/ui";
import type { Goal } from "../types";
import type { Copy } from "../lib/i18n";

// The parent's own lightweight intentions list. Separate from any child data.
export function GoalsPage({ goals, setGoals, back, openNotes, t }: {
  goals: Goal[];
  setGoals: (g: Goal[]) => void;
  back: () => void;
  // Opens the legacy "My Notes" pad, which still holds planning notes written before My Goals.
  openNotes: () => void;
  t: Copy;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const active = goals.filter(g => !g.completed);
  const completed = goals.filter(g => g.completed).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  const hasLegacyNotes = Boolean(readSetting("rootmap-personal-notes", "").trim());

  const toggle = (g: Goal) =>
    setGoals(goals.map(x => (x.id === g.id ? { ...x, completed: !x.completed, completedAt: x.completed ? undefined : new Date().toISOString() } : x)));
  const update = (id: string, title: string, description: string) => {
    setGoals(goals.map(x => (x.id === id ? { ...x, title, description: description || undefined } : x)));
    setEditing(null);
  };
  const remove = (id: string) => {
    if (!window.confirm(t.confirmDeleteGoal)) return;
    setGoals(goals.filter(x => x.id !== id));
    setEditing(null);
  };

  const row = (g: Goal) =>
    editing === g.id ? (
      <GoalForm key={g.id} initial={g} submitLabel={t.save} onSubmit={(title, d) => update(g.id, title, d)} onCancel={() => setEditing(null)} onDelete={() => remove(g.id)} t={t} />
    ) : (
      <div className={`goal-row ${g.completed ? "done" : ""}`} key={g.id}>
        <button className="goal-check" role="checkbox" aria-checked={g.completed} aria-label={g.completed ? t.reopenGoal : t.completeGoal} onClick={() => toggle(g)}>
          {g.completed && <Icon name="check" size={16} />}
        </button>
        <button className="goal-body" aria-label={`${t.editGoal}: ${g.title}`} onClick={() => { setAdding(false); setEditing(g.id); }}>
          <strong>{g.title}</strong>
          {g.description && <small>{g.description}</small>}
        </button>
      </div>
    );

  return (
    <main className="simple-page goals-page">
      <PageHeader title={t.myGoals} subtitle={t.goalsSubtitle} back={back} />
      {adding ? (
        <GoalForm
          submitLabel={t.addGoal}
          onSubmit={(title, description) => {
            setGoals([{ id: `g-${Date.now()}`, title, description: description || undefined, completed: false, createdAt: new Date().toISOString() }, ...goals]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
          t={t}
        />
      ) : (
        <button className="wide-primary goals-add" onClick={() => { setEditing(null); setAdding(true); }}><Icon name="plus" size={18} />{t.addGoal}</button>
      )}

      {goals.length === 0 && !adding && <p className="journal-empty">{t.noGoals}</p>}

      {goals.length > 0 && (
        <section className="goal-section">
          <h3>{t.activeGoals}</h3>
          {active.length ? <div className="goal-list">{active.map(row)}</div> : <p className="goal-none">{t.noActiveGoals}</p>}
        </section>
      )}
      {completed.length > 0 && (
        <section className="goal-section">
          <h3>{t.completed} · {completed.length}</h3>
          <div className="goal-list">{completed.map(row)}</div>
        </section>
      )}

      {hasLegacyNotes && (
        <button className="goals-legacy" onClick={openNotes}><Icon name="note" size={18} /><span>{t.earlierPersonalNotes}</span><Icon name="chevron" size={16} /></button>
      )}
    </main>
  );
}

function GoalForm({ initial, submitLabel, onSubmit, onCancel, onDelete, t }: {
  initial?: Goal;
  submitLabel: string;
  onSubmit: (title: string, description: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
  t: Copy;
}) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const submit = () => title.trim() && onSubmit(title.trim(), description.trim());
  return (
    <form className="goal-form" onSubmit={e => { e.preventDefault(); submit(); }}>
      <label>
        <span>{initial ? t.editGoal : t.goalTitleLabel}</span>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder={t.goalTitlePlaceholder} />
      </label>
      <label>
        <span>{t.goalDescriptionLabel}</span>
        <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder={t.goalDescriptionPlaceholder} />
      </label>
      <div className="goal-form-actions">
        {onDelete && <button type="button" className="goal-delete" onClick={onDelete}><Icon name="trash" size={16} />{t.deleteGoal}</button>}
        <button type="button" onClick={onCancel}>{t.cancel}</button>
        <button type="submit" className="goal-submit" disabled={!title.trim()}>{submitLabel}</button>
      </div>
    </form>
  );
}

export default GoalsPage;
