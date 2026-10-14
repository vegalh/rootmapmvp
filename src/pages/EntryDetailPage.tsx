import { Icon } from "../components/Icon";
import { useConfirm, useLatest, ChildPhoto } from "../components/ui";
import { fmtLong } from "../lib/dates";
import { photoUrl } from "../lib/photos";
import { entryText } from "../lib/entries";
import type { Child, Entry, Lang } from "../types";
import type { Copy } from "../lib/i18n";

// Full view of a single entry: who it's about, large photos and the complete written memory.
export function EntryDetailPage({ entry, child, lang, back, edit, remove, t }: {
  entry: Entry;
  child?: Child;
  lang: Lang;
  back: () => void;
  edit: () => void;
  remove: () => Promise<void>;
  t: Copy;
}) {
  const text = entryText(entry, lang);
  const confirm = useConfirm();
  const latestRemove = useLatest(remove);
  return (
    <main className="journal-entry">
      <header className="journal-editor-bar">
        <button onClick={back}><Icon name="back" size={18} />{t.back}</button>
        <div>
          <button onClick={edit}>{t.editEntry}</button>
          <button aria-label={t.deleteEntry} onClick={() => confirm({ title: t.confirmDeleteEntry, body: <p>{t.confirmDeleteEntryBody}</p>, confirmLabel: t.deleteEntry, destructive: true, onConfirm: () => latestRemove.current() })}><Icon name="trash" size={18} /></button>
        </div>
      </header>
      {child && (
        <div className="entry-child">
          <ChildPhoto child={child} />
          <span><strong>{child.first} {child.last}</strong><time>{fmtLong(entry.date, lang)}</time></span>
        </div>
      )}
      {!child && <time>{fmtLong(entry.date, lang)}</time>}
      {entry.title && <h1>{entry.title}</h1>}
      {entry.photos.length > 0 && (
        <div className="journal-entry-photos">
          {entry.photos.map((p, i) => <img src={photoUrl(p)} alt="" key={i} />)}
        </div>
      )}
      {text && <p className="journal-entry-text">{text}</p>}
    </main>
  );
}

export default EntryDetailPage;
