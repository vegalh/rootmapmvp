import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, FilterPill, Empty } from "../components/ui";
import BooksBrowser from "../components/BooksBrowser";
import MusicBrowser from "../components/MusicBrowser";
import { activities, categories } from "../data/activities";
import { activityAgeRanges, ageOptionsFor, ageRangeForYears, matchesCatalogQuery } from "../lib/catalog";
import { childShortName } from "../lib/children";
import { ageFromDob } from "../lib/dates";
import type { Activity, AgeRange, Child } from "../types";
import { ageOptionLabel, discoverCategoryLabel, localizeActivity, topicOptionLabel, type Copy } from "../lib/i18n";

type OpenFilter = "age" | "topic" | "area" | null;

export type DiscoverTab = "activities" | "books" | "music";

// Discover: Activities (the default), Books and Music. Music cards open through `open` like activities do.
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
  const tabs: [DiscoverTab, string][] = [["activities", t.tabActivities], ["books", t.tabBooks], ["music", t.tabMusic]];
  return (
    <main className="page-content discover-page">
      <PageHeader title={t.discover} subtitle={tab === "books" ? t.booksSubtitle : tab === "music" ? t.musicSubtitle : t.discoverSubtitle} />
      <div className="segmented discover-tabs" role="tablist">
        {tabs.map(([x, l]) => (
          <button role="tab" aria-selected={tab === x} className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{l}</button>
        ))}
      </div>
      {tab === "activities" && <ActivitiesBrowser saved={saved} toggleSaved={toggleSaved} open={open} childrenData={childrenData} t={t} />}
      {tab === "books" && <BooksBrowser openBook={openBook} t={t} />}
      {tab === "music" && <MusicBrowser saved={saved} toggleSaved={toggleSaved} open={open} t={t} />}
    </main>
  );
}

// Filter options that have activities, in the usual order (a topic or area with nothing in it isn't offered).
const TOPICS = ["Nature", "Seasons", "Everyday Life", "Creativity", "Sensory Exploration", "Independence", "Language Development"];
const topicOptions = ["All", ...TOPICS.filter(x => activities.some(a => a.topic === x)), ...[...new Set(activities.map(a => a.topic))].filter(x => x && !TOPICS.includes(x))];
const areaOptions = ["All", ...categories.map(c => c[0]).filter(x => activities.some(a => a.area === x))];
const ageOptions = ageOptionsFor(activities.map(activityAgeRanges));

function ActivitiesBrowser({ saved, toggleSaved, open, childrenData, t }: { saved: string[]; toggleSaved: (id: string) => void; open: (id: string) => void; childrenData: Child[]; t: Copy }) {
  const [q, setQ] = useState("");
  const [age, setAge] = useState("All Ages");
  const [topic, setTopic] = useState("All");
  const [area, setArea] = useState("All");
  const [openFilter, setOpenFilter] = useState<OpenFilter>(null);
  // Each child's age filter. Suggestions only: every activity stays a tap away.
  const childRanges = childrenData.filter(c => c.dob).map(c => ({ child: c, range: ageRangeForYears(ageFromDob(c.dob).totalYears) }));
  const suits = (a: Activity) => childRanges.some(x => activityAgeRanges(a).includes(x.range));
  const found = activities.filter(a =>
    matchesCatalogQuery(a, q) &&
    (age === "All Ages" || activityAgeRanges(a).includes(age as AgeRange)) &&
    (topic === "All" || a.topic === topic) &&
    (area === "All" || a.area === area)
  );
  // Activities that suit one of the children come first; the order is otherwise unchanged.
  const result = childRanges.length && age === "All Ages" ? [...found.filter(suits), ...found.filter(a => !suits(a))] : found;
  return (
    <>
      <label className="search discover-search"><Icon name="search" size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchActivities} /></label>
      <div className="filter-row">
        <FilterPill
          label={t.age} value={age} defaultValue="All Ages" onChange={setAge}
          options={ageOptions} renderLabel={v => ageOptionLabel(v, t)}
          columns={1} isOpen={openFilter === "age"} onOpenChange={o => setOpenFilter(o ? "age" : null)}
        />
        <FilterPill
          label={t.topic} value={topic} defaultValue="All" onChange={setTopic}
          options={topicOptions} renderLabel={v => topicOptionLabel(v, t)}
          columns={2} isOpen={openFilter === "topic"} onOpenChange={o => setOpenFilter(o ? "topic" : null)}
        />
        <FilterPill
          label={t.area} value={area} defaultValue="All" onChange={setArea}
          options={areaOptions} renderLabel={v => (v === "All" ? t.all : discoverCategoryLabel(v, t))}
          columns={2} isOpen={openFilter === "area"} onOpenChange={o => setOpenFilter(o ? "area" : null)} align="right"
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
      {(age !== "All Ages" || topic !== "All" || area !== "All") && (
        <button className="reset-link" onClick={() => { setAge("All Ages"); setTopic("All"); setArea("All"); }}>{t.reset}</button>
      )}
      <div className="section-title"><h2>{t.exploreActivities}</h2><span>{result.length} {t.activitiesCount}</span></div>
      <div className="activity-grid">
        {result.map(a => <ActivityCard activity={a} saved={saved.includes(a.id)} toggleSaved={toggleSaved} open={open} t={t} key={a.id} />)}
      </div>
      {!result.length && <Empty text={t.noResults} />}
    </>
  );
}

export function ActivityCard({ activity: rawActivity, saved, toggleSaved, open, t }: { activity: Activity; saved: boolean; toggleSaved: (id: string) => void; open: (id: string) => void; t: Copy }) {
  const a = localizeActivity(rawActivity, t);
  return (
    <article className="activity-card">
      <button className="activity-image" onClick={() => open(a.id)}><img src={a.image} alt="" /><span>{discoverCategoryLabel(a.area, t)}</span></button>
      <div>
        <button className="activity-name" onClick={() => open(a.id)}>{a.title}</button>
        <button className={`heart ${saved ? "saved" : ""}`} onClick={() => toggleSaved(a.id)} aria-pressed={saved} aria-label={(saved ? t.unsaveActivityLabel : t.saveActivityLabel).replace("{title}", a.title)}><Icon name="heart" size={18} filled={saved} /></button>
        <p>{a.age} · {discoverCategoryLabel(a.area, t)}</p>
        <small><span><Icon name="clock" size={13} />{a.minutes} {t.min}</span><span><Icon name="layers" size={13} />{a.materialsLabel}</span></small>
      </div>
    </article>
  );
}
