import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import songData from "../../src/data/songs.json";
import { songs } from "../../src/data/music.ts";
import { collections } from "../../src/data/collections.ts";
import { catalogItems, filterDiscoverActivities, DEFAULT_DISCOVER_FILTERS, findActivity, isMusicId } from "../../src/lib/catalog.ts";
import { parseJianpu, songDurationLabel, songNotes, songScore, songSeconds } from "../../src/lib/songs.ts";
import { songNotesEn, songSourcesZh, songsForCopyrightReview } from "../../src/data/songNotes.ts";
import { durationLabel } from "../../src/lib/catalog.ts";

test("songs: all 50, in id order, each a music activity with a stable id", () => {
  assert.equal(songData.songs.length, 50);
  assert.deepEqual(songData.songs.map(s => s.id), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.deepEqual(songs.map(m => m.id), songData.songs.map(s => `song-${s.id}`));
  for (const m of songs) {
    assert.ok(isMusicId(m.id), m.id);
    assert.equal(findActivity(m.id)?.category, "art-creativity", m.id);
    assert.ok(songData.tunes[m.song!.tune as keyof typeof songData.tunes], `${m.id} has its tune`);
    assert.equal(m.song, songData.songs[m.song!.id - 1], `${m.id} keeps its record as supplied`);
  }
  // Bilingual name: the English classics' title is English, the Chinese songs' title Chinese.
  assert.deepEqual([songs[0].title, songs[0].titleZh], ["Twinkle, Twinkle, Little Star", "小星星"]);
  assert.deepEqual([songs[30].title, songs[30].titleZh], ["Little Hands Clap", "小手拍拍"]);
});

test("songs: the data file is the JSON block of rootmap-songs-prompt.md, unchanged", { skip: !safeRead("rootmap-songs-prompt.md") }, () => {
  const prompt = safeRead("rootmap-songs-prompt.md")!;
  const block = prompt.slice(prompt.indexOf("```json", prompt.indexOf("## Song data")) + "```json\n".length);
  assert.equal(readFileSync("src/data/songs.json", "utf8").trimEnd(), block.slice(0, block.indexOf("```")).trimEnd());
});

test("songs: jianpu parsing (octaves, underlines, dots, holds, bars)", () => {
  const items = parseJianpu("5,_. 5,__ | 1' - 3_ || ");
  assert.deepEqual(items.map(x => x.type), ["note", "note", "bar", "note", "ext", "note", "bar"]);
  const [a, b, , c] = items as Extract<(typeof items)[number], { type: "note" }>[];
  assert.deepEqual([a.deg, a.lo, a.u, a.dot, a.dur], [5, 1, 1, true, 0.75]);
  assert.equal(b.dur, 0.25);
  assert.deepEqual([c.hi, c.dur], [1, 2], "a hold adds a beat to the note before it");
  assert.equal((items[6] as { end: boolean }).end, true);
  // Twinkle: 12 bars of 4/4 at 92 bpm.
  assert.equal(songScore(songs[0].song!).filter(x => x.type === "bar").length, 12);
  assert.ok(Math.abs(songSeconds(songs[0].song!) - 48 * 60 / 92) < 1e-9);
});

test("songs: every bar but the pickup and the last fills the meter", () => {
  const beats: Record<string, number> = { "4/4": 4, "3/4": 3, "6/8": 3 };
  for (const m of songs) {
    const bars: number[] = [0];
    // A "-" counts in its own bar (it may hold a note across a bar line), so a note counts only its written length.
    for (const x of songScore(m.song!)) {
      if (x.type === "bar") bars.push(0);
      else bars[bars.length - 1] += x.type === "ext" ? 1 : (x.dot ? 1.5 : 1) / 2 ** x.u;
    }
    bars.pop(); // after the final bar line
    for (let i = 1; i < bars.length - 1; i++) assert.ok(Math.abs(bars[i] - beats[m.song!.meter]) < 1e-9, `${m.id} bar ${i + 1} = ${bars[i]}`);
  }
});

test("songs: listed in Discover without changing the collections", () => {
  const songIds = new Set(songs.map(m => m.id));
  const listed = filterDiscoverActivities(catalogItems(), DEFAULT_DISCOVER_FILTERS).map(a => a.id);
  for (const id of songIds) assert.ok(listed.includes(id), id);
  for (const c of collections) assert.ok(!catalogItems().filter(c.match).some(a => songIds.has(a.id)), c.id);
  // Found by title in either language, by lyrics, and by 儿歌.
  const search = (q: string) => filterDiscoverActivities(catalogItems(), { ...DEFAULT_DISCOVER_FILTERS, q }).map(a => a.id);
  assert.ok(search("小星星").includes("song-1"));
  assert.ok(search("diamond in the sky").includes("song-1"));
  assert.equal(search("儿歌").filter(id => songIds.has(id)).length, 50);
});

test("songs: how to use and source in both languages, with no numbered activity references", () => {
  assert.deepEqual(Object.keys(songNotesEn).map(Number), songData.songs.map(s => s.id), "English for every song");
  for (const m of songs) {
    const zh = songNotes(m.song!, "zh"), en = songNotes(m.song!, "en");
    assert.equal(zh.source, songSourcesZh[m.song!.id] ?? m.song!.source, `${m.id}: Chinese source as supplied unless reworded for parents`);
    assert.equal(zh.howToUse, m.song!.howToUse.includes("#") ? zh.howToUse : m.song!.howToUse, `${m.id}: unchanged unless it names an activity by number`);
    assert.deepEqual([en.lang, zh.lang], ["en", "zh"]);
    for (const text of [zh.howToUse, en.howToUse, en.source]) assert.ok(text && !/#\d/.test(text), `${m.id}: ${text}`);
  }
  // The activity's name stays as a suggestion.
  assert.equal(songNotes(songs[0].song!, "zh").howToUse, "睡前轻声唱；唱到 twinkle 时手指一开一合。配合“摇摇歌”。");
  assert.equal(songNotes(songs[30].song!, "zh").howToUse, "握着宝宝的小手拍，再轻碰小脚。配合“拍拍手”、“踢彩色”。");
});

test("songs: each shows how long its melody plays", () => {
  assert.equal(songDurationLabel(songs[0].song!, "en"), "31 sec");
  assert.equal(songDurationLabel(songs[0].song!, "zh"), "31秒");
  assert.ok(new Set(songs.map(m => durationLabel(findActivity(m.id)!, "en"))).size > 10, "not the same for every song");
  for (const m of songs) assert.equal(durationLabel(findActivity(m.id)!, "en"), `${Math.round(songSeconds(m.song!))} sec`, m.id);
  assert.equal(durationLabel({ id: "mopping", minutes: 10 }, "en"), "10 min", "activities unchanged");
  assert.equal(durationLabel({ id: "mopping", minutes: 10 }, "zh"), "10分钟");
});

test("songs: copyright review flags name real songs and change nothing", () => {
  for (const id of Object.keys(songsForCopyrightReview).map(Number)) assert.ok(songs.some(m => m.song!.id === id), String(id));
  assert.equal(songs.length, 50, "flagged songs stay listed until reviewed");
});

function safeRead(path: string) {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}
