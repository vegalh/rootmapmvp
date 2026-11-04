import songData from "../data/songs.json";
import { songNotesEn } from "../data/songNotes";
import type { Lang, Song } from "../types";

// Jianpu (numbered notation) for the songs in src/data/songs.json, and the Listen tone. Tokens are separated by
// spaces: 1–7 do–ti in C, 0 a rest; ' an octave up and , an octave down; each _ halves the length; a trailing .
// makes it dotted; # or b before the digit sharpens or flattens it; - holds the previous note one more beat;
// | is a bar line and || the final double bar.

export type ScoreItem =
  | { type: "bar"; end: boolean }
  | { type: "ext" }
  | { type: "note"; acc: string; deg: number; hi: number; lo: number; u: number; dot: boolean; dur: number };
export type ScoreNote = Extract<ScoreItem, { type: "note" }>;

const SEMI = [0, 0, 2, 4, 5, 7, 9, 11];
const MIDDLE_C = 60;

export function parseJianpu(s: string): ScoreItem[] {
  const items: ScoreItem[] = [];
  let last: ScoreNote | null = null;
  for (const t of s.trim().split(/\s+/)) {
    if (t === "|" || t === "||") { items.push({ type: "bar", end: t === "||" }); continue; }
    if (t === "-") { if (last) last.dur += 1; items.push({ type: "ext" }); continue; }
    const m = t.match(/^([#b]?)([0-7])(['',]*)(_*)(\.?)$/);
    if (!m) { console.warn("bad jianpu token", t); continue; }
    const hi = (m[3].match(/'/g) || []).length, lo = (m[3].match(/,/g) || []).length;
    let dur = 1 / Math.pow(2, m[4].length);
    if (m[5]) dur *= 1.5;
    const note: ScoreNote = { type: "note", acc: m[1], deg: +m[2], hi, lo, u: m[4].length, dot: !!m[5], dur };
    items.push(note);
    last = note;
  }
  return items;
}

const tunes: Record<string, string> = songData.tunes;
const scores = new Map<string, ScoreItem[]>();
// A song's parsed score (several songs share one tune). Parsed once per tune.
export function songScore(song: Song): ScoreItem[] {
  let score = scores.get(song.tune);
  if (!score) { score = parseJianpu(tunes[song.tune] ?? ""); scores.set(song.tune, score); }
  return score;
}

// How long the melody takes once through, in seconds.
export function songSeconds(song: Song): number {
  const beats = songScore(song).reduce((n, x) => n + (x.type === "note" ? x.dur : 0), 0);
  return beats * (60 / song.tempo);
}

// "32 sec" / "32秒", "1 min 5 sec" / "1分5秒": how long the melody plays.
export function songDurationLabel(song: Song, lang: Lang): string {
  const total = Math.round(songSeconds(song)), m = Math.floor(total / 60), s = total % 60;
  if (lang === "zh") return m ? `${m}分${s ? `${s}秒` : ""}` : `${s}秒`;
  return m ? `${m} min${s ? ` ${s} sec` : ""}` : `${s} sec`;
}

// A song's how-to-use note and source in the interface language (Chinese as supplied, English from data/songNotes.ts).
// The Chinese note names activities by number ("配合 #9 摇摇歌"), from a list that isn't in RootMap; only the name is
// shown ("配合“摇摇歌”"), never the number or a link.
export function songNotes(song: Song, lang: Lang): { howToUse: string; source: string; lang: Lang } {
  const en = songNotesEn[song.id];
  if (lang === "en" && en) return { ...en, lang: "en" };
  const howToUse = song.howToUse.replace(/#\d+\s*([^、。，；\s]+)/g, "“$1”").replace(/配合\s+“/g, "配合“");
  return { howToUse, source: song.source, lang: "zh" };
}

const midi = (n: ScoreNote) => MIDDLE_C + SEMI[n.deg] + 12 * n.hi - 12 * n.lo + (n.acc === "#" ? 1 : n.acc === "b" ? -1 : 0);

// A soft triangle tone with a quiet sine overtone, short attack and decay: a gentle music box.
function tone(ctx: AudioContext, note: number, t: number, d: number) {
  const f = 440 * Math.pow(2, (note - 69) / 12);
  const o = ctx.createOscillator(), g = ctx.createGain(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
  o.type = "triangle"; o.frequency.value = f; o2.type = "sine"; o2.frequency.value = f * 2;
  const end = t + Math.max(d * 0.92, 0.08);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.14, t + Math.min(0.25, d * 0.5)); g.gain.exponentialRampToValueAtTime(0.0001, end);
  g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.04, t + 0.02); g2.gain.exponentialRampToValueAtTime(0.0001, end);
  o.connect(g).connect(ctx.destination); o2.connect(g2).connect(ctx.destination);
  o.start(t); o2.start(t); o.stop(end + 0.02); o2.stop(end + 0.02);
}

// Only one song plays at a time: starting one stops whichever was playing.
let stopCurrent: (() => void) | null = null;
export const stopSong = () => stopCurrent?.();

// Plays the melody from a click (browsers block audio that doesn't start from one). `onNote` gets the index of
// each note as it sounds (rests count, so it matches the score's note numbering) and -1 when playback ends or is
// stopped. Returns false when the browser has no Web Audio.
export function playSong(song: Song, onNote: (k: number) => void): boolean {
  stopSong();
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return false;
  const ctx = new AC();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const stop = () => {
    timers.forEach(clearTimeout);
    ctx.close().catch(() => {});
    if (stopCurrent === stop) stopCurrent = null;
    onNote(-1);
  };
  stopCurrent = stop;
  const sec = 60 / song.tempo, t0 = ctx.currentTime + 0.1;
  let t = t0, k = 0;
  for (const e of songScore(song)) {
    if (e.type !== "note") continue;
    const d = e.dur * sec;
    if (e.deg > 0) tone(ctx, midi(e), t, d);
    const index = k++;
    timers.push(setTimeout(() => onNote(index), (t - t0) * 1000 + 100));
    t += d;
  }
  timers.push(setTimeout(stop, (t - t0) * 1000 + 400));
  return true;
}
