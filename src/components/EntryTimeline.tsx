import { Icon } from "./Icon";
import { ChildPhoto } from "./ui";
import { entryText, groupByMonth } from "../lib/entries";
import { fmtDayMonth, fmtMonthDay, fmtMonthYear } from "../lib/dates";
import { photoUrl } from "../lib/photos";
import { childShortName } from "../lib/children";
import type { Child, Entry, EntryDraft, Lang } from "../types";
import type { Copy } from "../lib/i18n";

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

// Which child's Moments to show: "All" or one child, each with their avatar so the right one is found at a glance.
// Used by Moments and the weekly recap; one-child families don't need it.
export function ChildFilter({ value, onChange, childrenData, allValue = "All", t }: { value: string; onChange: (v: string) => void; childrenData: Child[]; allValue?: string; t: Copy }) {
  return (
    <div className="child-chips" role="group" aria-label={t.filterChildren}>
      <button data-child={allValue} className={value === allValue ? "active" : ""} aria-pressed={value === allValue} onClick={() => onChange(allValue)}>{t.allChildren}</button>
      {childrenData.map(c => (
        <button data-child={c.id} key={c.id} className={value === c.id ? "active" : ""} aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
          <ChildPhoto child={c} />{childShortName(c, childrenData)}
        </button>
      ))}
    </div>
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
                    <ChildPhoto child={c} />
                    <span><strong>{c.first} {c.last}</strong><time>{fmtDayMonth(e.date, lang)}</time></span>
                  </span>
                ) : (
                  <time>{fmtDayMonth(e.date, lang)}</time>
                )}
                {e.photos.length > 0 && <EntryPhotos photos={e.photos} />}
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

// Up to three of a Moment's photos (one large, the others beside it), with how many more there are.
export function EntryPhotos({ photos }: { photos: string[] }) {
  const shown = photos.slice(0, 3);
  return (
    <span className={`journal-card-photo n${shown.length}`}>
      {shown.map((p, i) => <img src={photoUrl(p)} alt="" loading="lazy" key={i} />)}
      {photos.length > 3 && <em>+{photos.length - 3}</em>}
    </span>
  );
}

export default EntryTimeline;
