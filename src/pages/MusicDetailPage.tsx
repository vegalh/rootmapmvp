import { Icon } from "../components/Icon";
import AudioPlayer from "../components/AudioPlayer";
import { localizeMusic, musicCover } from "../lib/catalog";
import type { Copy } from "../lib/i18n";
import type { MusicActivity } from "../types";

// A music activity: the guide recording, a short introduction, how to play and what children explore. Saving,
// Add to My Week and Mark as Tried use the same sheets and records as Discover activities.
export default function MusicDetailPage({ music, saved, toggleSaved, back, openPlan, openTried, t }: {
  music: MusicActivity;
  saved: boolean;
  toggleSaved: () => void;
  back: () => void;
  openPlan: () => void;
  openTried: () => void;
  t: Copy;
}) {
  const m = localizeMusic(music, t);
  return (
    <main className="detail-page music-detail">
      <div className="detail-actions">
        <button onClick={back} aria-label={t.back}><Icon name="back" /></button>
        <div>
          <button className={saved ? "saved" : ""} onClick={toggleSaved} aria-label={t.saved}><Icon name="heart" filled={saved} /></button>
        </div>
      </div>
      <img className="detail-hero" src={musicCover(music)} alt="" />
      <div className="detail-content">
        <h1>{m.title}</h1>
        <p className="meta">{m.ages}<b>·</b>{t.music}<b>·</b>{music.duration} {t.minutesWord}</p>
        <AudioPlayer key={music.id} src={music.audioSrc} t={t} />
        <p className="description">{m.description}</p>
        <h2>{t.howToPlay}</h2>
        <ol>{m.howToPlay.map(s => <li key={s}>{s}</li>)}</ol>
        <h2>{t.whatChildrenExplore}</h2>
        <div className="explore-tags">{m.whatChildrenExplore.map(x => <span key={x}>{x}</span>)}</div>
      </div>
      <div className="sticky-action two">
        <button className="secondary" onClick={openTried}><Icon name="check" size={19} />{t.markAsTried}</button>
        <button onClick={openPlan}><Icon name="calendar" size={19} />{t.addWeek}</button>
      </div>
    </main>
  );
}
