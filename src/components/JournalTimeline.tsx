import { useState } from "react";
import { Icon } from "./Icon";
import { draftKey, readDraft } from "../lib/journalDrafts";
import { fmtMonthDay, fmtMonthYear } from "../lib/dates";
import type { Child, JournalEntry, Lang } from "../types";
import type { Copy } from "../lib/i18n";

// Reverse-chronological, month-grouped diary for one child, shown in the child profile's Journal tab.
export function JournalTimeline({ child, entries, lang, open, write, importNotes, t }: {
  child: Child;
  entries: JournalEntry[];
  lang: Lang;
  open: (id: string) => void;
  // Opens the editor for a new entry (restoring any unfinished draft).
  write: () => void;
  importNotes: () => void;
  t: Copy;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const mine = entries
    .filter(e => e.childId === child.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const shown = q ? mine.filter(e => `${e.title || ""}\n${e.text || ""}`.toLowerCase().includes(q)) : mine;

  const groups: [string, JournalEntry[]][] = [];
  for (const e of shown) {
    const month = e.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last[0] === month) last[1].push(e);
    else groups.push([month, [e]]);
  }

  const draft = readDraft(draftKey(child.id));
  // Legacy `child.notes` stays untouched; offer it until it has been copied into the journal once.
  const legacyNotes = child.notes?.trim() && !mine.some(e => e.fromNotes) ? child.notes.trim() : "";

  return (
    <div className="journal">
      <div className="journal-head">
        <h2>{t.journalOf.replace("{name}", child.first)}</h2>
        <button className="icon-button" aria-label={t.searchJournal} aria-pressed={searching} onClick={() => { setSearching(!searching); setQuery(""); }}>
          <Icon name={searching ? "close" : "search"} />
        </button>
      </div>
      {searching && (
        <label className="search journal-search">
          <Icon name="search" size={18} />
          <input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t.journalSearchPlaceholder} aria-label={t.searchJournal} />
        </label>
      )}
      {!searching && (
        draft ? (
          <button className="journal-draft" onClick={write}>
            <span><small>{t.unfinishedEntry}</small><strong>{draft.title.trim() || draft.text.trim().slice(0, 60) || fmtMonthDay(draft.date, lang)}</strong></span>
            <b>{t.continueWriting}</b>
          </button>
        ) : (
          <button className="wide-primary journal-write" onClick={write}><Icon name="plus" size={18} />{t.writeEntry}</button>
        )
      )}

      {mine.length === 0 && !legacyNotes && <p className="journal-empty">{t.journalEmpty}</p>}
      {q && shown.length === 0 && <p className="journal-empty">{t.journalNoResults}</p>}

      {groups.map(([month, list]) => (
        <section className="journal-month" key={month}>
          <h3>{fmtMonthYear(`${month}-01`, lang)}</h3>
          {list.map(e => (
            <button className="journal-card" onClick={() => open(e.id)} key={e.id}>
              <time>{fmtMonthDay(e.date, lang)}</time>
              {e.photos.length > 0 && (
                <span className="journal-card-photo">
                  <img src={e.photos[0]} alt="" loading="lazy" />
                  {e.photos.length > 1 && <em>+{e.photos.length - 1}</em>}
                </span>
              )}
              {e.title && <strong>{e.title}</strong>}
              {e.text && <p>{e.text}</p>}
            </button>
          ))}
        </section>
      ))}

      {legacyNotes && !q && (
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

export default JournalTimeline;
