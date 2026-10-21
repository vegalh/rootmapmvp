import type { Activity } from "../types";

// Collections made by RootMap: ready-made lists parents browse (Discover › Collections, and their own page at
// `#/collection/<id>`). Parents don't create them; they can save one (My Week › Saved › My collections).
//
// Membership is a rule, not a list, so a new activity (or music activity) joins every collection it fits
// automatically. A collection with fewer than 3 activities is hidden (lib/collections.ts).
//
// Add a collection: append it here with a stable `id` (saved collections are stored by id: never change one) and
// English and Chinese text. `months` (1–12) limits it to part of the year.
export type Collection = {
  id: string;
  title: string;
  // One line, plain parent language.
  subtitle: string;
  zh: { title: string; subtitle: string };
  match: (a: Activity) => boolean;
  months?: number[];
};

const at = (a: Activity, setting: NonNullable<Activity["settings"]>[number]) => !!a.settings?.includes(setting);
const words = (text: string) => text.toLowerCase().split(/\s+/);

export const collections: Collection[] = [
  {
    id: "after-work",
    title: "After Work, 15 Minutes",
    subtitle: "Short, calm, done before dinner.",
    zh: { title: "下班后15分钟", subtitle: "短短一会儿，晚饭前就能做完。" },
    match: a => a.minutes <= 15 && at(a, "home"),
  },
  {
    id: "nothing-to-buy",
    title: "Nothing to Buy",
    subtitle: "Nothing at all, or things you already have.",
    zh: { title: "不用买任何东西", subtitle: "什么都不用准备，或者用家里现成的东西。" },
    match: a => a.materialType === "none" || a.materialType === "everyday",
  },
  {
    id: "rainy-day",
    title: "Rainy Day at Home",
    subtitle: "For the days you can't go out.",
    zh: { title: "雨天在家", subtitle: "出不了门的日子，在家也能玩得开心。" },
    match: a => at(a, "home") && a.category !== "nature-culture",
  },
  {
    id: "waiting-for-food",
    title: "Waiting for Food",
    subtitle: "Quiet things to do at the table.",
    zh: { title: "餐厅等菜", subtitle: "坐在餐桌边，安安静静就能玩。" },
    match: a => at(a, "restaurant"),
  },
  {
    id: "calm-and-focused",
    title: "Calm and Focused",
    subtitle: "Slow, absorbing, ten minutes or less.",
    zh: { title: "让娃安静下来的", subtitle: "慢下来、玩进去，十分钟以内。" },
    match: a => (a.domains.includes("Concentration") || a.domains.includes("Self-Regulation")) && a.minutes <= 10,
  },
  {
    id: "weekend-kitchen",
    title: "Weekend Kitchen",
    subtitle: "Real kitchen jobs for little hands.",
    zh: { title: "周末一起做饭", subtitle: "给小手的真正厨房活儿。" },
    match: a => a.topic === "Food Preparation",
  },
  {
    id: "autumn",
    title: "Autumn",
    subtitle: "Leaves, pumpkins and harvest days.",
    zh: { title: "秋天限定", subtitle: "落叶、南瓜和丰收的日子。" },
    match: a => a.topic === "Seasons" || words(a.keywords).some(w => w === "fall" || w === "autumn"),
    months: [9, 10, 11],
  },
];
