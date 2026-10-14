import { Icon } from "./Icon";
import { entryText, groupByMonth } from "../lib/entries";
import { fmtMonthDay, fmtMonthYear } from "../lib/dates";
import { photoUrl } from "../lib/photos";
import type { Child, Entry, EntryDraft, Lang } from "../types";
import type { Copy } from "../lib/i18n";
import { childPhotoSrc } from "../lib/children";

// The add action shared by Moments and Journal: offers to continue an unfinished draft when one exists.
export function WriteButton({ label, draft, write, lang, t }: { label: string; draft?: EntryDraft; write: () => void; lang: Lang; t: Copy }) {
  if (!draft) return <button className="wide-primary journal-write" onClick={write}><Icon name="plus" size={18} />{label}</button>;
  return (
    <button className="journal-draft" onClick={write}>
      <span><small>{t.unfinishedEntry}</small><strong>{draft.title.trim() || draft.text.trim().slice(0, 60) || fmtMonthDay(draft.date, lang)}</strong></span>
      <b>{t.continueWriting}</b>
    </button>
  );
}

// Search toggle + field used above both timelines.
export function SearchField({ query, setQuery, t }: { query: string; setQuery: (q: string) => void; t: Copy }) {
  return (
    <label className="search journal-search">
      <Icon name="search" size={18} />
      <input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t.journalSearchPlaceholder} aria-label={t.search} />
    </label>
  );
}

// Reverse-chronological, month-grouped list of entries. Moments shows every child (`childrenData` given,
// so each card names its child); a child's Journal passes only that child's entries and omits it.
export function EntryTimeline({ entries, childrenData, lang, open }: {
  // Already filtered and sorted newest first.
  entries: Entry[];
  childrenData?: Child[];
  lang: Lang;
  open: (id: string) => void;
}) {
  return (
    <>
      {groupByMonth(entries).map(([month, list]) => (
        <section className="journal-month" key={month}>
          <h3>{fmtMonthYear(`${month}-01`, lang)}</h3>
          {list.map(e => {
            const c = childrenData?.find(x => x.id === e.childId);
            const text = entryText(e, lang);
            return (
              <button className="journal-card" onClick={() => open(e.id)} key={e.id}>
                {c ? (
                  <span className="entry-child">
                    <img src={childPhotoSrc(c)} alt="" />
                    <span><strong>{c.first} {c.last}</strong><time>{fmtMonthDay(e.date, lang)}</time></span>
                  </span>
                ) : (
                  <time>{fmtMonthDay(e.date, lang)}</time>
                )}
                {e.photos.length > 0 && (
                  <span className="journal-card-photo">
                    <img src={photoUrl(e.photos[0])} alt="" loading="lazy" />
                    {e.photos.length > 1 && <em>+{e.photos.length - 1}</em>}
                  </span>
                )}
                {e.title && <strong>{e.title}</strong>}
                {text && <p>{text}</p>}
              </button>
            );
          })}
        </section>
      ))}
    </>
  );
}

export default EntryTimeline;
