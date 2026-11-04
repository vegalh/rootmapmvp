import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import type { Copy } from "../lib/i18n";
import { playSong, songScore, stopSong } from "../lib/songs";
import { trackClick, useImpression } from "../lib/analytics/tracker";
import type { Song } from "../types";

// A song's Listen / Stop button and its jianpu score. While it plays, the sounding note is highlighted. Leaving
// the page stops it. Render with `key` set to the song's activity id so switching songs starts fresh.
export default function SongScore({ song, t }: { song: Song; t: Copy }) {
  const [lit, setLit] = useState(-1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => stopSong, []);
  useImpression("music.play");

  const toggle = () => {
    if (playing) { stopSong(); return; }
    trackClick("music.play");
    const started = playSong(song, k => {
      setLit(k);
      if (k < 0) setPlaying(false);
    });
    setPlaying(started);
  };

  let k = 0;
  return (
    <>
      <div className="audio-player song-player">
        <button className="audio-toggle" onClick={toggle} aria-pressed={playing} aria-label={playing ? t.songStop : t.songListen}>
          <Icon name={playing ? "pause" : "play"} size={22} filled={!playing} />
        </button>
        <span><strong>{playing ? t.songStop : t.songListen}</strong><small>1={song.key} · {song.meter} · ♩={song.tempo}</small></span>
      </div>
      <h2>{t.songScore}</h2>
      <p className="song-legend">{t.songLegend}</p>
      <div className="song-score">
        <div className="jp">
          {songScore(song).map((it, i) => {
            if (it.type === "bar") return <span className={`jp-bar${it.end ? " end" : ""}`} aria-hidden="true" key={i} />;
            if (it.type === "ext") return <span className="jp-ext" key={i}>–</span>;
            const index = k++;
            return (
              <span className={`jp-note u${it.u}${lit === index ? " on" : ""}`} data-k={index} key={i}>
                {it.acc && <span className="jp-acc">{it.acc}</span>}
                <span className="jp-core">
                  {it.hi > 0 && <span className="jp-dot up">•</span>}
                  {it.deg}
                  {it.dot && <span className="jp-aug">·</span>}
                  {it.lo > 0 && <span className="jp-dot dn">•</span>}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}
