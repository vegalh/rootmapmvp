import type { LessonRecord, Observation } from "../types";

// Seed lesson history shown on each child's "Lessons" tab.
export const initialRecords: LessonRecord[] = [
  { id: "r1", childId: "emma", lesson: "Pouring Water", area: "Practical Life", stage: "Practicing", date: "2026-10-08", notes: "Maya poured water between two pitchers three times. She independently used a sponge to clean the table.", notesZh: "Maya在两个水壶之间倒水三次，并独立使用海绵清洁桌面。", skills: ["Concentration", "Independence"] },
  { id: "r2", childId: "emma", lesson: "Pink Tower", area: "Sensorial", stage: "Independent", date: "2026-10-05" },
  { id: "r3", childId: "emma", lesson: "Color Tablets", area: "Sensorial", stage: "Introduced", date: "2026-10-02" },
  { id: "r4", childId: "noah", lesson: "Color Tablets", area: "Sensorial", stage: "Practicing", date: "2026-10-07", notes: "Leo matched three pairs and returned the tablets to the box.", notesZh: "Leo配对了三组色板，并将色板放回盒子。" },
];

// Seed observations shown on the Observations feed and each child's profile.
export const initialObservations: Observation[] = [
  { id: "o1", childId: "emma", date: "2026-10-08", notes: "Maya carefully repeated the pouring sequence three times and restored the work independently.", notesZh: "Maya认真地重复了三次倒水练习，并独立地整理好了材料。", area: "Practical Life", lesson: "Pouring Water", skills: ["Concentration", "Independence"], nextSteps: "Offer a smaller pouring vessel next week.", nextStepsZh: "下周提供一个更小的倒水容器。" },
  { id: "o2", childId: "noah", date: "2026-10-07", notes: "Leo visually scanned the tablets before matching each pair.", notesZh: "Leo在配对每一组色板之前都会先仔细观察。", area: "Sensorial", lesson: "Color Tablets", skills: ["Visual discrimination", "Order"] },
];

// Lesson options offered per learning area on the Record Lesson form.
export const areaLessons: Record<string, string[]> = {
  "Practical Life": ["Pouring Water", "Spooning", "Transferring Objects", "Folding Cloths", "Washing a Table", "Dressing Frames"],
  Sensorial: ["Pink Tower", "Color Tablets", "Brown Stair", "Cylinder Blocks"],
  Language: ["Sandpaper Letters", "Moveable Alphabet", "Object Matching", "Sound Games"],
  Mathematics: ["Number Rods", "Sandpaper Numerals", "Spindle Box", "Golden Beads"],
  "Cultural Studies": ["Land and Water Forms", "Puzzle Maps", "Parts of a Plant", "Living and Non-living"],
};
