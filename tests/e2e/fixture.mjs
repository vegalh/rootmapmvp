export const FIXTURE = `(async () => {
  const photo = (w, h, seed, q = 0.9) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); const img = ctx.createImageData(w, h);
    let x = seed; for (let i = 0; i < img.data.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; img.data[i] = i % 4 === 3 ? 255 : (x >> 16) & 255; }
    ctx.putImageData(img, 0, 0); return c.toDataURL("image/jpeg", q);
  };
  const A = photo(300, 300, 1), B = photo(300, 300, 2), C = photo(300, 300, 3);
  const P1 = photo(900, 700, 4, 0.85), P2 = photo(700, 900, 5, 0.85), P3 = photo(800, 800, 6, 0.85), P4 = photo(600, 450, 7, 0.85);
  const seedChildren = [
    { id: "emma", first: "Maya", last: "Hao", dob: "2023-08-10", enrolled: "September 2025", lessons: 12, group: "Primary", photo: "/src/assets/children/maya.svg", enrolledZh: "2025年9月" },
    { id: "noah", first: "Leo", last: "Hao", dob: "2024-02-10", enrolled: "January 2026", lessons: 8, group: "Toddler", photo: "/src/assets/children/leo.svg", enrolledZh: "2026年1月" },
  ];
  const data = {
    "rootmap-children": [...seedChildren, { id: "c-1760000000000", first: "小明", last: "张", dob: "2022-05-01", enrolled: "October 2026", lessons: 0, group: "Primary", notes: "Loves trains 🚂", photo: A }],
    "rootmap-deleted-children": [
      { id: "c-1760000000001", first: "Zoë", last: "Müller", dob: "2021-03-03", enrolled: "October 2026", lessons: 0, group: "Other", photo: B, deletedAt: "2026-09-20T10:00:00.000Z" },
      { ...seedChildren[1], deletedAt: "2026-08-01T00:00:00.000Z" },
    ],
    "rootmap-journal": [
      { id: "m-1760000000000-a1b2c3", childId: "c-1760000000000", date: "2026-10-03", title: "第一次骑车 🚲", text: "He rode 3 metres!\\n然后笑了很久。", photos: [P1, P2, P3], createdAt: "2026-10-03T09:15:00.000Z", updatedAt: "2026-10-03T09:20:00.000Z" },
      { id: "m-1760000000001-d4e5f6", childId: "emma", date: "2026-10-05", text: "Quiet morning with the pink tower.", photos: [], createdAt: "2026-10-05T07:00:00.000Z", updatedAt: "2026-10-05T07:00:00.000Z" },
      { id: "m-1760000000002-zzzzzz", childId: "c-1760000000001", date: "2026-09-01", title: "Zoë's garden", photos: [P4], createdAt: "2026-09-01T07:00:00.000Z", updatedAt: "2026-09-01T07:00:00.000Z" },
      { id: "obs-o1", childId: "emma", date: "2026-10-08", text: "Maya carefully repeated the pouring sequence three times and restored the work independently.", photos: [], createdAt: "2026-10-08T12:00:00.000Z", updatedAt: "2026-10-08T12:00:00.000Z" },
      { id: "obs-o2", childId: "noah", date: "2026-10-07", text: "Leo visually scanned the tablets before matching each pair.", photos: [], createdAt: "2026-10-07T12:00:00.000Z", updatedAt: "2026-10-07T12:00:00.000Z" },
    ],
    "rootmap-migrated-legacy": ["obs:o1", "obs:o2"],
    "rootmap-records": [
      { id: "t-1760000000000-qwerty", childId: "c-1760000000000", kind: "tried", activityId: "dotting", lesson: "Dotting", date: "2026-10-04", createdAt: "2026-10-04T10:00:00.000Z", notes: "Used the big brush" },
      { id: "r1", childId: "emma", lesson: "Pouring Water", area: "Practical Life", stage: "Practicing", date: "2026-10-08" },
      { id: "r2", childId: "emma", lesson: "Pink Tower", area: "Sensorial", stage: "Independent", date: "2026-10-05" },
    ],
    "rootmap-plans": [{ id: "p-1760000000000", activityId: "dotting", date: "2026-10-14", childIds: ["c-1760000000000"], note: "after nap" }, { id: "p-1760000000001", activityId: "water-pouring", date: "2026-10-10", childIds: ["emma"], completed: true, completedDate: "2026-10-10" }],
    "rootmap-goals": [{ id: "g-1760000000000", title: "Read together every night 每晚一起读书", completed: false, createdAt: "2026-09-01T00:00:00.000Z" }, { id: "g-1760000000001", title: "Less screen time", description: "weekends", completed: true, createdAt: "2026-09-02T00:00:00.000Z", completedAt: "2026-10-01T00:00:00.000Z" }],
    "rootmap-saved": ["water-pouring", "dotting", "sweeping"],
    "rootmap-journal-drafts": { "emma:new": { childId: "emma", date: "2026-10-09", title: "Half-written", text: "She said 'again!'", photos: [P2], savedAt: "2026-10-09T20:00:00.000Z" } },
    "rootmap-profile": { name: "Lin Wei 林伟", photo: C, contact: "lin@example.com" },
    "rootmap-language": "en", "rootmap-appearance": "light", "rootmap-seed-version": 3,
    "rootmap-read-notifications": ["n1"], "rootmap-pref-Follow-up reminders": false,
  };
  localStorage.clear();
  for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
  localStorage.setItem("rootmap-personal-notes", "Custom activity: 纸杯电话\\nMaterials:");
  localStorage.setItem("rootmap-goals.corrupt", "{unreadable");
  return { data, photos: { A, B, C, P1, P2, P3, P4 } };
})()`;
