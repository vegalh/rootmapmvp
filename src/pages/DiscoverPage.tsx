import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, FilterPill, Empty } from "../components/ui";
import BooksBrowser from "../components/BooksBrowser";
import CollectionCard from "../components/CollectionCard";
import { ACTIVITY_SETTINGS, MATERIAL_TYPES, activityAgeRanges, ageOptionsFor, ageTagLabel, buildsDomains, catalogCategories, catalogItems, childAgeRanges, filterDiscoverActivities, findMusic, suitableFirst } from "../lib/catalog";
import { childShortName } from "../lib/children";
import { collectionImages, shownCollections } from "../lib/collections";
import type { Activity, Child } from "../types";
import { ageOptionLabel, categoryOptionLabel, localizeActivity, materialsOptionLabel, settingOptionLabel, type Copy } from "../lib/i18n";

type OpenFilter = "setting" | "age" | "category" | "materials" | null;

export type DiscoverTab = "activities" | "books" | "collections";

// Discover: Activities (the default; activities and music together) and Books. Music cards open through `open`
// like activities do, onto the music page with its audio player.
export function DiscoverPage({ tab, setTab, saved, toggleSaved, open, openBook, openCollection, childrenData, t }: {
  tab: DiscoverTab;
  // The family's children: their ages suggest an age filter and put suitable activities first.
  childrenData: Child[];
  setTab: (tab: DiscoverTab) => void;
  saved: string[];
  toggleSaved: (id: string) => void;
  open: (id: string) => void;
  openBook: (id: string) => void;
  openCollection: (id: string) => void;
  t: Copy;
}) {
  const tabs: [DiscoverTab, string][] = [["activities", t.tabActivities], ["books", t.tabBooks], ["collections", t.tabCollections]];
  const subtitle = tab === "books" ? t.booksSubtitle : tab === "collections" ? t.collectionsSubtitle : t.discoverSubtitle;
  return (
    <main className="page-content discover-page">
      <PageHeader title={t.discover} subtitle={subtitle} />
      <div className="segmented discover-tabs" role="tablist">
        {tabs.map(([x, l]) => (
          <button role="tab" aria-selected={tab === x} className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{l}</button>
        ))}
      </div>
      {tab === "activities" && <ActivitiesBrowser saved={saved} toggleSaved={toggleSaved} open={open} childrenData={childrenData} t={t} />}
      {tab === "books" && <BooksBrowser openBook={openBook} t={t} />}
      {/* RootMap's collections, one under another. */}
      {tab === "collections" && (
        <div className="collection-list" aria-label={t.collectionsHeading}>
          {collections.map(c => <CollectionCard collection={c} image={collectionPictures.get(c.id)} open={openCollection} t={t} key={c.id} />)}
        </div>
      )}
    </main>
  );
}

// Everything listed: activities, then music. Filter options that have something in them, in the usual order (an
// option with nothing in it isn't offered).
const items = catalogItems();
const settingOptions = ["All", ...ACTIVITY_SETTINGS.filter(s => items.some(a => a.settings?.includes(s)))];
const ageOptions = ageOptionsFor(items.map(activityAgeRanges));
const categoryOptions = ["All", ...catalogCategories({ inUse: true })];
const materialsOptions = ["All", ...MATERIAL_TYPES.filter(m => items.some(a => a.materialType === m))];
// Collections are worked out once per page load (the autumn one depends on the month).
const collections = shownCollections();
const collectionPictures = collectionImages(collections);

function ActivitiesBrowser({ saved, toggleSaved, open, childrenData, t }: { saved: string[]; toggleSaved: (id: string) => void; open: (id: string) => void; childrenData: Child[]; t: Copy }) {
  const [q, setQ] = useState("");
  const [setting, setSetting] = useState("All");
  const [age, setAge] = useState("All Ages");
  const [category, setCategory] = useState("All");
  const [materials, setMaterials] = useState("All");
  const [openFilter, setOpenFilter] = useState<OpenFilter>(null);
  // Each child's age filter. Suggestions only: every activity stays a tap away.
  const childRanges = childAgeRanges(childrenData);
  const found = filterDiscoverActivities(items, { q, setting, age, category, materials });
  const filtered = setting !== "All" || age !== "All Ages" || category !== "All" || materials !== "All";
  const resetFilters = () => { setSetting("All"); setAge("All Ages"); setCategory("All"); setMaterials("All"); };
  // Activities that suit one of the children come first; the order is otherwise unchanged.
  const result = age === "All Ages" ? suitableFirst(found, childrenData) : found;
  return (
    <>
      <label className="search discover-search"><Icon name="search" size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchActivities} /></label>
      <div className="filter-row">
        <FilterPill
          label={t.setting} value={setting} defaultValue="All" onChange={setSetting}
          options={settingOptions} renderLabel={v => settingOptionLabel(v, t)}
          columns={2} isOpen={openFilter === "setting"} onOpenChange={o => setOpenFilter(o ? "setting" : null)}
        />
        <FilterPill
          label={t.age} value={age} defaultValue="All Ages" onChange={setAge}
          options={ageOptions} renderLabel={v => ageOptionLabel(v, t)}
          columns={1} isOpen={openFilter === "age"} onOpenChange={o => setOpenFilter(o ? "age" : null)}
        />
        <FilterPill
          label={t.category} value={category} defaultValue="All" onChange={setCategory}
          options={categoryOptions} renderLabel={v => categoryOptionLabel(v, t)}
          columns={1} isOpen={openFilter === "category"} onOpenChange={o => setOpenFilter(o ? "category" : null)}
        />
        <FilterPill
          label={t.materialsFilter} value={materials} defaultValue="All" onChange={setMaterials}
          options={materialsOptions} renderLabel={v => materialsOptionLabel(v, t)}
          columns={1} isOpen={openFilter === "materials"} onOpenChange={o => setOpenFilter(o ? "materials" : null)}
        />
      </div>
      {childRanges.length > 0 && (
        <div className="age-suggestions" aria-label={t.forYourChildren}>
          <span>{t.forYourChildren}</span>
          {childRanges.map(({ child, range }) => (
            <button
              key={child.id}
              className={age === range ? "active" : ""}
              aria-pressed={age === range}
              onClick={() => setAge(age === range ? "All Ages" : range)}
            >{childShortName(child, childrenData)} · {ageOptionLabel(range, t)}</button>
          ))}
        </div>
      )}
      {filtered && <button className="reset-link" onClick={resetFilters}>{t.reset}</button>}
      <div className="section-title"><h2>{t.exploreActivities}</h2><span>{result.length} {t.activitiesCount}</span></div>
      <div className="activity-grid">
        {result.map(a => <ActivityCard activity={a} saved={saved.includes(a.id)} toggleSaved={toggleSaved} open={open} t={t} key={a.id} />)}
      </div>
      {!result.length && (
        <Empty text={filtered || q ? t.noMatchingActivities : t.noResults}>
          {(filtered || q) && <button className="reset-link" onClick={() => { resetFilters(); setQ(""); }}>{t.clearFilters}</button>}
        </Empty>
      )}
    </>
  );
}

export function ActivityCard({ activity: rawActivity, saved, toggleSaved, open, t }: { activity: Activity; saved: boolean; toggleSaved: (id: string) => void; open: (id: string) => void; t: Copy }) {
  const a = localizeActivity(rawActivity, t);
  const music = findMusic(a.id);
  const category = categoryOptionLabel(a.category, t);
  const lang = t.code === "zh" ? "zh" : "en";
  const builds = buildsDomains(rawActivity, lang);
  const materials = a.materialType === "none" ? t.factNothingNeeded : a.materialType === "everyday" ? t.factAtHome : a.materialsLabel;
  return (
    <article className={`activity-card ${music ? "music-card" : ""}`}>
      <button className="activity-image" onClick={() => open(a.id)}>
        <img src={a.image} alt="" /><span>{category}</span>
        {music && <i className="music-play"><Icon name={music.audioSrc ? "play" : "music"} size={16} filled={!!music.audioSrc} /></i>}
      </button>
      <div>
        <button className="activity-name" onClick={() => open(a.id)}>{a.title}</button>
        <button className={`heart ${saved ? "saved" : ""}`} onClick={() => toggleSaved(a.id)} aria-pressed={saved} aria-label={(saved ? t.unsaveActivityLabel : t.saveActivityLabel).replace("{title}", a.title)}><Icon name="heart" size={18} filled={saved} /></button>
        {builds.length > 0 && <p className="activity-builds">{t.buildsLabel}{builds.join(" · ")}</p>}
        <ul className="activity-facts">
          <li><Icon name="clock" size={12} />{lang === "zh" ? `${a.minutes}${t.min}` : `${a.minutes} ${t.min}`}</li>
          <li>{ageTagLabel(rawActivity, lang)}</li>
          <li><Icon name="layers" size={12} />{materials}</li>
        </ul>
      </div>
    </article>
  );
}
