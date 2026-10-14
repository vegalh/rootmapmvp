import { useState } from "react";
import { Icon } from "./Icon";
import { Empty, FilterPill } from "./ui";
import { musicActivities } from "../data/music";
import { ageOptionsFor, localizeMusic, matchesAge, matchesCatalogQuery, musicAsActivity, musicCover } from "../lib/catalog";
import { ageOptionLabel, type Copy } from "../lib/i18n";
import type { MusicActivity } from "../types";

// Discover > Music: interactive music activities, searchable (shared catalog search, English or Chinese) and by age.
export default function MusicBrowser({ saved, toggleSaved, open, t }: { saved: string[]; toggleSaved: (id: string) => void; open: (id: string) => void; t: Copy }) {
  const [q, setQ] = useState("");
  const [age, setAge] = useState("All Ages");
  const [ageOpen, setAgeOpen] = useState(false);
  const result = musicActivities.filter(m => matchesCatalogQuery(musicAsActivity(m), q) && matchesAge(m.ageRanges, age));
  return (
    <>
      <label className="search discover-search"><Icon name="search" size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchMusic} /></label>
      <div className="filter-row">
        <FilterPill
          label={t.age} value={age} defaultValue="All Ages" onChange={setAge}
          options={ageOptionsFor(musicActivities.map(m => m.ageRanges))} renderLabel={v => ageOptionLabel(v, t)}
          columns={1} isOpen={ageOpen} onOpenChange={setAgeOpen}
        />
      </div>
      {age !== "All Ages" && <button className="reset-link" onClick={() => setAge("All Ages")}>{t.reset}</button>}
      <div className="section-title"><h2>{t.musicSection}</h2><span>{result.length} {t.activitiesCount}</span></div>
      <div className="activity-grid">
        {result.map(m => <MusicCard music={m} saved={saved.includes(m.id)} toggleSaved={toggleSaved} open={open} t={t} key={m.id} />)}
      </div>
      {!result.length && <Empty text={t.noResults} />}
    </>
  );
}

// The Discover activity card, with a play badge on the cover and the activity's length.
function MusicCard({ music, saved, toggleSaved, open, t }: { music: MusicActivity; saved: boolean; toggleSaved: (id: string) => void; open: (id: string) => void; t: Copy }) {
  const m = localizeMusic(music, t);
  return (
    <article className="activity-card music-card">
      <button className="activity-image" onClick={() => open(music.id)} aria-label={m.title}>
        <img src={musicCover(music)} alt="" />
        <i className="music-play"><Icon name={music.audioSrc ? "play" : "music"} size={16} filled={!!music.audioSrc} /></i>
      </button>
      <div>
        <button className="activity-name" onClick={() => open(music.id)}>{m.title}</button>
        <button className={`heart ${saved ? "saved" : ""}`} onClick={() => toggleSaved(music.id)} aria-label={t.saved}><Icon name="heart" size={18} filled={saved} /></button>
        <p>{m.ages}</p>
        <small><Icon name="clock" size={13} />{music.duration} {t.min}</small>
      </div>
    </article>
  );
}
