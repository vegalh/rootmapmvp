import { useState } from "react";
import { PageHeader } from "../components/ui";
import { Icon } from "../components/Icon";
import { ChildFilter, EntryTimeline, SearchField, WriteButton } from "../components/EntryTimeline";
import { latestNewDraft } from "../lib/journalDrafts";
import { matchesQuery, newestFirst } from "../lib/entries";
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
  const known = childrenData.map(c => c.id);
  const filter = childFilter === "All" || known.includes(childFilter) ? childFilter : "All";
  const mine = entries.filter(e => (filter === "All" ? known.includes(e.childId) : e.childId === filter)).sort(newestFirst);
  const shown = mine.filter(e => matchesQuery(e, query));
  const pending = latestNewDraft(filter === "All" ? known : [filter]);

  return (
    <main className="page-content moments-page">
      <PageHeader title={t.observations} subtitle={t.momentsSubtitle} back={back} />
      <div className="moments-controls">
        {/* With one child there is nothing to choose. */}
        {childrenData.length > 1 ? <ChildFilter value={filter} onChange={setChildFilter} childrenData={childrenData} t={t} /> : <span className="moments-controls-fill" />}
        <button className="icon-button" aria-label={t.search} aria-pressed={searching} onClick={() => { setSearching(!searching); setQuery(""); }}>
          <Icon name={searching ? "close" : "search"} />
        </button>
      </div>
      {searching && <SearchField query={query} setQuery={setQuery} t={t} />}
      {!searching && childrenData.length > 0 && (
        <WriteButton label={t.addMoment} draft={pending?.draft} write={() => write(pending?.childId ?? (filter === "All" ? undefined : filter))} lang={lang} t={t} />
      )}

      {mine.length > 0 && !searching && (
        <button className="today-more moments-week-link" onClick={() => openRecap(filter === "All" ? undefined : filter)}>{t.recapFromMoments}<Icon name="chevron" size={15} /></button>
      )}
      {mine.length === 0 && !searching && <p className="journal-empty">{t.momentsEmpty}</p>}
      {searching && query.trim() && shown.length === 0 && <p className="journal-empty">{t.journalNoResults}</p>}
      <EntryTimeline entries={shown} childrenData={childrenData} lang={lang} open={open} />
    </main>
  );
}

export default MomentsPage;
