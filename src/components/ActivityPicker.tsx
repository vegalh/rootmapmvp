import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { Empty } from "./ui";
import { catalogCategories, findActivity, searchCatalog, type CatalogItem } from "../lib/catalog";
import { recentActivityIds } from "../lib/activityRecords";
import { categoryOptionLabel, localizeActivity, type Copy } from "../lib/i18n";
import type { Activity, LessonRecord } from "../types";

// Rows shown before "Show more", so a large catalog never renders as one endless list.
const PAGE = 30;

// Add Activity, step 1: search-first list of the shared catalog (Discover activities and Music). Query and
// category are owned by the caller so they're kept when the parent comes back from the form.
export default function ActivityPicker({ query, setQuery, category, setCategory, records, childId, pick, pickCustom, t }: {
  query: string;
  setQuery: (q: string) => void;
  category: string;
  setCategory: (c: string) => void;
  records: LessonRecord[];
  childId?: string;
  pick: (activityId: string) => void;
  pickCustom: () => void;
  t: Copy;
}) {
  const [shown, setShown] = useState(PAGE);
  const categories = useMemo(() => ["All", ...catalogCategories({ inUse: true })], []);
  const results = useMemo(() => searchCatalog(query, { category }), [query, category]);
  const recent = useMemo(
    () => recentActivityIds(records, childId).map(id => findActivity(id)!).filter(a => category === "All" || a.category === category),
    [records, childId, category],
  );
  const searching = !!query.trim();

  return (
    <>
      <label className="search discover-search">
        <Icon name="search" size={18} />
        <input value={query} onChange={e => { setQuery(e.target.value); setShown(PAGE); }} placeholder={t.searchActivitiesKeywords} aria-label={t.searchActivitiesKeywords} />
        {searching && <button className="search-clear" onClick={() => setQuery("")} aria-label={t.reset}><Icon name="close" size={16} /></button>}
      </label>
      <div className="category-chips" role="group" aria-label={t.learningArea}>
        {categories.map(c => (
          <button aria-pressed={category === c} className={category === c ? "active" : ""} onClick={() => { setCategory(c); setShown(PAGE); }} key={c}>
            {categoryOptionLabel(c, t)}
          </button>
        ))}
      </div>

      {!searching && recent.length > 0 && (
        <>
          <div className="section-title"><h2>{t.recentlyUsed}</h2></div>
          <div className="picker-list">{recent.map(a => <PickerRow activity={a} pick={pick} t={t} key={a.id} />)}</div>
        </>
      )}

      <div className="section-title"><h2>{t.browseActivities}</h2><span>{results.length} {t.activitiesCount}</span></div>
      {results.length ? (
        <div className="picker-list">{results.slice(0, shown).map(a => <PickerRow activity={a} pick={pick} t={t} key={a.id} />)}</div>
      ) : (
        <Empty text={t.noResults} />
      )}
      {results.length > shown && <button className="reset-link picker-more" onClick={() => setShown(shown + PAGE)}>{t.showMore}</button>}

      <button className="picker-custom" onClick={pickCustom}><Icon name="plus" size={18} />{t.otherCustomActivity}</button>
    </>
  );
}

// A compact catalog row: thumbnail, title, category and age.
function PickerRow({ activity, pick, t }: { activity: Activity | CatalogItem; pick: (id: string) => void; t: Copy }) {
  const a = localizeActivity(activity, t);
  return (
    <button className="picker-row" onClick={() => pick(a.id)}>
      <img src={a.image} alt="" />
      <span><strong>{a.title}</strong><small>{[categoryOptionLabel(a.category, t), a.age].filter(Boolean).join(" · ")}</small></span>
      <Icon name="chevron" size={15} />
    </button>
  );
}
