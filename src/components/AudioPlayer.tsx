import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { Copy } from "../lib/i18n";

// Only one recording plays at a time: starting one pauses whichever was playing.
let current: HTMLAudioElement | null = null;

const clock = (s: number) => {
  const total = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// A small player for a music activity's guide recording: play/pause, progress with seeking, elapsed and total
// time. Never autoplays. Without a file, or when the file can't be played, it says the recording is coming soon.
// Render with `key` set to the activity id so switching activities starts fresh.
export default function AudioPlayer({ src, t }: { src?: string; t: Copy }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Leaving the page stops the recording.
  useEffect(() => {
    const audio = ref.current;
    return () => {
      audio?.pause();
      if (current === audio) current = null;
    };
  }, []);

  if (!src || failed) {
    return (
      <div className="audio-player unavailable" role="status">
        <i><Icon name="music" size={20} /></i>
        <span><strong>{t.audioComingSoon}</strong><small>{t.audioComingSoonHint}</small></span>
      </div>
    );
  }

  const toggle = () => {
    const audio = ref.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    if (current && current !== audio) current.pause();
    current = audio;
    audio.play().catch(() => setPlaying(false));
  };
  const known = Number.isFinite(duration) && duration > 0;
  const progress = known ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="audio-player">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onDurationChange={e => setDuration(e.currentTarget.duration)}
        onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => { setPlaying(false); setFailed(true); }}
      />
      <button className="audio-toggle" onClick={toggle} aria-label={playing ? t.audioPause : t.audioPlay}>
        <Icon name={playing ? "pause" : "play"} size={22} filled={!playing} />
      </button>
      <div className="audio-track">
        <input
          type="range"
          min={0}
          max={known ? duration : 0}
          step={0.1}
          value={known ? Math.min(time, duration) : 0}
          disabled={!known}
          aria-label={t.audioProgress}
          style={{ "--progress": `${progress}%` } as React.CSSProperties}
          onChange={e => {
            const audio = ref.current;
            if (!audio) return;
            audio.currentTime = Number(e.target.value);
            setTime(audio.currentTime);
          }}
        />
        <div className="audio-times"><span>{clock(time)}</span><span>{known ? clock(duration) : "–:––"}</span></div>
      </div>
    </div>
  );
}
