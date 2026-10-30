import { useMemo, useState } from "react";
import { PageHeader } from "../components/ui";
import { Icon } from "../components/Icon";
import { ChildFilter, EntryTimeline, SearchField, SearchToggle, WriteButton } from "../components/EntryTimeline";
import { latestNewDraft } from "../lib/journalDrafts";
import { matchesQuery, mergeShared, newestFirst } from "../lib/entries";
import type { Child, Entry, Lang } from "../types";
import type { Copy } from "../lib/i18n";

// Main timeline of every child's entries, the same collection each child's Journal reads from.
export function MomentsPage({ entries, childrenData, childFilter, setChildFilter, lang, open, write, openRecap, back, t }: {
  entries: Entry[];
  childrenData: Child[];
  // "All" or a child id; owned by App so it survives opening an entry.
  childFilter: string;
  setChildFilter: (v: string) => void;
  lang: Lang;
  open: (id: string) => void;
  // Opens the editor for a new entry, preselecting `childId` (e.g. to continue its draft).
  write: (childId?: string) => void;
  // The weekly recap, narrowed to the child shown here (if any).
  openRecap: (childId?: string) => void;
  back: () => void;
  t: Copy;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // childrenData.map/includes is cheap, but re-filtering and re-sorting every entry on each keystroke or
  // unrelated re-render adds up once a family has years of Moments; only recompute when the real inputs change.
  const known = useMemo(() => childrenData.map(c => c.id), [childrenData]);
  const filter = childFilter === "All" || known.includes(childFilter) ? childFilter : "All";
  const mine = useMemo(
    () => entries.filter(e => (filter === "All" ? known.includes(e.childId) : e.childId === filter)).sort(newestFirst),
    [entries, known, filter],
  );
  // With every child shown, a moment saved for several children is one card naming them all; one child's
  // filter shows that child's own copy.
  const shown = useMemo(() => {
    const matching = mine.filter(e => matchesQuery(e, query));
    return filter === "All" ? mergeShared(matching) : { entries: matching, childrenOf: undefined };
  }, [mine, query, filter]);
  const pending = latestNewDraft(filter === "All" ? known : [filter]);

  return (
    <main className="page-content moments-page">
      <PageHeader title={t.observations} subtitle={t.momentsSubtitle} back={back} />
      <div className="moments-controls">
        {/* With one child there is nothing to choose. */}
        {childrenData.length > 1 ? <ChildFilter value={filter} onChange={setChildFilter} childrenData={childrenData} t={t} /> : <span className="moments-controls-fill" />}
        <SearchToggle searching={searching} setSearching={setSearching} setQuery={setQuery} t={t} />
      </div>
      {searching && <SearchField query={query} setQuery={setQuery} t={t} />}
      {!searching && childrenData.length > 0 && (
        <WriteButton label={t.addMoment} draft={pending?.draft} write={() => write(pending?.childId ?? (filter === "All" ? undefined : filter))} lang={lang} t={t} />
      )}

      {mine.length > 0 && !searching && (
        <button className="today-more moments-week-link" onClick={() => openRecap(filter === "All" ? undefined : filter)}>{t.recapFromMoments}<Icon name="chevron" size={15} /></button>
      )}
      {mine.length === 0 && !searching && <p className="journal-empty">{t.momentsEmpty}</p>}
      {searching && query.trim() && shown.entries.length === 0 && <p className="journal-empty">{t.journalNoResults}</p>}
      <EntryTimeline entries={shown.entries} childrenData={childrenData} childrenOf={shown.childrenOf} lang={lang} open={open} t={t} />
    </main>
  );
}

export default MomentsPage;
