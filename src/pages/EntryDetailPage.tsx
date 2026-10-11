import { Icon } from "../components/Icon";
import { fmtLong } from "../lib/dates";
import type { JournalEntry, Lang } from "../types";
import type { Copy } from "../lib/i18n";

// Full view of a single journal entry: large photos and the complete written memory.
export function JournalEntryPage({ entry, lang, back, edit, remove, t }: {
  entry: JournalEntry;
  lang: Lang;
  back: () => void;
  edit: () => void;
  remove: () => void;
  t: Copy;
}) {
  return (
    <main className="journal-entry">
      <header className="journal-editor-bar">
        <button onClick={back}><Icon name="back" size={18} />{t.back}</button>
        <div>
          <button onClick={edit}>{t.editEntry}</button>
          <button aria-label={t.deleteEntry} onClick={() => { if (window.confirm(t.confirmDeleteEntry)) remove(); }}><Icon name="trash" size={18} /></button>
        </div>
      </header>
      <time>{fmtLong(entry.date, lang)}</time>
      {entry.title && <h1>{entry.title}</h1>}
      {entry.photos.length > 0 && (
        <div className="journal-entry-photos">
          {entry.photos.map((p, i) => <img src={p} alt="" key={i} />)}
        </div>
      )}
      {entry.text && <p className="journal-entry-text">{entry.text}</p>}
    </main>
  );
}

export default JournalEntryPage;
