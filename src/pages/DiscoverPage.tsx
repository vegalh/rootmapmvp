import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, FilterSelect, Empty } from "../components/ui";
import { activities, categories } from "../data/activities";
import type { Activity } from "../types";
import { ageOptionLabel, discoverCategoryLabel, localizeActivity, topicOptionLabel, type Copy } from "../lib/i18n";

export function DiscoverPage({ saved, toggleSaved, open, t }: { saved: string[]; toggleSaved: (id: string) => void; open: (id: string) => void; t: Copy }) {
  const [q, setQ] = useState("");
  const [age, setAge] = useState("All Ages");
  const [topic, setTopic] = useState("All");
  const [area, setArea] = useState("All");
  const result = activities.filter(a =>
    (!q || `${a.title} ${a.topic} ${a.area} ${a.materials.join(" ")} ${a.keywords}`.toLowerCase().includes(q.toLowerCase())) &&
    (age === "All Ages" || a.ageKey === age) &&
    (topic === "All" || a.topic === topic) &&
    (area === "All" || a.area === area)
  );
  return (
    <main className="page-content discover-page">
      <PageHeader title={t.discover} subtitle={t.discoverSubtitle} />
      <label className="search discover-search"><Icon name="search" size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchActivities} /></label>
      <div className="filter-row">
        <FilterSelect label={t.age} value={age} onChange={setAge} options={["All Ages", "0–2", "2–3", "3–4", "4–6", "6+"]} renderLabel={v => ageOptionLabel(v, t)} />
        <FilterSelect label={t.topic} value={topic} onChange={setTopic} options={["All", "Nature", "Seasons", "Everyday Life", "Creativity", "Sensory Exploration", "Independence", "Language Development"]} renderLabel={v => topicOptionLabel(v, t)} />
        <FilterSelect label={t.area} value={area} onChange={setArea} options={["All", ...categories.map(c => c[0])]} renderLabel={v => (v === "All" ? t.all : discoverCategoryLabel(v, t))} />
      </div>
      {(age !== "All Ages" || topic !== "All" || area !== "All") && (
        <button className="reset-link" onClick={() => { setAge("All Ages"); setTopic("All"); setArea("All"); }}>{t.reset}</button>
      )}
      <div className="category-grid">
        {categories.map(([name, icon], i) => (
          <button className={area === name ? "selected" : ""} onClick={() => setArea(area === name ? "All" : name)} key={name}>
            <i className={`cat-${i}`}><Icon name={icon} /></i><span>{discoverCategoryLabel(name, t)}</span>
          </button>
        ))}
      </div>
      <div className="section-title"><h2>{t.popular}</h2><span>{result.length} {t.activitiesCount}</span></div>
      <div className="activity-grid">
        {result.map(a => <ActivityCard activity={a} saved={saved.includes(a.id)} toggleSaved={toggleSaved} open={open} t={t} key={a.id} />)}
      </div>
      {!result.length && <Empty text={t.noResults} />}
    </main>
  );
}

export function ActivityCard({ activity: rawActivity, saved, toggleSaved, open, t }: { activity: Activity; saved: boolean; toggleSaved: (id: string) => void; open: (id: string) => void; t: Copy }) {
  const a = localizeActivity(rawActivity, t);
  return (
    <article className="activity-card">
      <button className="activity-image" onClick={() => open(a.id)}><img src={a.image} alt="" /><span>{discoverCategoryLabel(a.area, t)}</span></button>
      <div>
        <button className="activity-name" onClick={() => open(a.id)}>{a.title}</button>
        <button className={`heart ${saved ? "saved" : ""}`} onClick={() => toggleSaved(a.id)}><Icon name="heart" size={18} filled={saved} /></button>
        <p>{a.age} · {discoverCategoryLabel(a.area, t)}</p>
        <small><Icon name="clock" size={13} />{a.minutes} {t.min} <Icon name="layers" size={13} />{a.materialsLabel}</small>
      </div>
    </article>
  );
}
