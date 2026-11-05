# Prompt: Add the Songs library (儿歌库) to RootMap MVP

You are working in the RootMap MVP repo (vegalh/rootmapmvp, deployed on GitHub Pages at vegalh.github.io/rootmapmvp). Add a **Songs / 儿歌** section: 50 copyright-free baby songs, each with lyrics, jianpu (numbered musical notation), a "how to use with baby" note, a copyright source line, and a **试听 (listen)** button that plays the melody in the browser and highlights each note as it plays.

The full song data and a working reference implementation are at the end of this prompt. Use them as given.

## Before writing anything
1. Read the repo: find the stack (plain HTML/JS, React, a build step or none), how pages and navigation work, where data files live, and the existing design tokens (colors, fonts, spacing). The app uses a "Montessori meets Apple" look: neutral tones, DM Serif Display for headings, DM Sans for body.
2. Match what exists. Do not add a framework, a build step, or a dependency the app does not already use. The player needs no libraries: it uses the browser's Web Audio API.
3. If the repo already has an activities section (from the earlier 51-activity prompt), find how activities are identified so songs can link to them (see "Link to activities").
4. Write a short plan (files to add or change), then build it.

## Data
- Save the JSON at the end of this prompt as a data file in the repo's existing data location (for example `data/songs.json`, or the equivalent JS module if the app imports data that way).
- **Copy it exactly.** Do not edit, "correct", translate, shorten, or reformat lyrics, notes, titles, or source lines. Vega checks every melody by ear and will request changes song by song.
- Structure:
  - `tunes`: melody strings in jianpu tokens, keyed by tune name. Several songs share one tune (for example the Chinese songs reuse public-domain melodies).
  - `songs[]`: `id` (1–50), `title`, `subtitle`, `group` (`"en"` = English public-domain classic, `"zh"` = RootMap original Chinese lyrics), `key` (always C), `meter`, `tempo` (quarter-note BPM), `tune` (key into `tunes`), `lyrics` (use `\n` line breaks as written), `howToUse`, `source`.
- If the app is bilingual, the `title`/`subtitle` pair already gives English and Chinese names. Leave lyrics in their original language.

## Jianpu token format (in `tunes`)
Tokens are separated by spaces:
- `1`–`7` = do–ti in the key of C; `0` = rest.
- `'` after a digit = one octave up (dot above); `,` = one octave down (dot below). `1'` = high do, `5,` = low sol.
- `_` = half the length (one underline = eighth note, two = sixteenth). No underline = one quarter-note beat.
- `.` at the end = dotted (1.5× length). Example: `5,_.` = dotted eighth.
- `#` or `b` before a digit = sharp or flat (not used yet, but supported).
- `-` = extend the previous note by one beat.
- `|` = bar line; `||` = final double bar.

## What to build
1. **Songs list page** reachable from the app's main navigation, labeled to match existing nav style (e.g. "Songs 儿歌").
2. **Filter and search bar** at the top: chips for 全部 / 英文经典 / 原创中文填词, a search box that matches title, subtitle, and lyrics, and a "显示 N 首" count. Show a friendly empty state when nothing matches.
3. **One card per song**, in `id` order, showing:
   - Number (`01 / 50`), title, subtitle.
   - A tag: "英文经典 · 公有领域" or "原创中文填词".
   - A meta tag: `1=C · {meter} · ♩={tempo}`.
   - A **试听** button (play icon). While playing it reads **停止** and is highlighted.
   - The jianpu score (rendering rules below).
   - Lyrics, preserving line breaks.
   - "怎么用" (how to use) and "来源与版权" (source and copyright) side notes. Two columns on desktop, stacked on phones.
4. **A short notation legend** under the page heading explaining dots, underlines, `–`, and `·` in plain words (copy the text from the reference implementation).
5. **Copyright footer** (copy the text from the reference implementation).

## Jianpu rendering rules
- Digits in a tabular-number font, about 19px, bold.
- Octave dots: a small dot centered above (high) or below (low) the digit; below-dots sit under any underlines.
- Underlines: one or two thin lines under the note for eighths and sixteenths.
- Dotted notes: a `·` right after the digit.
- `-` renders as `–` with spacing.
- Bar lines as thin vertical rules; the final `||` as a thin-thick double bar.
- The score wraps onto multiple lines at phone width and never makes the page scroll sideways (put it in its own `overflow-x: auto` container as a fallback).
- Each note element carries an index so playback can highlight it.

## Playback (试听)
- Use Web Audio only, no audio files and no recordings. A soft triangle tone plus a quiet sine overtone, with a short attack and decay, sounds like a gentle music box.
- Middle C = MIDI 60. Note pitch = 60 + scale offset (`0,2,4,5,7,9,11` for 1–7) ± 12 per octave mark ± 1 for `#`/`b`. Rests (`0`) are silent but take time.
- Duration = token length × (60 / tempo) seconds.
- Highlight the currently sounding note (soft yellow background from the theme) and clear it when playback ends.
- Only one song plays at a time: starting a song stops any other. Clicking the same button again stops it.
- Stop playback when the user leaves the songs page or the component unmounts.
- Audio must start from a click (browsers block autoplay). Close the AudioContext on stop.
- Respect `prefers-reduced-motion` for any highlight transitions.

## Link to activities
Many `howToUse` notes mention activity numbers like "#29 拍拍手" or "配合 #17 躲猫猫". These numbers follow the 51-activity list from the earlier prompt (1 High-Contrast Cards … 51 Barefoot Textures). If activities exist in the app with a stable ID or page, turn each `#N` into a link to that activity. If they don't exist yet, leave the text as plain text and tell Vega in the summary.

## Design and accessibility
- Use the app's existing tokens for both light and dark themes. If there are none, use neutral sage tones: off-white page, white cards, deep olive-green accent, warm gold for the Chinese-lyrics tag.
- Cards: light border, 12px radius, no heavy shadows.
- Buttons and chips need a visible keyboard focus ring, `aria-pressed` for toggles, and labels in Chinese matching the reference.
- Works at 400px phone width with a 16px side gutter.

## Rules
- Do not add songs, lyrics, recordings, or audio files beyond this data. Do not add I'm a Little Teapot, You Are My Sunshine, Hokey Pokey, The Wheels on the Bus, 小燕子, 世上只有妈妈好, 虫儿飞, or the 1957 何仿 version of 茉莉花. They are still under copyright.
- Do not mention Gymboree or 金宝贝 anywhere.

## Verify before finishing
1. Run the bar-length check below with Node. Every bar except the first (pickup) and last must add up to the meter. Report any failures; do not "fix" the data yourself.
2. Run the app locally. Open the songs page, play three songs (one 4/4, one 3/4, one 6/8, e.g. #1, #10, #5), and confirm sound, note highlighting, stop, and switching between songs.
3. Check the filters, search, and empty state.
4. Check phone width (about 400px) in light and dark themes: no sideways scrolling, scores wrap.
5. Check the browser console for errors.
6. Summarize what changed, which files were added, and whether activity links were created.

```js
// node check-bars.js data/songs.json
const { tunes, songs } = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const beats = m => ({ "4/4": 4, "3/4": 3, "6/8": 3 })[m];
const meterOf = {};
songs.forEach(s => { meterOf[s.tune] = s.meter; });
for (const [name, str] of Object.entries(tunes)) {
  const bars = str.replace("||", "|").split("|").map(b => b.trim()).filter(Boolean);
  bars.forEach((b, i) => {
    let d = 0;
    for (const t of b.split(/\s+/)) {
      if (t === "-") { d += 1; continue; }
      const m = t.match(/^([#b]?)([0-7])(['',]*)(_*)(\.?)$/);
      if (!m) { console.log(name, "bad token", t); continue; }
      let x = 1 / 2 ** m[4].length; if (m[5]) x *= 1.5; d += x;
    }
    if (i !== 0 && i !== bars.length - 1 && Math.abs(d - beats(meterOf[name])) > 1e-9)
      console.log(name, `bar ${i + 1} = ${d} beats`);
  });
}
console.log("bar check done");
```

---

## Reference implementation

This is the working code from the prototype Vega approved. Adapt it to the app's structure (component, module, or plain script), but keep the behavior and the parsing rules the same.

### Parsing and pitch
```js
const KEY = {C:0};
const SEMI = [0,0,2,4,5,7,9,11];

function parse(s){
  const items = []; let last = null;
  for (const t of s.trim().split(/\s+/)){
    if (t === "|" || t === "||"){ items.push({type:"bar", end:t === "||"}); continue; }
    if (t === "-"){ if (last) last.dur += 1; items.push({type:"ext"}); continue; }
    const m = t.match(/^([#b]?)([0-7])(['',]*)(_*)(\.?)$/);
    if (!m){ console.warn("bad token", t); continue; }
    const hi = (m[3].match(/'/g) || []).length, lo = (m[3].match(/,/g) || []).length;
    let dur = 1 / Math.pow(2, m[4].length); if (m[5]) dur *= 1.5;
    const ev = {type:"note", acc:m[1], deg:+m[2], hi, lo, u:m[4].length, dot:!!m[5], dur};
    items.push(ev); last = ev;
  }
  return items;
}
```

### Rendering a score
```js
function renderScore(items){
  let k = 0, h = "";
  for (const it of items){
    if (it.type === "bar") h += `<span class="bar${it.end ? " end" : ""}" aria-hidden="true"></span>`;
    else if (it.type === "ext") h += `<span class="ext">–</span>`;
    else {
      const up = it.hi ? `<span class="o up">•</span>` : "", dn = it.lo ? `<span class="o dn">•</span>` : "";
      h += `<span class="nt u${it.u}" data-k="${k++}">${it.acc ? `<span class="acc">${it.acc}</span>` : ""}<span class="core">${up}${it.deg}${it.dot ? `<span class="aug">·</span>` : ""}${dn}</span></span>`;
    }
  }
  return `<div class="jp">${h}</div>`;
}
```

### Playback
`S[i].items` is the parsed token list for song `i`. `card` is the song's card element. Adapt the button lookups to the app's structure.
```js
let ctx = null, timers = [], current = null, lit = null;
function tone(midi, t, d){
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const o = ctx.createOscillator(), g = ctx.createGain(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
  o.type = "triangle"; o.frequency.value = f; o2.type = "sine"; o2.frequency.value = f * 2;
  const end = t + Math.max(d * 0.92, 0.08);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.14, t + Math.min(0.25, d * 0.5)); g.gain.exponentialRampToValueAtTime(0.0001, end);
  g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.04, t + 0.02); g2.gain.exponentialRampToValueAtTime(0.0001, end);
  o.connect(g).connect(ctx.destination); o2.connect(g2).connect(ctx.destination);
  o.start(t); o2.start(t); o.stop(end + 0.02); o2.stop(end + 0.02);
}
function stop(){
  timers.forEach(clearTimeout); timers = [];
  if (lit) lit.classList.remove("on"); lit = null;
  if (current){ const b = document.getElementById("play-" + current.i); b.setAttribute("aria-pressed","false"); b.querySelector("span").textContent = "试听"; }
  if (ctx){ try { ctx.close(); } catch(e){} ctx = null; }
  current = null;
}
function play(s){
  stop();
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC(); current = s;
  const btn = document.getElementById("play-" + s.i); btn.setAttribute("aria-pressed","true"); btn.querySelector("span").textContent = "停止";
  const card = document.getElementById("song-" + s.i);
  const sec = 60 / s.tempo, base = 60 + KEY.C, t0 = ctx.currentTime + 0.1;
  let t = t0, k = 0;
  for (const e of s.items){
    if (e.type !== "note") continue;
    const d = e.dur * sec;
    if (e.deg > 0) tone(base + SEMI[e.deg] + 12 * e.hi - 12 * e.lo + (e.acc === "#" ? 1 : e.acc === "b" ? -1 : 0), t, d);
    const el = card.querySelector(`[data-k="${k++}"]`);
    timers.push(setTimeout(() => { if (lit) lit.classList.remove("on"); el.classList.add("on"); lit = el; }, (t - t0) * 1000 + 100));
    t += d;
  }
  timers.push(setTimeout(stop, (t - t0) * 1000 + 400));
}
```

### Jianpu CSS
`--hl` is the highlight color token and `--muted` / `--ink` are text colors. Map them to the app's tokens.
```css
.score{overflow-x:auto;padding:14px 4px 18px;border-top:1px dashed var(--line);border-bottom:1px dashed var(--line)}
.jp{display:flex;flex-wrap:wrap;align-items:center;row-gap:22px;font-variant-numeric:tabular-nums;font-weight:600;font-size:19px;line-height:1}
.nt{position:relative;display:inline-flex;padding:4px 0 6px;margin:0 3px;border-radius:4px}
.core{position:relative;display:inline-flex;align-items:baseline;padding:0 1px 3px}
.nt.u1 .core{background:linear-gradient(currentColor,currentColor) 0 100%/100% 1.5px no-repeat}
.nt.u2 .core{background:linear-gradient(currentColor,currentColor) 0 100%/100% 1.5px no-repeat,linear-gradient(currentColor,currentColor) 0 calc(100% - 4px)/100% 1.5px no-repeat;padding-bottom:7px}
.aug{margin-left:1px}
.o{position:absolute;left:50%;transform:translateX(-50%);font-size:9px;line-height:1}
.nt .o.up{top:-7px}
.nt .o.dn{bottom:-6px}
.nt.u1 .o.dn{bottom:-9px}
.nt.u2 .o.dn{bottom:-10px}
.acc{font-size:12px;align-self:flex-start;margin-right:1px}
.nt.on{background:var(--hl)}
.ext{margin:0 6px;color:var(--ink)}
.bar{display:inline-block;width:1.5px;height:24px;background:var(--muted);margin:0 8px;opacity:.7}
.bar.end{width:5px;background:linear-gradient(90deg,var(--muted) 0 1.5px,transparent 1.5px 3px,var(--ink) 3px)}
```

### Page copy
- Heading eyebrow: `RootMap · 0–12 个月`
- Heading: `儿歌库`
- Intro: `50 首可放心使用的儿歌：30 首公有领域英文经典，20 首 RootMap 原创中文填词（旋律均为公有领域）。每首都有简谱和歌词，点“试听”可以听旋律、对照高亮核对简谱。`
- Legend, reading: `“1=C”表示 do 是 C。数字上方有点是高八度，下方有点是低八度。下划线一条是半拍，两条是四分之一拍；“–”延长一拍；数字后的“·”是附点（再加一半时值）。`
- Footer: `版权说明：英文歌曲的词曲均已进入公有领域（各首注明出处）。原创中文填词为 RootMap 新写的歌词，可自由用于 RootMap。只使用表中列出的歌词版本；同名歌曲的现代改编、录音和编曲可能仍受版权保护，不要直接使用他人的录音。`
- Empty state: `没有找到匹配的歌。换个关键词试试。`

---

## Song data (copy exactly into the data file)

```json
{
  "tunes": {
    "twinkle": "1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - | 5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - | 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - ||",
    "abc": "1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2_ 2_ 2_ 2_ 1 - | 5 5 4 - | 3 3 2 - | 5_ 5_ 5 4 - | 3 3 2 - | 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - ||",
    "baa": "1 1 5 5 | 6_ 6_ 6_ 6_ 5 - | 4 4 3 3 | 2 2 1 - | 5 5_ 5_ 4 4_ 4_ | 3 3_ 3_ 2 - | 5 5_ 5_ 4_ 4_ 4 | 3 3_ 3_ 2 - | 1 1 5 5 | 6_ 6_ 6_ 6_ 5 - | 4 4 3 3 | 2 2 1 - ||",
    "mary": "3 2 1 2 | 3 3 3 - | 2 2 2 - | 3 5 5 - | 3 2 1 2 | 3 3 3 3 | 2 2 3 2 | 1 - - - ||",
    "row": "1. 1. | 1 2_ 3. | 3 2_ 3 4_ | 5 - - | 1'_ 1'_ 1'_ 5_ 5_ 5_ | 3_ 3_ 3_ 1_ 1_ 1_ | 5 4_ 3 2_ | 1 - - ||",
    "london": "5. 6_ 5 4 | 3 4 5 - | 2 3 4 - | 3 4 5 - | 5. 6_ 5 4 | 3 4 5 - | 2 - 5 - | 3 1 - - ||",
    "oldmac": "1 1 1 5, | 6, 6, 5, - | 3 3 2 2 | 1 - - 5, | 1 1 1 5, | 6, 6, 5, - | 3 3 2 2 | 1 - - 5,_ 5,_ | 1 1 1 5,_ 5,_ | 1 1 1 - | 1_ 1_ 1 1_ 1_ 1 | 1_ 1_ 1_ 1_ 1 1 | 1 1 1 5, | 6, 6, 5, - | 3 3 2 2 | 1 - - - ||",
    "frere": "1 2 3 1 | 1 2 3 1 | 3 4 5 - | 3 4 5 - | 5_ 6_ 5_ 4_ 3 1 | 5_ 6_ 5_ 4_ 3 1 | 1 5, 1 - | 1 5, 1 - ||",
    "yankee": "1 1 2 3 | 1 3 2 5, | 1 1 2 3 | 1 - 7, - | 1 1 2 3 | 4 3 2 1 | 7, 5, 6, 7, | 1 - 1 - | 6,. 7,_ 6, 5, | 6, 7, 1 - | 5,. 6,_ 5, 4, | 3, - 5, - | 6,. 7,_ 6, 5, | 6, 7, 1 6, | 5, 1 7, 2 | 1 - 1 - ||",
    "yankeeVerse": "1 1 2 3 | 1 3 2 5, | 1 1 2 3 | 1 - 7, - | 1 1 2 3 | 4 3 2 1 | 7, 5, 6, 7, | 1 - 1 - ||",
    "brahms": "3_ 3_ | 5 - 3_ 3_ | 5 - 3_ 5_ | 1' 7. 6_ | 6 5 2_ 3_ | 4 2 2_ 3_ | 4 - 2_ 4_ | 7_ 6_ 5 7 | 1' - 1_ 1_ | 1' - 6_ 4_ | 5 - 3_ 1_ | 4 5 6 | 5 - 1_ 1_ | 1' - 6_ 4_ | 5 - 3_ 1_ | 4 3 2 | 1 - ||",
    "itsy": "5,_ | 1 1_ 1 2_ | 3. 3 3_ | 2 1_ 2 3_ | 1. - 3_ | 3 4_ 5. | 5_ 4_ 3_ 4 5_ | 3 - - | 1_ 1_ 2_ 3. | 3 2_ 1 2_ | 3_ 1. 5,_ 5,_ | 1 1_ 1 2_ | 3. 3 3_ | 2 1_ 2 3_ | 1 - - ||",
    "lassie": "5. 6_ 5_ 4_ | 3 1 1 | 2 5, 5, | 3 1 1 | 5. 6_ 5_ 4_ | 3 1 1 | 2 5, 3 | 1 - - | 2 5, 5, | 3 1 1 | 2 5, 5, | 3 1 1 | 5. 6_ 5_ 4_ | 3 1 1 | 2 5, 3 | 1 - - ||",
    "bonnie": "5, | 3 2 1 | 2 1 6, | 5, 3, - | - - 5, | 3 2 1 | 1 7, 1 | 2 - - | - - 5, | 3 2 1 | 2 1 6, | 5, 3, - | - - 5, | 6, 2 1 | 7, 6, 7, | 1 - - ||",
    "pop": "1 1_ 2 2_ | 3_ 5_ 3_ 1. | 1 1_ 2 2_ | 3. 1. | 1 1_ 2 2_ | 3_ 5_ 3_ 1. | 6. 2 4_ | 3. 1. ||",
    "ring": "5 5 3 6 | 5 3 - - | 4_ 5_ 5 3 6 | 5 3 - - | 5 3 5 3 | 5_ 5_ 5 1 - ||",
    "farmer": "5,_ | 1 1_ 1 1_ | 1. - 2_ | 3 3_ 3 3_ | 3. - 5_ | 5 6_ 5 3_ | 1 2_ 3. | 3 2_ 2 2_ | 1 - - ||",
    "hotcross": "3 2 1 - | 3 2 1 - | 1_ 1_ 1_ 1_ 2_ 2_ 2_ 2_ | 3 2 1 - ||",
    "skip": "3 1 3_ 3_ 5 | 2 7, 2_ 2_ 4 | 3 1 3_ 3_ 5 | 2_ 2_ 3_ 2_ 1 - ||",
    "bingo": "5, | 1 1 5, 5, | 6, 6, 5, 5, | 1 1 2 2 | 3 1 - - | 3 - 3 - | 4 4 4 - | 2 - 2 - | 3 3 3 - | 1 - 1 - | 2 2 2 - | 1_ 7,_ 5, 6, 7, | 1 1 - - ||",
    "rain": "5 3 5_ 5_ 3 | 5_ 5_ 3_ 3_ 5 3 | 5_ 5_ 3_ 3_ 5_ 5_ 3 | 5 3 5_ 5_ 3 ||",
    "oldman": "5 3 5 - | 5 3 5 - | 6 5 4 3 | 2 3 4 - | 3_ 4_ 5 1 1_ 1_ | 1_ 2_ 3_ 4_ 5 - | 5 2 2 4 | 3 2 1 - ||",
    "bday": "5,_. 5,__ | 6, 5, 1 | 7, - 5,_. 5,__ | 6, 5, 2 | 1 - 5,_. 5,__ | 5 3 1 | 7, 6, 4_. 4__ | 3 1 2 | 1 - ||",
    "jingle": "3 3 3 - | 3 3 3 - | 3 5 1. 2_ | 3 - - - | 4 4 4. 4_ | 4 3 3 3_ 3_ | 3 2 2 3 | 2 - 5 - | 3 3 3 - | 3 3 3 - | 3 5 1. 2_ | 3 - - - | 4 4 4 4 | 4 3 3 3_ 3_ | 5 5 4 2 | 1 - - - ||",
    "wewish": "5, | 1 1_ 2_ 1_ 7,_ | 6, 6, 6, | 2 2_ 3_ 2_ 1_ | 7, 5, 5, | 3 3_ 4_ 3_ 2_ | 1 6, 5,_ 5,_ | 6, 2 7, | 1 - ||",
    "deck": "5. 4_ 3 2 | 1 2 3 1 | 2_ 3_ 4_ 2_ 3. 2_ | 1 7, 1 - | 5. 4_ 3 2 | 1 2 3 1 | 2_ 3_ 4_ 2_ 3. 2_ | 1 7, 1 - | 2. 3_ 4 2 | 3. 4_ 5 2 | 3_ 4_ 5 6_ 7_ 1' | 7 6 5 - | 5. 4_ 3 2 | 1 2 3 1 | 6_ 6_ 6_ 6_ 5. 4_ | 3 2 1 - ||",
    "lightly": "5 3 3 - | 4 2 2 - | 1 2 3 4 | 5 5 5 - | 5 3 3 - | 4 2 2 - | 1 3 5 5 | 3 - - - | 2 2 2 2 | 2 3 4 - | 3 3 3 3 | 3 4 5 - | 5 3 3 - | 4 2 2 - | 1 3 5 5 | 1 - - - ||",
    "auclair": "1 1 1 2 | 3 - 2 - | 1 3 2 2 | 1 - - - | 1 1 1 2 | 3 - 2 - | 1 3 2 2 | 1 - - - | 2 2 2 2 | 6, - 6, - | 2 1 7, 6, | 5, - - - | 1 1 1 2 | 3 - 2 - | 1 3 2 2 | 1 - - - ||",
    "hush": "5 3_ 3_ 3 4_ 3_ | 2 2 - - | 5, 2_ 2_ 2 3_ 2_ | 1 1 - - | 5 3_ 3_ 3 4_ 3_ | 2 2 - - | 5, 2_ 2_ 2 3_ 2_ | 1 1 - - ||",
    "bear": "5,_ | 1 3_ 3 2_ | 3 4_ 3. | 2 2_ 2 1_ | 2 3_ 1. | 1 3_ 3 2_ | 3 4_ 5. | 6 6_ 5 5_ | 4 2_ 1. ||",
    "ode": "3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 3. 2_ 2 - | 3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2. 1_ 1 - | 2 2 3 1 | 2 3_ 4_ 3 1 | 2 3_ 4_ 3 2 | 1 2 5, - | 3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2. 1_ 1 - ||"
  },
  "songs": [
    {
      "id": 1,
      "title": "Twinkle, Twinkle, Little Star",
      "subtitle": "小星星",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 92,
      "tune": "twinkle",
      "lyrics": "Twinkle, twinkle, little star,\nHow I wonder what you are!\nUp above the world so high,\nLike a diamond in the sky.\nTwinkle, twinkle, little star,\nHow I wonder what you are!\n\nWhen the blazing sun is gone,\nWhen he nothing shines upon,\nThen you show your little light,\nTwinkle, twinkle, all the night.",
      "howToUse": "睡前轻声唱；唱到 twinkle 时手指一开一合。配合 #9 摇摇歌。",
      "source": "词：Jane Taylor，1806 年；曲：18 世纪法国民歌。"
    },
    {
      "id": 2,
      "title": "The ABC Song",
      "subtitle": "字母歌",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 100,
      "tune": "abc",
      "lyrics": "A B C D E F G,\nH I J K L M N O P,\nQ R S, T U V,\nW X, Y and Z.\nNow I know my ABCs,\nNext time won't you sing with me?",
      "howToUse": "抱着宝宝慢慢唱，听节奏和声音；不需要“教字母”。",
      "source": "1835 年出版，旋律同《小星星》。"
    },
    {
      "id": 3,
      "title": "Baa, Baa, Black Sheep",
      "subtitle": "咩咩小黑羊",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 100,
      "tune": "baa",
      "lyrics": "Baa, baa, black sheep,\nHave you any wool?\nYes sir, yes sir,\nThree bags full;\nOne for the master,\nOne for the dame,\nAnd one for the little boy\nWho lives down the lane.",
      "howToUse": "唱 baa baa 时拉长声音，等宝宝模仿。配合 #18 学声音。",
      "source": "1744 年童谣集《Tommy Thumb's Pretty Song Book》。"
    },
    {
      "id": 4,
      "title": "Mary Had a Little Lamb",
      "subtitle": "玛丽有只小羊羔",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 104,
      "tune": "mary",
      "lyrics": "Mary had a little lamb,\nLittle lamb, little lamb,\nMary had a little lamb,\nIts fleece was white as snow.\n\nEverywhere that Mary went,\nMary went, Mary went,\nEverywhere that Mary went,\nThe lamb was sure to go.",
      "howToUse": "把 Mary 换成宝宝的名字唱。",
      "source": "词：Sarah Josepha Hale，1830 年；曲：Lowell Mason 改编。"
    },
    {
      "id": 5,
      "title": "Row, Row, Row Your Boat",
      "subtitle": "划船歌",
      "group": "en",
      "key": "C",
      "meter": "6/8",
      "tempo": 96,
      "tune": "row",
      "lyrics": "Row, row, row your boat,\nGently down the stream.\nMerrily, merrily, merrily, merrily,\nLife is but a dream.",
      "howToUse": "宝宝坐在大人腿上，牵着双手慢慢前后摇。",
      "source": "1852 年首次出版。"
    },
    {
      "id": 6,
      "title": "London Bridge Is Falling Down",
      "subtitle": "伦敦桥",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 104,
      "tune": "london",
      "lyrics": "London Bridge is falling down,\nFalling down, falling down,\nLondon Bridge is falling down,\nMy fair lady.\n\nBuild it up with sticks and stones,\nSticks and stones, sticks and stones,\nBuild it up with sticks and stones,\nMy fair lady.",
      "howToUse": "6 个月以上：唱到 falling down 时抱着宝宝轻轻下蹲。",
      "source": "17 世纪起流传的英国传统童谣。"
    },
    {
      "id": 7,
      "title": "Old MacDonald Had a Farm",
      "subtitle": "老麦克唐纳的农场",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 112,
      "tune": "oldmac",
      "lyrics": "Old MacDonald had a farm,\nE-I-E-I-O.\nAnd on that farm he had a cow,\nE-I-E-I-O.\nWith a moo-moo here\nAnd a moo-moo there,\nHere a moo, there a moo,\nEverywhere a moo-moo.\nOld MacDonald had a farm,\nE-I-E-I-O.",
      "howToUse": "每段换一种动物叫声；配动物图片书。配合 #48 指一指。",
      "source": "传统旋律；歌词版本 1917 年出版。"
    },
    {
      "id": 8,
      "title": "Are You Sleeping? (Frère Jacques)",
      "subtitle": "雅克兄弟",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 100,
      "tune": "frere",
      "lyrics": "Are you sleeping, are you sleeping,\nBrother John, Brother John?\nMorning bells are ringing,\nMorning bells are ringing,\nDing, dang, dong. Ding, dang, dong.\n\nFrère Jacques, Frère Jacques,\nDormez-vous? Dormez-vous?\nSonnez les matines,\nSonnez les matines,\nDing, dang, dong. Ding, dang, dong.",
      "howToUse": "早上起床时唱；ding dang dong 时轻敲小鼓。",
      "source": "18 世纪法国传统轮唱曲，英文歌词为传统译词。"
    },
    {
      "id": 9,
      "title": "Yankee Doodle",
      "subtitle": "扬基歌",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 116,
      "tune": "yankee",
      "lyrics": "Yankee Doodle went to town,\nRiding on a pony,\nStuck a feather in his cap\nAnd called it macaroni.\n\nYankee Doodle, keep it up,\nYankee Doodle dandy,\nMind the music and the step,\nAnd with the folks be handy.",
      "howToUse": "6 个月以上、头颈稳定后：坐在大人膝上轻轻颠。",
      "source": "18 世纪美国传统歌曲。"
    },
    {
      "id": 10,
      "title": "Brahms' Lullaby",
      "subtitle": "勃拉姆斯摇篮曲",
      "group": "en",
      "key": "C",
      "meter": "3/4",
      "tempo": 72,
      "tune": "brahms",
      "lyrics": "Lullaby, and good night,\nWith roses bedight,\nWith lilies o'erspread\nIs baby's wee bed.\nLay thee down now and rest,\nMay thy slumber be blessed!\nLay thee down now and rest,\nMay thy slumber be blessed!",
      "howToUse": "入睡前抱着慢慢摇，声音越唱越轻。",
      "source": "曲：勃拉姆斯，1868 年；英文歌词为 19 世纪传统译词。"
    },
    {
      "id": 11,
      "title": "The Itsy Bitsy Spider",
      "subtitle": "小小蜘蛛",
      "group": "en",
      "key": "C",
      "meter": "6/8",
      "tempo": 100,
      "tune": "itsy",
      "lyrics": "The itsy bitsy spider\nClimbed up the water spout.\nDown came the rain\nAnd washed the spider out.\nOut came the sun\nAnd dried up all the rain,\nAnd the itsy bitsy spider\nClimbed up the spout again.",
      "howToUse": "手指从宝宝手腕慢慢“爬”到肩膀。",
      "source": "1910 年出版，作者不详。"
    },
    {
      "id": 12,
      "title": "Did You Ever See a Lassie?",
      "subtitle": "你见过小姑娘吗",
      "group": "en",
      "key": "C",
      "meter": "3/4",
      "tempo": 120,
      "tune": "lassie",
      "lyrics": "Did you ever see a lassie,\nA lassie, a lassie?\nDid you ever see a lassie\nGo this way and that?\nGo this way and that way,\nGo this way and that way,\nDid you ever see a lassie\nGo this way and that?",
      "howToUse": "抱着宝宝跟着三拍子左右摇摆。",
      "source": "传统游戏歌，旋律为德国民歌《哦，亲爱的奥古斯丁》。"
    },
    {
      "id": 13,
      "title": "The More We Get Together",
      "subtitle": "我们在一起",
      "group": "en",
      "key": "C",
      "meter": "3/4",
      "tempo": 120,
      "tune": "lassie",
      "lyrics": "The more we get together,\nTogether, together,\nThe more we get together,\nThe happier we'll be.\nFor your friends are my friends,\nAnd my friends are your friends.\nThe more we get together,\nThe happier we'll be.",
      "howToUse": "家人围坐一起唱；唱到 friends 时轻拍宝宝的手。",
      "source": "1926 年出版，美国已进入公有领域；旋律为德国民歌。"
    },
    {
      "id": 14,
      "title": "My Bonnie Lies over the Ocean",
      "subtitle": "我的邦妮",
      "group": "en",
      "key": "C",
      "meter": "3/4",
      "tempo": 100,
      "tune": "bonnie",
      "lyrics": "My Bonnie lies over the ocean,\nMy Bonnie lies over the sea,\nMy Bonnie lies over the ocean,\nOh, bring back my Bonnie to me.",
      "howToUse": "慢慢摇，像海浪一样。",
      "source": "苏格兰传统民歌，1881 年出版。"
    },
    {
      "id": 15,
      "title": "Pop! Goes the Weasel",
      "subtitle": "砰！黄鼠狼跳出来",
      "group": "en",
      "key": "C",
      "meter": "6/8",
      "tempo": 104,
      "tune": "pop",
      "lyrics": "All around the cobbler's bench,\nThe monkey chased the weasel.\nThe monkey thought 'twas all in fun,\nPop! goes the weasel.",
      "howToUse": "唱到 Pop 时轻轻把宝宝举高一点（头颈稳定后）。",
      "source": "19 世纪英国传统歌曲。"
    },
    {
      "id": 16,
      "title": "Ring Around the Rosie",
      "subtitle": "玫瑰花圈",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 108,
      "tune": "ring",
      "lyrics": "Ring around the rosie,\nA pocket full of posies,\nAshes! Ashes!\nWe all fall down!",
      "howToUse": "抱着宝宝慢慢转圈，最后一句轻轻坐下。",
      "source": "传统童谣，19 世纪起有记录。"
    },
    {
      "id": 17,
      "title": "The Farmer in the Dell",
      "subtitle": "山谷里的农夫",
      "group": "en",
      "key": "C",
      "meter": "6/8",
      "tempo": 104,
      "tune": "farmer",
      "lyrics": "The farmer in the dell,\nThe farmer in the dell,\nHi-ho, the derry-o,\nThe farmer in the dell.",
      "howToUse": "抱着宝宝跟着节拍走动。",
      "source": "19 世纪传统游戏歌。"
    },
    {
      "id": 18,
      "title": "Hot Cross Buns",
      "subtitle": "热十字包",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 96,
      "tune": "hotcross",
      "lyrics": "Hot cross buns!\nHot cross buns!\nOne a penny, two a penny,\nHot cross buns!",
      "howToUse": "拍宝宝的小手打节奏。配合 #29 拍拍手。",
      "source": "18 世纪英国街头叫卖歌。"
    },
    {
      "id": 19,
      "title": "Skip to My Lou",
      "subtitle": "跳到我的露",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 116,
      "tune": "skip",
      "lyrics": "Lou, Lou, skip to my Lou,\nLou, Lou, skip to my Lou,\nLou, Lou, skip to my Lou,\nSkip to my Lou, my darling.",
      "howToUse": "抱着宝宝轻快地走动。",
      "source": "19 世纪美国传统游戏歌。"
    },
    {
      "id": 20,
      "title": "Bingo",
      "subtitle": "宾果",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 112,
      "tune": "bingo",
      "lyrics": "There was a farmer had a dog,\nAnd Bingo was his name-o.\nB-I-N-G-O,\nB-I-N-G-O,\nB-I-N-G-O,\nAnd Bingo was his name-o.",
      "howToUse": "每唱一遍少唱一个字母，用拍手代替。",
      "source": "18 世纪英国传统歌曲。"
    },
    {
      "id": 21,
      "title": "Rain, Rain, Go Away",
      "subtitle": "雨啊雨，快走开",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 100,
      "tune": "rain",
      "lyrics": "Rain, rain, go away,\nCome again another day.\nLittle baby wants to play,\nRain, rain, go away.",
      "howToUse": "下雨天在窗边唱。配合 #8 看窗外。",
      "source": "传统童谣，17 世纪起有记录。"
    },
    {
      "id": 22,
      "title": "This Old Man",
      "subtitle": "这个老爷爷",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 112,
      "tune": "oldman",
      "lyrics": "This old man, he played one,\nHe played knick-knack on my thumb;\nWith a knick-knack, paddywhack,\nGive a dog a bone,\nThis old man came rolling home.\n\nThis old man, he played two,\nHe played knick-knack on my shoe…",
      "howToUse": "唱到 thumb、shoe 时轻点宝宝的拇指和脚。",
      "source": "传统童谣，1906 年出版。"
    },
    {
      "id": 23,
      "title": "Happy Birthday to You",
      "subtitle": "生日快乐",
      "group": "en",
      "key": "C",
      "meter": "3/4",
      "tempo": 96,
      "tune": "bday",
      "lyrics": "Happy birthday to you,\nHappy birthday to you,\nHappy birthday, dear baby,\nHappy birthday to you.",
      "howToUse": "把 baby 换成宝宝的名字。",
      "source": "旋律源自 1893 年《Good Morning to All》；2015 年美国法院裁定歌词版权主张无效，2016 年和解后公有。"
    },
    {
      "id": 24,
      "title": "Jingle Bells",
      "subtitle": "铃儿响叮当",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 120,
      "tune": "jingle",
      "lyrics": "Jingle bells, jingle bells,\nJingle all the way!\nOh, what fun it is to ride\nIn a one-horse open sleigh, hey!\nJingle bells, jingle bells,\nJingle all the way!\nOh, what fun it is to ride\nIn a one-horse open sleigh!",
      "howToUse": "摇小铃铛打节拍。配合 #22 小小乐器篮。",
      "source": "James Lord Pierpont，1857 年。"
    },
    {
      "id": 25,
      "title": "We Wish You a Merry Christmas",
      "subtitle": "祝你圣诞快乐",
      "group": "en",
      "key": "C",
      "meter": "3/4",
      "tempo": 132,
      "tune": "wewish",
      "lyrics": "We wish you a merry Christmas,\nWe wish you a merry Christmas,\nWe wish you a merry Christmas,\nAnd a happy New Year.",
      "howToUse": "节日时全家一起唱。",
      "source": "英国传统圣诞歌。"
    },
    {
      "id": 26,
      "title": "Deck the Halls",
      "subtitle": "装饰大厅",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 112,
      "tune": "deck",
      "lyrics": "Deck the halls with boughs of holly,\nFa la la la la, la la la la.\n'Tis the season to be jolly,\nFa la la la la, la la la la.\nDon we now our gay apparel,\nFa la la, la la la, la la la.\nTroll the ancient Yuletide carol,\nFa la la la la, la la la la.",
      "howToUse": "fa la la 的部分最适合宝宝听和模仿。",
      "source": "威尔士传统旋律，19 世纪英文歌词。"
    },
    {
      "id": 27,
      "title": "Lightly Row",
      "subtitle": "轻轻划",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 104,
      "tune": "lightly",
      "lyrics": "Lightly row, lightly row,\nO'er the glassy waves we go;\nSmoothly glide, smoothly glide,\nOn the silent tide.\nLet the winds and waters be\nMingled with our melody;\nSing and float, sing and float,\nIn our little boat.",
      "howToUse": "洗澡或玩水时唱。配合 #25 海绵玩水。",
      "source": "德国民歌，19 世纪英文歌词。"
    },
    {
      "id": 28,
      "title": "Au Clair de la Lune",
      "subtitle": "月光下",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 88,
      "tune": "auclair",
      "lyrics": "Au clair de la lune,\nMon ami Pierrot,\nPrête-moi ta plume\nPour écrire un mot.\nMa chandelle est morte,\nJe n'ai plus de feu.\nOuvre-moi ta porte\nPour l'amour de Dieu.\n\n（大意：月光下，朋友皮埃罗，借我一支笔写几个字；我的蜡烛灭了，请为我开门。）",
      "howToUse": "法语摇篮曲，睡前轻唱。",
      "source": "18 世纪法国传统歌曲。"
    },
    {
      "id": 29,
      "title": "Hush, Little Baby",
      "subtitle": "嘘，小宝贝",
      "group": "en",
      "key": "C",
      "meter": "4/4",
      "tempo": 80,
      "tune": "hush",
      "lyrics": "Hush, little baby, don't say a word,\nMama's going to buy you a mockingbird.\nAnd if that mockingbird won't sing,\nMama's going to buy you a diamond ring.",
      "howToUse": "安抚哭闹时轻声唱，可以把 Mama 换成 Papa。",
      "source": "美国传统摇篮曲。"
    },
    {
      "id": 30,
      "title": "The Bear Went Over the Mountain",
      "subtitle": "小熊翻过山",
      "group": "en",
      "key": "C",
      "meter": "6/8",
      "tempo": 104,
      "tune": "bear",
      "lyrics": "The bear went over the mountain,\nThe bear went over the mountain,\nThe bear went over the mountain,\nTo see what he could see.",
      "howToUse": "手指当小熊，从宝宝的膝盖“爬”过肚子。",
      "source": "传统歌词，旋律同 18 世纪《For He's a Jolly Good Fellow》。"
    },
    {
      "id": 31,
      "title": "小手拍拍",
      "subtitle": "Little Hands Clap",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 100,
      "tune": "frere",
      "lyrics": "小手拍拍，小手拍拍，\n拍一拍，拍一拍。\n宝宝小脚踢踢，\n宝宝小脚踢踢，\n真开心，真开心。",
      "howToUse": "握着宝宝的小手拍，再轻碰小脚。配合 #29 拍拍手、#15 踢彩色。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《雅克兄弟》旋律（法国传统轮唱），公有领域。"
    },
    {
      "id": 32,
      "title": "星星看着我",
      "subtitle": "The Stars Watch Over Me",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 76,
      "tune": "twinkle",
      "lyrics": "月亮弯弯挂天上，\n星星眨眼看着我，\n风儿轻轻吹过来，\n宝宝闭眼睡着了。\n月亮弯弯挂天上，\n星星眨眼看着我。",
      "howToUse": "睡前摇篮曲，越唱越慢。配合 #9 摇摇歌。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《小星星》旋律（18 世纪法国民歌），公有领域。"
    },
    {
      "id": 33,
      "title": "洗洗小手",
      "subtitle": "Wash Our Hands",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 104,
      "tune": "mary",
      "lyrics": "我们一起洗洗手，\n洗洗手，洗洗手，\n我们一起洗洗手呀，\n小手变干净。",
      "howToUse": "每次活动前洗手时唱，对应活动第一步“Wash hands.”",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《玛丽有只小羊羔》旋律（1830 年代），公有领域。"
    },
    {
      "id": 34,
      "title": "小船摇",
      "subtitle": "Little Boat Rocks",
      "group": "zh",
      "key": "C",
      "meter": "6/8",
      "tempo": 92,
      "tune": "row",
      "lyrics": "摇摇摇小船，\n慢慢水上漂，\n摇呀摇呀摇呀摇呀摇呀摇呀摇呀摇，\n宝宝笑一笑。",
      "howToUse": "宝宝坐腿上，牵着双手前后摇。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《划船歌》旋律（1852 年），公有领域。"
    },
    {
      "id": 35,
      "title": "小手搭小桥",
      "subtitle": "Little Bridge",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 100,
      "tune": "london",
      "lyrics": "小手搭起一座桥，\n一座桥，一座桥，\n小手搭起一座桥，\n宝宝过桥。",
      "howToUse": "大人双手搭成“桥”，宝宝从下面看或爬过。配合 #24 钻山洞。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《伦敦桥》旋律（英国传统），公有领域。"
    },
    {
      "id": 36,
      "title": "小脚丫",
      "subtitle": "Little Feet",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 96,
      "tune": "hotcross",
      "lyrics": "小脚丫，小脚丫，\n一个两个三个四个，\n小脚丫。",
      "howToUse": "边唱边轻轻数脚趾。配合 #2 说说小身体。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《热十字包》旋律（英国传统叫卖歌），公有领域。"
    },
    {
      "id": 37,
      "title": "小鼻子",
      "subtitle": "Little Nose",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 108,
      "tune": "oldman",
      "lyrics": "小鼻子，在这里，\n宝宝摸摸小鼻子，\n摸摸摸摸点点点点小鼻子，\n小鼻子呀在这里。\n\n小耳朵，在这里，\n宝宝摸摸小耳朵，\n摸摸摸摸点点点点小耳朵，\n小耳朵呀在这里。",
      "howToUse": "每段换一个身体部位。配合 #2 说说小身体。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《This Old Man》旋律（英国传统），公有领域。"
    },
    {
      "id": 38,
      "title": "早上好",
      "subtitle": "Good Morning",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 100,
      "tune": "ode",
      "lyrics": "太阳公公起床了，宝宝睁开眼睛呀，\n小鸟唱歌叽叽叫，宝宝伸伸小手呀，\n早上好呀早上好，爸爸妈妈抱抱你，抱一抱，\n太阳公公起床了，新的一天开始了呀。",
      "howToUse": "早上醒来时唱，拉开窗帘看看光。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《欢乐颂》旋律（贝多芬，1824 年），公有领域。"
    },
    {
      "id": 39,
      "title": "爷爷的小农场",
      "subtitle": "Grandpa's Little Farm",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 112,
      "tune": "oldmac",
      "lyrics": "爷爷有个小农场，\n咿呀咿呀哟，\n农场里面有小狗，\n咿呀咿呀哟，\n这边汪汪叫，\n那边汪汪叫，\n这汪汪，那汪汪，\n到处汪汪汪汪，\n爷爷有个小农场，\n咿呀咿呀哟。\n\n（下一段：小猫喵喵、小鸭嘎嘎、小牛哞哞）",
      "howToUse": "配动物图片，唱到叫声时停一下等宝宝。配合 #48 指一指。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《Old MacDonald》旋律（美国传统），公有领域。"
    },
    {
      "id": 40,
      "title": "躲猫猫",
      "subtitle": "Peekaboo",
      "group": "zh",
      "key": "C",
      "meter": "3/4",
      "tempo": 116,
      "tune": "lassie",
      "lyrics": "宝宝宝宝在哪里，\n在哪里，在哪里？\n宝宝宝宝在哪里，\n在这里呀！\n躲起来，躲起来，\n看不见，看不见，\n宝宝宝宝在哪里，\n在这里呀！",
      "howToUse": "唱到“在这里呀”时拿开布露出脸。配合 #17 躲猫猫。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《哦，亲爱的奥古斯丁》旋律（德国民歌），公有领域。"
    },
    {
      "id": 41,
      "title": "小鱼游",
      "subtitle": "Little Fish Swim",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 104,
      "tune": "lightly",
      "lyrics": "小鱼游，小鱼游，\n游到东来游到西，\n小鱼游，小鱼游，\n游呀游呀游。\n摇摇尾巴吐泡泡，\n眨眨眼睛笑嘻嘻，\n小鱼游，小鱼游，\n游到妈妈家。",
      "howToUse": "玩水或洗澡时唱。配合 #25 海绵玩水。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《Lightly Row》旋律（德国民歌），公有领域。"
    },
    {
      "id": 42,
      "title": "小雨滴答",
      "subtitle": "Pitter-Patter Rain",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 96,
      "tune": "rain",
      "lyrics": "滴答滴答答，\n雨点轻轻落下，\n宝宝窗边看小雨，\n滴答滴答答。",
      "howToUse": "下雨天抱到窗边唱。配合 #8 看窗外。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《Rain, Rain, Go Away》旋律（英国传统），公有领域。"
    },
    {
      "id": 43,
      "title": "晚安歌",
      "subtitle": "Goodnight Song",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 80,
      "tune": "auclair",
      "lyrics": "月亮爬上来了，\n星星眨眼睛，\n小鸟回家睡了，\n宝宝也晚安。\n窗外风儿轻轻，\n草儿睡着了，\n妈妈轻轻抱着，\n宝宝晚安了。",
      "howToUse": "睡前最后一首，关灯后轻声唱。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《月光下》旋律（法国传统），公有领域。"
    },
    {
      "id": 44,
      "title": "骑大马",
      "subtitle": "Horsey Ride",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 112,
      "tune": "yankeeVerse",
      "lyrics": "骑大马呀骑大马呀，\n跑到外婆家啦，\n颠一颠呀颠一颠呀，\n宝宝笑哈哈呀。",
      "howToUse": "头颈稳定后（约 6 个月以上）：宝宝坐大人膝上，双手扶稳轻轻颠。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《扬基歌》旋律（18 世纪美国传统），公有领域。"
    },
    {
      "id": 45,
      "title": "洗澡歌",
      "subtitle": "Bath Time",
      "group": "zh",
      "key": "C",
      "meter": "6/8",
      "tempo": 96,
      "tune": "row",
      "lyrics": "宝宝洗洗澡，\n水儿暖洋洋，\n搓搓小手搓搓小脚搓搓肚皮，\n宝宝香喷喷。",
      "howToUse": "洗澡时唱，唱到哪里就轻轻搓哪里。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《划船歌》旋律（1852 年），公有领域。"
    },
    {
      "id": 46,
      "title": "穿衣歌",
      "subtitle": "Getting Dressed",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 100,
      "tune": "mary",
      "lyrics": "伸出小手穿衣服，\n穿衣服，穿衣服，\n伸出小脚穿裤子呀，\n宝宝穿好了。",
      "howToUse": "穿衣时唱，给宝宝时间自己伸手。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《玛丽有只小羊羔》旋律（1830 年代），公有领域。"
    },
    {
      "id": 47,
      "title": "抱抱歌",
      "subtitle": "Hug Song",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 80,
      "tune": "twinkle",
      "lyrics": "爸爸妈妈抱抱你，\n宝宝心里笑嘻嘻，\n轻轻拍拍小后背，\n暖暖和和像太阳，\n爸爸妈妈抱抱你，\n宝宝心里笑嘻嘻。",
      "howToUse": "安抚时抱着轻拍后背唱。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《小星星》旋律（18 世纪法国民歌），公有领域。"
    },
    {
      "id": 48,
      "title": "小汽车",
      "subtitle": "Little Car",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 108,
      "tune": "london",
      "lyrics": "小小汽车嘀嘀嘀，\n嘀嘀嘀，嘀嘀嘀，\n小小汽车嘀嘀嘀，\n开到这里。",
      "howToUse": "推着玩具车或球慢慢走。配合 #49 滚坡、#40 推篮子。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《伦敦桥》旋律（英国传统），公有领域。"
    },
    {
      "id": 49,
      "title": "小鸟飞",
      "subtitle": "Little Bird Flies",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 108,
      "tune": "lightly",
      "lyrics": "小鸟飞，小鸟飞，\n飞到天上找白云，\n小鸟飞，小鸟飞，\n飞呀飞呀飞。\n拍拍翅膀飞得高，\n飞到树上唱首歌，\n小鸟飞，小鸟飞，\n飞回小鸟家。",
      "howToUse": "挥着丝巾当翅膀。配合 #32 丝巾舞。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《Lightly Row》旋律（德国民歌），公有领域。"
    },
    {
      "id": 50,
      "title": "再见歌",
      "subtitle": "Goodbye Song",
      "group": "zh",
      "key": "C",
      "meter": "4/4",
      "tempo": 96,
      "tune": "frere",
      "lyrics": "说声再见，说声再见，\n挥挥手，挥挥手，\n明天再来玩呀，\n明天再来玩呀，\n拜拜啦，拜拜啦。",
      "howToUse": "活动结束、收玩具或家人出门时唱。配合 #44 挥手再见。",
      "source": "本页原创填词，可自由用于 RootMap。旋律：《雅克兄弟》旋律（法国传统轮唱），公有领域。"
    }
  ]
}
```
