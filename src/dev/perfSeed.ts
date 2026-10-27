import { activities } from "../data/activities";
import { musicActivities } from "../data/music";
import { devBulkWrite } from "../lib/data/store";
import { done } from "../lib/data/idb";
import { newPhotoId, newRecordId } from "../lib/data/schema";
import type { Child, Entry, LessonRecord } from "../types";
import type { PhotoBlob, PhotoMeta } from "../lib/data/schema";

// Synthetic performance-testing dataset, loaded only in development (`?seedPerf=1`; see docs/perf-testing.md).
// Never reachable in a production or staging build: `maybeSeedPerfData` returns immediately when
// `import.meta.env.DEV` is false, and this module is only ever dynamically imported from main.tsx behind that
// same check, so it is not part of any shipped bundle.
//
// Deterministic (a fixed seed), so repeated runs produce byte-identical data and performance comparisons are
// apples to apples. Ids are prefixed "perf-" so the dataset is obviously synthetic and easy to find or wipe.

// A small, dependency-free seeded PRNG (mulberry32), so the dataset is reproducible across runs/browsers.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = ["Ava", "Liam", "Mia", "Noah", "Zoe", "Eli", "Luna", "Finn", "Nora", "Theo"];
const LAST_NAMES = ["Rivera", "Chen", "Patel", "Novak", "Diallo", "Kim"];
const GROUPS = ["Toddler", "Primary", "Lower Elementary"];
const SAMPLE_WORDS = [
  "practiced pouring water without spilling a drop", "sorted the leaves by size on the nature walk",
  "named every color in the basket", "counted all the way to twenty", "read the whole book out loud",
  "helped set the table for dinner", "built a tower with the blocks", "identified three birds at the park",
  "traced the letters very carefully", "asked wonderful questions about the ants", "sang the whole song from memory",
  "folded the napkins into neat triangles", "matched every pair of socks", "planted seeds in the garden box",
  "drew a detailed map of the backyard",
];

function pick<T>(items: readonly T[], r: () => number): T {
  return items[Math.floor(r() * items.length)];
}

// An ISO date somewhere in the last `years` years (today never excluded), so entries span multiple years.
function pastIsoDate(r: () => number, years: number): string {
  const days = Math.floor(r() * years * 365);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// A tiny solid-color JPEG, the same size class as a real resized photo thumbnail would decode to on screen
// (realistic enough to exercise object-URL creation and decoding; small enough that 500 of them seed quickly).
function syntheticPhotoBlob(r: () => number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `hsl(${Math.floor(r() * 360)}, 55%, 65%)`;
  ctx.fillRect(0, 0, 48, 48);
  return new Promise(resolve => canvas.toBlob(b => resolve(b || new Blob()), "image/jpeg", 0.6));
}

const CHILD_COUNT = 5;
const ENTRY_COUNT = 1000;
const RECORD_COUNT = 2000;
const PHOTO_COUNT = 500;
const YEARS_OF_HISTORY = 4;

async function buildDataset() {
  const r = rng(20261027);
  const now = new Date().toISOString();
  const catalogIds = [...activities.map(a => a.id), ...musicActivities.map(m => m.id)];

  const children: Child[] = Array.from({ length: CHILD_COUNT }, (_, i) => ({
    id: `perf-child-${i}`,
    first: FIRST_NAMES[i % FIRST_NAMES.length],
    last: pick(LAST_NAMES, r),
    dob: pastIsoDate(r, 6),
    enrolled: "September 2022",
    lessons: 0,
    group: pick(GROUPS, r),
    photo: "",
    origin: "user",
    createdAt: now,
    updatedAt: now,
  }));
  const childIds = children.map(c => c.id);

  const photos: { meta: PhotoMeta; blob: Blob }[] = [];
  for (let i = 0; i < PHOTO_COUNT; i++) {
    const blob = await syntheticPhotoBlob(r);
    photos.push({
      meta: {
        id: newPhotoId(), mimeType: "image/jpeg", byteSize: blob.size, width: 48, height: 48,
        createdAt: now, updatedAt: now, deletedAt: null, source: "upload", storagePath: null, uploadedAt: null,
      },
      blob,
    });
  }
  const photoIds = photos.map(p => p.meta.id);

  const entries: Entry[] = Array.from({ length: ENTRY_COUNT }, () => {
    const date = pastIsoDate(r, YEARS_OF_HISTORY);
    const hasPhotos = r() < 0.4;
    const photoCount = hasPhotos ? 1 + Math.floor(r() * 2) : 0;
    return {
      id: newRecordId("perf-m"),
      childId: pick(childIds, r),
      date,
      title: r() < 0.5 ? `${pick(SAMPLE_WORDS, r).slice(0, 1).toUpperCase()}${pick(SAMPLE_WORDS, r).slice(1)}` : undefined,
      text: `Today ${pick(SAMPLE_WORDS, r)}.`,
      photos: Array.from({ length: photoCount }, () => pick(photoIds, r)),
      createdAt: `${date}T12:00:00.000Z`,
      updatedAt: `${date}T12:00:00.000Z`,
      origin: "user",
    };
  });

  const records: LessonRecord[] = Array.from({ length: RECORD_COUNT }, () => {
    const date = pastIsoDate(r, YEARS_OF_HISTORY);
    const activityId = pick(catalogIds, r);
    const activity = activities.find(a => a.id === activityId);
    const tried = r() < 0.3;
    return {
      id: newRecordId(tried ? "perf-t" : "perf-r"),
      childId: pick(childIds, r),
      lesson: activity?.title ?? activityId,
      area: tried ? undefined : activity?.area,
      stage: tried ? undefined : pick(["Introduced", "Practicing", "Independent"] as const, r),
      date,
      kind: tried ? "tried" : undefined,
      activityId,
      createdAt: `${date}T09:00:00.000Z`,
      updatedAt: `${date}T09:00:00.000Z`,
      origin: "user",
    };
  });

  return { children, entries, records, photos };
}

export async function maybeSeedPerfData(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("seedPerf")) return;
  const t0 = performance.now();
  const { children, entries, records, photos } = await buildDataset();
  await devBulkWrite(async db => {
    const tx = db.transaction(["children", "entries", "records", "photos", "photoBlobs", "settings"], "readwrite");
    tx.objectStore("settings").put({ key: "rootmap-no-demo", value: true, updatedAt: new Date().toISOString() });
    for (const c of children) tx.objectStore("children").put(c);
    for (const e of entries) tx.objectStore("entries").put(e);
    for (const rec of records) tx.objectStore("records").put(rec);
    for (const p of photos) {
      tx.objectStore("photos").put(p.meta);
      tx.objectStore("photoBlobs").put({ id: p.meta.id, blob: p.blob } satisfies PhotoBlob);
    }
    await done(tx);
  });
  const ms = Math.round(performance.now() - t0);
  console.info(`[perfSeed] wrote ${children.length} children, ${entries.length} entries, ${records.length} records, ${photos.length} photos in ${ms}ms`);
}

// Exposed for the perf test harness, which measures a clean reload after seeding separately from the seeding
// time itself (seeding only ever happens once per fresh profile in that harness).
export const PERF_SEED_COUNTS = { children: CHILD_COUNT, entries: ENTRY_COUNT, records: RECORD_COUNT, photos: PHOTO_COUNT };
