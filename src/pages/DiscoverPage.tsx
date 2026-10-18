import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, FilterPill, Empty } from "../components/ui";
import BooksBrowser from "../components/BooksBrowser";
import { ACTIVITY_SETTINGS, MATERIAL_TYPES, activityAgeRanges, ageOptionsFor, ageRangeForYears, catalogCategories, catalogItems, filterDiscoverActivities, findMusic } from "../lib/catalog";
import { childShortName } from "../lib/children";
import { ageFromDob } from "../lib/dates";
import type { Activity, Child } from "../types";
import { ageOptionLabel, categoryOptionLabel, localizeActivity, materialsOptionLabel, settingOptionLabel, type Copy } from "../lib/i18n";

type OpenFilter = "setting" | "age" | "category" | "materials" | null;

export type DiscoverTab = "activities" | "books";

// Discover: Activities (the default; activities and music together) and Books. Music cards open through `open`
// like activities do, onto the music page with its audio player.
export function DiscoverPage({ tab, setTab, saved, toggleSaved, open, openBook, childrenData, t }: {
  tab: DiscoverTab;
  // The family's children: their ages suggest an age filter and put suitable activities first.
  childrenData: Child[];
  setTab: (tab: DiscoverTab) => void;
  saved: string[];
  toggleSaved: (id: string) => void;
  open: (id: string) => void;
  openBook: (id: string) => void;
  t: Copy;
}) {
  const tabs: [DiscoverTab, string][] = [["activities", t.tabActivities], ["books", t.tabBooks]];
  return (
    <main className="page-content discover-page">
      <PageHeader title={t.discover} subtitle={tab === "books" ? t.booksSubtitle : t.discoverSubtitle} />
      <div className="segmented discover-tabs" role="tablist">
        {tabs.map(([x, l]) => (
          <button role="tab" aria-selected={tab === x} className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{l}</button>
        ))}
      </div>
      {tab === "activities" && <ActivitiesBrowser saved={saved} toggleSaved={toggleSaved} open={open} childrenData={childrenData} t={t} />}
      {tab === "books" && <BooksBrowser openBook={openBook} t={t} />}
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

function ActivitiesBrowser({ saved, toggleSaved, open, childrenData, t }: { saved: string[]; toggleSaved: (id: string) => void; open: (id: string) => void; childrenData: Child[]; t: Copy }) {
  const [q, setQ] = useState("");
  const [setting, setSetting] = useState("All");
  const [age, setAge] = useState("All Ages");
  const [category, setCategory] = useState("All");
  const [materials, setMaterials] = useState("All");
  const [openFilter, setOpenFilter] = useState<OpenFilter>(null);
  // Each child's age filter. Suggestions only: every activity stays a tap away.
  const childRanges = childrenData.filter(c => c.dob).map(c => ({ child: c, range: ageRangeForYears(ageFromDob(c.dob).totalYears) }));
  const suits = (a: Activity) => childRanges.some(x => activityAgeRanges(a).includes(x.range));
  const found = filterDiscoverActivities(items, { q, setting, age, category, materials });
  const filtered = setting !== "All" || age !== "All Ages" || category !== "All" || materials !== "All";
  const resetFilters = () => { setSetting("All"); setAge("All Ages"); setCategory("All"); setMaterials("All"); };
  // Activities that suit one of the children come first; the order is otherwise unchanged.
  const result = childRanges.length && age === "All Ages" ? [...found.filter(suits), ...found.filter(a => !suits(a))] : found;
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
  return (
    <article className={`activity-card ${music ? "music-card" : ""}`}>
      <button className="activity-image" onClick={() => open(a.id)}>
        <img src={a.image} alt="" /><span>{category}</span>
        {music && <i className="music-play"><Icon name={music.audioSrc ? "play" : "music"} size={16} filled={!!music.audioSrc} /></i>}
      </button>
      <div>
        <button className="activity-name" onClick={() => open(a.id)}>{a.title}</button>
        <button className={`heart ${saved ? "saved" : ""}`} onClick={() => toggleSaved(a.id)} aria-pressed={saved} aria-label={(saved ? t.unsaveActivityLabel : t.saveActivityLabel).replace("{title}", a.title)}><Icon name="heart" size={18} filled={saved} /></button>
        <p>{a.age} · {category}</p>
        <small><span><Icon name="clock" size={13} />{a.minutes} {t.min}</span><span><Icon name="layers" size={13} />{a.materialsLabel}</span></small>
      </div>
    </article>
  );
}
