import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

// A card/highlight's header: one child shows an avatar and their full name, as every entry always has. Several
// children — a moment shared by siblings, merged for display by `mergeShared` — show small overlapping avatars
// (`.entry-child.together`) and first names joined by `t.nameJoin` ("Anan, Lele" / "安安、乐乐"). `time` is any
// trailing node (a `<time>`, usually) shown after the name(s), exactly where it always has been.
export function EntryChildren({ ids, childrenData, time, t }: { ids: string[]; childrenData: Child[]; time?: ReactNode; t: Copy }) {
  const kids = childrenData.filter(c => ids.includes(c.id));
  if (!kids.length) return null;
  if (kids.length === 1) {
    const c = kids[0];
    return (
      <span className="entry-child">
        <ChildPhoto child={c} />
        <span><strong>{c.first} {c.last}</strong>{time}</span>
      </span>
    );
  }
  return (
    <span className="entry-child together">
      {kids.map(c => <ChildPhoto child={c} key={c.id} />)}
      <span><strong>{kids.map(c => c.first).join(t.nameJoin)}</strong>{time}</span>
    </span>
  );
}

// Search toggle + field used above both timelines. Closing the search clears it.
export function SearchToggle({ searching, setSearching, setQuery, t }: { searching: boolean; setSearching: (on: boolean) => void; setQuery: (q: string) => void; t: Copy }) {
  return (
    <button className="icon-button" aria-label={t.search} aria-pressed={searching} onClick={() => { setSearching(!searching); setQuery(""); }}>
      <Icon name={searching ? "close" : "search"} />
    </button>
  );
}

export function SearchField({ query, setQuery, t }: { query: string; setQuery: (q: string) => void; t: Copy }) {
  return (
    <label className="search journal-search">
      <Icon name="search" size={18} />
      <input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t.journalSearchPlaceholder} aria-label={t.search} />
    </label>
  );
}

// Revealed up front, then grown by this many as the parent scrolls near the end (see the sentinel below). Kept
// well above a screenful so nothing above the fold ever shows a visible "loading" gap.
const INITIAL_REVEAL = 60;
const REVEAL_STEP = 60;

// Reverse-chronological, month-grouped list of entries. Moments shows every child (`childrenData` given,
// so each card names its child); a child's Journal passes only that child's entries and omits it.
//
// A family with years of memories can have thousands of entries; rendering every card up front (and keeping it
// all in the DOM) is the slowest part of opening Moments/Journal and the main cost of scrolling through it.
// Instead only the first `INITIAL_REVEAL` cards are rendered, growing by `REVEAL_STEP` as an off-screen sentinel
// scrolls into view — same cards, same order, same look, just built incrementally.
export function EntryTimeline({ entries, childrenData, childrenOf, lang, open, t }: {
  // Already filtered and sorted newest first.
  entries: Entry[];
  childrenData?: Child[];
  // Entries merged by `mergeShared`: the group's children, keyed by the kept entry's id. Omitted ids fall back to
  // the entry's own (single) childId.
  childrenOf?: Map<string, string[]>;
  lang: Lang;
  open: (id: string) => void;
  t: Copy;
}) {
  const [revealed, setRevealed] = useState(INITIAL_REVEAL);
  // A new filter/search/child selection is a fresh list; start over from the top instead of keeping a stale count.
  // Scrolling back to the top too (before paint, so it isn't seen mid-scroll) matters here: without it, a parent
  // already scrolled deep into a long list would stay there as the page shrinks under them, and the browser's own
  // scroll clamping can land the sentinel right in view and silently reveal further batches at once.
  useLayoutEffect(() => { setRevealed(INITIAL_REVEAL); window.scrollTo(0, 0); }, [entries]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = revealed < entries.length;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setRevealed(n => n + REVEAL_STEP); }, { rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore]);
  const visible = entries.length > revealed ? entries.slice(0, revealed) : entries;

  return (
    <>
      {groupByMonth(visible).map(([month, list]) => (
        <section className="journal-month" key={month}>
          <h3>{fmtMonthYear(`${month}-01`, lang)}</h3>
          {list.map(e => {
            const ids = childrenOf?.get(e.id) ?? [e.childId];
            const header = childrenData && (
              <EntryChildren ids={ids} childrenData={childrenData} time={<time>{fmtDayMonth(e.date, lang)}</time>} t={t} />
            );
            const text = entryText(e, lang);
            return (
              <button className="journal-card" onClick={() => open(e.id)} key={e.id}>
                {header || <time>{fmtDayMonth(e.date, lang)}</time>}
                {e.photos.length > 0 && <EntryPhotos photos={e.photos} />}
                {e.title && <strong>{e.title}</strong>}
                {text && <p>{text}</p>}
              </button>
            );
          })}
        </section>
      ))}
      {hasMore && <div ref={sentinelRef} aria-hidden="true" className="journal-timeline-sentinel" />}
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
