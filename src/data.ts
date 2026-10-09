export type Stage = "Introduced" | "Practicing" | "Independent";
export type Area = "Practical Life" | "Sensorial" | "Language" | "Mathematics" | "Cultural Studies";

export type Child = {
  id: string;
  first: string;
  last: string;
  age: string;
  shortAge: string;
  ageYears: number;
  enrolled: string;
  lessons: number;
  group: string;
  photo: string;
  notes?: string;
};

export type LessonRecord = {
  id: string;
  childId: string;
  lesson: string;
  area: Area;
  stage: Stage;
  date: string;
  notes?: string;
  nextSteps?: string;
  skills?: string[];
};

export type Observation = {
  id: string;
  childId: string;
  date: string;
  notes: string;
  area?: string;
  lesson?: string;
  skills: string[];
  nextSteps?: string;
  followUp?: string;
};

export type Activity = {
  id: string;
  title: string;
  age: string;
  ageKey: string;
  area: string;
  topic: string;
  minutes: number;
  materialsLabel: string;
  image: string;
  description: string;
  domains: string[];
  materials: string[];
  steps: string[];
  keywords: string;
};

export type Plan = {
  id: string;
  activityId: string;
  date: string;
  childIds: string[];
  note?: string;
  completed?: boolean;
  completedDate?: string;
  observation?: string;
};

export const initialChildren: Child[] = [
  { id: "emma", first: "Emma", last: "Thompson", age: "3 years, 2 months", shortAge: "3y 2m", ageYears: 3.2, enrolled: "September 2025", lessons: 12, group: "Primary", photo: "https://images.unsplash.com/photo-1497881807663-38b9a95b7192?auto=format&fit=crop&w=300&q=85" },
  { id: "noah", first: "Noah", last: "Williams", age: "2 years, 8 months", shortAge: "2y 8m", ageYears: 2.7, enrolled: "January 2026", lessons: 8, group: "Toddler", photo: "https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=300&q=85" },
  { id: "sophia", first: "Sophia", last: "Martinez", age: "3 years, 6 months", shortAge: "3y 6m", ageYears: 3.5, enrolled: "August 2025", lessons: 16, group: "Primary", photo: "https://images.unsplash.com/photo-1595760780346-f972eb49709f?auto=format&fit=crop&w=300&q=85" },
  { id: "oliver", first: "Oliver", last: "Chen", age: "3 years, 1 month", shortAge: "3y 1m", ageYears: 3.1, enrolled: "October 2025", lessons: 10, group: "Primary", photo: "https://images.unsplash.com/photo-1608734265656-f035d3e7bcbf?auto=format&fit=crop&w=300&q=85" },
  { id: "mia", first: "Mia", last: "Anderson", age: "2 years, 11 months", shortAge: "2y 11m", ageYears: 2.9, enrolled: "February 2026", lessons: 9, group: "Toddler", photo: "https://images.unsplash.com/photo-1472490059022-d5d084f09e5e?auto=format&fit=crop&w=300&q=85" },
  { id: "lucas", first: "Lucas", last: "Davis", age: "3 years, 4 months", shortAge: "3y 4m", ageYears: 3.3, enrolled: "September 2025", lessons: 11, group: "Primary", photo: "https://images.unsplash.com/photo-1584277899644-95e4e1273719?auto=format&fit=crop&w=300&q=85" },
];

export const initialRecords: LessonRecord[] = [
  { id: "r1", childId: "emma", lesson: "Pouring Water", area: "Practical Life", stage: "Practicing", date: "2026-10-08", notes: "Emma poured water between two pitchers three times. She independently used a sponge to clean the table.", skills: ["Concentration", "Independence"] },
  { id: "r2", childId: "emma", lesson: "Pink Tower", area: "Sensorial", stage: "Independent", date: "2026-10-05" },
  { id: "r3", childId: "emma", lesson: "Color Tablets", area: "Sensorial", stage: "Introduced", date: "2026-10-02" },
  { id: "r4", childId: "noah", lesson: "Color Tablets", area: "Sensorial", stage: "Practicing", date: "2026-10-07", notes: "Noah matched three pairs and returned the tablets to the box." },
  { id: "r5", childId: "sophia", lesson: "Pink Tower", area: "Sensorial", stage: "Independent", date: "2026-10-06" },
];

export const initialObservations: Observation[] = [
  { id: "o1", childId: "emma", date: "2026-10-08", notes: "Emma carefully repeated the pouring sequence three times and restored the work independently.", area: "Practical Life", lesson: "Pouring Water", skills: ["Concentration", "Independence"], nextSteps: "Offer a smaller pouring vessel next week." },
  { id: "o2", childId: "noah", date: "2026-10-07", notes: "Noah visually scanned the tablets before matching each pair.", area: "Sensorial", lesson: "Color Tablets", skills: ["Visual discrimination", "Order"] },
];

const img = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=85`;
export const activities: Activity[] = [
  { id: "leaf-transfer", title: "Leaf Transfer", age: "2–3 years", ageKey: "2–3", area: "Practical Life", topic: "Nature", minutes: 10, materialsLabel: "3 materials", image: img("photo-1602774433910-a4c76f948875"), description: "Children practice coordination and concentration by transferring leaves from one container to another using tongs.", domains: ["Fine Motor Coordination", "Concentration", "Independence", "Nature Exploration"], materials: ["Two small baskets or bowls", "Leaves (real or artificial)", "Child-sized tongs", "Tray or mat (optional)"], steps: ["Invite the child to the activity and name the materials.", "Slowly demonstrate using the tongs to pick up one leaf.", "Transfer the leaf to the second basket.", "Repeat a few times, then invite the child to try.", "Allow uninterrupted exploration and repetition."], keywords: "leaves tongs autumn transfer coordination" },
  { id: "color-mixing", title: "Color Mixing", age: "3–4 years", ageKey: "3–4", area: "Science", topic: "Creativity", minutes: 15, materialsLabel: "5 materials", image: img("photo-1616706161242-f1d591350d1c"), description: "Explore how primary colors combine through careful dropper work.", domains: ["Color awareness", "Prediction", "Fine Motor Coordination"], materials: ["Clear cups", "Water", "Food coloring", "Droppers", "Small cloth"], steps: ["Fill three cups with water.", "Add one primary color to each.", "Demonstrate transferring two colors.", "Invite predictions.", "Compare the mixed colors."], keywords: "color water experiment dropper science" },
  { id: "pouring-practice", title: "Pouring Practice", age: "2–3 years", ageKey: "2–3", area: "Practical Life", topic: "Independence", minutes: 8, materialsLabel: "4 materials", image: img("photo-1574095059431-815305ba05a0"), description: "Build control and independence by pouring between two child-sized vessels.", domains: ["Coordination", "Concentration", "Independence"], materials: ["Two pitchers", "Water", "Sponge", "Tray"], steps: ["Carry the tray to a table.", "Grasp the pitcher with two hands.", "Pour slowly to the marked line.", "Wipe spills if needed.", "Restore the materials."], keywords: "water pitchers practical everyday life" },
  { id: "nature-collage", title: "Nature Collage", age: "3–5 years", ageKey: "3–4", area: "Art", topic: "Nature", minutes: 20, materialsLabel: "6 materials", image: img("photo-1633483781030-e62d0da3944c"), description: "Arrange gathered natural materials into an open-ended composition.", domains: ["Creativity", "Nature Exploration", "Composition"], materials: ["Leaves", "Paper", "Glue", "Brush", "Small basket", "Cloth"], steps: ["Observe each collected item.", "Arrange without glue first.", "Brush glue sparingly.", "Place each item.", "Allow the collage to dry."], keywords: "art leaves collage glue seasons" },
  { id: "storytime", title: "The Very Hungry Caterpillar", age: "2–4 years", ageKey: "2–3", area: "Language", topic: "Language Development", minutes: 15, materialsLabel: "Book + props", image: img("photo-1617117206620-b01f2919ff86"), description: "Share a familiar story with optional objects for sequencing and conversation.", domains: ["Vocabulary", "Sequencing", "Listening"], materials: ["Story book", "Optional food props"], steps: ["Invite children to the reading space.", "Preview the cover.", "Read slowly.", "Pause for observations.", "Retell with props if desired."], keywords: "book reading caterpillar story vocabulary" },
  { id: "rhythm-baskets", title: "Rhythm Baskets", age: "3–6 years", ageKey: "4–6", area: "Music", topic: "Sensory Exploration", minutes: 12, materialsLabel: "4 materials", image: img("photo-1658438383063-d5a53b0d3249"), description: "Compare soft and strong sounds using a small collection of percussion instruments.", domains: ["Auditory discrimination", "Rhythm", "Movement"], materials: ["Shaker", "Bell", "Drum", "Basket"], steps: ["Name each instrument.", "Listen to one sound.", "Copy a short rhythm.", "Invite the child to lead.", "Return instruments quietly."], keywords: "music rhythm sound instruments listening" },
  { id: "number-hunt", title: "Number Hunt", age: "4–6 years", ageKey: "4–6", area: "Math", topic: "Everyday Life", minutes: 15, materialsLabel: "3 materials", image: img("photo-1596464716127-f2a82984de30"), description: "Match numeral cards to quantities found around the room.", domains: ["Number recognition", "Counting", "Movement"], materials: ["Numeral cards", "Small basket", "Counting objects"], steps: ["Choose a numeral.", "Name it together.", "Find that many objects.", "Count to verify.", "Repeat with another numeral."], keywords: "math numbers counting hunt" },
  { id: "continent-match", title: "Continent Match", age: "4–6 years", ageKey: "4–6", area: "Culture", topic: "Everyday Life", minutes: 18, materialsLabel: "5 materials", image: img("photo-1477414348463-c0eb7f1359b6"), description: "Pair familiar animals and landmarks with continent cards.", domains: ["Geography", "Classification", "Language"], materials: ["Continent cards", "Animal figures", "Landmark cards", "Mat", "Basket"], steps: ["Lay out continent cards.", "Name each continent.", "Choose one figure.", "Discuss where it belongs.", "Place and repeat."], keywords: "culture geography continents map animals" },
];

export const areaLessons: Record<Area, string[]> = {
  "Practical Life": ["Pouring Water", "Spooning", "Transferring Objects", "Folding Cloths", "Washing a Table", "Dressing Frames"],
  Sensorial: ["Pink Tower", "Color Tablets", "Brown Stair", "Cylinder Blocks"],
  Language: ["Sandpaper Letters", "Moveable Alphabet", "Object Matching", "Sound Games"],
  Mathematics: ["Number Rods", "Sandpaper Numerals", "Spindle Box", "Golden Beads"],
  "Cultural Studies": ["Land and Water Forms", "Puzzle Maps", "Parts of a Plant", "Living and Non-living"],
};
