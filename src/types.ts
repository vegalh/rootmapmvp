// Sync metadata the data layer (src/lib/data) keeps on every stored record, ready for future cloud sync.
// All timestamps are UTC ISO strings; dates are only converted to local time for display.
export type SyncMeta = {
  // When the record was first created. null = it predates timestamps (see docs/data-architecture.md); never invented.
  createdAt?: string | null;
  // Last local change. Set by the data layer on every write.
  updatedAt?: string;
  // Soft deletion: the record stays stored (and keeps its id) but is hidden. For children this is "Recently Deleted".
  deletedAt?: string | null;
  // Where the record came from: bundled demo data, the parent, or not reliably known (legacy data).
  origin?: "demo" | "user" | "unknown";
  // When it was copied out of localStorage by the IndexedDB migration.
  migratedAt?: string;
  // Display order within its collection (lists keep the order the parent saw before).
  position?: number;
  // Original id when a legacy record had to be re-keyed because two different records shared one id.
  legacyId?: string;
};

export type Stage = "Introduced" | "Practicing" | "Independent";
// The five learning areas of the first Record form. Records made with it keep these values; newer records use the
// Discover categories (src/data/activities.ts `categories`), so a record's `area` is any of either.
export type LegacyArea = "Practical Life" | "Sensorial" | "Language" | "Mathematics" | "Cultural Studies";

export type Child = SyncMeta & {
  id: string;
  first: string;
  last: string;
  // ISO birthdate ("2023-08-10"); age is computed from this relative to today.
  dob: string;
  enrolled: string;
  lessons: number;
  group: string;
  // A stored photo id ("photo-…", see lib/data/photos.ts) or a bundled/remote image URL. Render with photoUrl().
  photo: string;
  notes?: string;
  // Chinese display variant; falls back to the English field above when absent.
  enrolledZh?: string;
  // Things the child is currently interested in; shown on the child-selection card.
  interests?: string[];
};

// A profile removed from My Children: the same child record, soft-deleted (`deletedAt` set). Its records,
// entries and plans stay keyed by `id`, so restoring the profile brings them back.
export type DeletedChild = Child & { deletedAt: string };

export type ProfileInfo = {
  name: string;
  // Photo id or image URL, like Child.photo.
  photo: string;
  contact: string;
};

// One activity done with a child (collection "records"), shown on the child's Activities tab. Built only by
// `buildActivityRecord` (lib/activityRecords.ts), whichever screen it was recorded from. Four shapes:
// - catalog record (Add Activity): `activityId` + the activity's English title and category as a snapshot;
// - custom record (Add Activity › Other): no `activityId`, the parent's own title and a Discover category;
// - legacy record (the first Record form): no `activityId`, a lesson from `areaLessons` and a LegacyArea;
// - "Mark as Tried" (kind "tried"): `activityId` + title snapshot, no area or stage.
// Stage, notes and skills are optional on all of them.
export type LessonRecord = SyncMeta & {
  id: string;
  childId: string;
  // Display name, never rewritten: the activity's English title when recorded (shown if it's later removed from
  // Discover), the custom name exactly as typed, or the legacy lesson name.
  lesson: string;
  // Learning area: a Discover category (catalog and custom records) or a LegacyArea (legacy records).
  area?: string;
  stage?: Stage;
  date: string;
  kind?: "tried";
  // Catalog activity id (an activity or a music activity, see lib/catalog.ts); absent on custom and legacy records.
  activityId?: string;
  notes?: string;
  nextSteps?: string;
  skills?: string[];
  notesZh?: string;
  // My Week: the plan this record completed. Kept on this device to avoid recording one completion twice; not part
  // of the synced columns, so another device sees an ordinary "tried" record.
  planId?: string;
};

export type Observation = SyncMeta & {
  id: string;
  childId: string;
  date: string;
  notes: string;
  area?: string;
  lesson?: string;
  skills: string[];
  nextSteps?: string;
  followUp?: string;
  notesZh?: string;
  nextStepsZh?: string;
};

// Stable ids for Discover's Setting and Materials filters; display labels come from lib/i18n.ts.
export type ActivitySetting = "home" | "restaurant" | "waiting" | "airplane" | "train" | "walking" | "park" | "grocery";
export type MaterialType = "none" | "everyday";
// Discover's Category filter: one primary category per activity, chosen for what the activity is for. Separate from
// `area` (the learning area that activity records snapshot and Add Activity groups by), which stays as it was.
export type DiscoverCategory = "practical-life" | "language" | "math" | "art-creativity" | "nature-culture" | "sensory-movement";

export type Activity = {
  id: string;
  title: string;
  age: string;
  ageKey: string;
  area: string;
  topic: string;
  category: DiscoverCategory;
  minutes: number;
  materialsLabel: string;
  image: string;
  description: string;
  domains: string[];
  materials: string[];
  steps: string[];
  keywords: string;
  // A short safety note for activities with water, small objects, food that can be choked on, blades or heat.
  safety?: string;
  // Where the activity can realistically and safely be done (Discover's Setting filter). Absent = not yet reviewed:
  // the activity is then only listed under "All Settings".
  settings?: ActivitySetting[];
  // What it needs (Discover's Materials filter): "none" = nothing to bring, buy or prepare; "everyday" = common
  // household objects or things found where you are. Absent when it needs specialized or prepared materials.
  materialType?: MaterialType;
  // Chinese translations of the display fields above; English fields remain the stored source of truth. Search
  // (lib/catalog.ts) matches both languages.
  zh?: {
    title?: string;
    // Extra Chinese search words, space-separated (e.g. "倒水 水壶"). Optional; add them when you have accurate ones.
    keywords?: string;
    age?: string;
    materialsLabel?: string;
    description?: string;
    domains?: string[];
    materials?: string[];
    steps?: string[];
    safety?: string;
  };
};

// Age bands shared by the Discover filters. A book or music activity can belong to several.
export type AgeRange = "0–2" | "2–3" | "3–6" | "6+";

// A book in the curated Discover > Books collection (src/data/books.ts). One record per book: its English and
// Chinese editions share the id (what the Family Bookshelf stores). `*Zh` fields are the Chinese edition's text.
export type Book = {
  id: string;
  title: string;
  titleZh?: string;
  author: string;
  authorZh?: string;
  // RootMap's recommended reading age in years, e.g. 2–5 → { from: 2, to: 5 }; `plus` for "4–6+". The book is
  // listed under every age filter this overlaps (lib/catalog.ts `bookAgeRanges`).
  readingAge: { from: number; to: number; plus?: boolean };
  // Each edition's own cover (imported images; portraits of any proportion). Never swapped for the other
  // language: without the edition's cover, a placeholder with the title in that language is drawn.
  coverEn?: string;
  coverZh?: string;
  description: string;
  descriptionZh?: string;
  whyWeRecommend: string;
  whyWeRecommendZh?: string;
};

// Where a book sits on the Family Bookshelf: owned ("My Books") or wanted ("Wishlist").
export type Shelf = "owned" | "wishlist";
// One book on the Family Bookshelf (setting "rootmap-bookshelf"). A book is on at most one shelf.
export type ShelfItem = { bookId: string; shelf: Shelf; addedAt: string };

// An interactive music activity (src/data/music.ts). Its id shares the activity id space, so saving, My Week
// plans and "Mark as Tried" records work exactly as they do for Discover activities.
export type MusicActivity = {
  id: string;
  title: string;
  titleZh?: string;
  ageRanges: AgeRange[];
  // How long the activity takes, in minutes (the recording's own length is read from the file).
  duration: number;
  // Imported image; a soft illustrated cover is used when absent.
  coverImage?: string;
  // Imported audio file (MP3 or M4A). Absent until a recording is added; the page then says it's coming soon.
  audioSrc?: string;
  description: string;
  descriptionZh?: string;
  howToPlay: string[];
  howToPlayZh?: string[];
  whatChildrenExplore: string[];
  whatChildrenExploreZh?: string[];
  // Optional extra search words (space-separated), English and Chinese.
  keywords?: string;
  keywordsZh?: string;
  // Discover's Setting and Materials filters, as on Activity. Music is always in the Art & Creativity category.
  settings?: ActivitySetting[];
  materialType?: MaterialType;
};

export type Plan = SyncMeta & {
  id: string;
  activityId: string;
  date: string;
  childIds: string[];
  note?: string;
  completed?: boolean;
  completedDate?: string;
  observation?: string;
};

// One childhood memory: the single recording model behind both the Moments timeline and each
// child's Journal (collection "entries", see lib/entries.ts). Needs text (title or body)
// and/or at least one photo.
export type Entry = SyncMeta & {
  id: string;
  childId: string;
  // ISO date the memory is about ("2026-10-11").
  date: string;
  title?: string;
  text?: string;
  // Chinese text carried over from seed observations; dropped once the text is edited.
  textZh?: string;
  // Stored photo ids ("photo-…"), in display order. Render with photoUrl().
  photos: string[];
  createdAt: string;
  updatedAt: string;
  // Set when the entry was created from the child's legacy `notes` field.
  fromNotes?: boolean;
  // Original observation this entry was imported from, kept intact (incl. educational metadata) but not shown.
  legacyObservation?: Observation;
};

// Unsaved editor state, autosaved locally per child + entry (see lib/journalDrafts.ts).
export type EntryDraft = {
  // Child the draft is for; absent in drafts written before Moments could pick a child.
  childId?: string;
  date: string;
  title: string;
  text: string;
  // Photo ids, stored as soon as they're added so a draft never embeds image data.
  photos: string[];
  savedAt: string;
};

// A personal intention belonging to the parent/user — unrelated to any child.
export type Goal = SyncMeta & {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
};

export type Lang = "en" | "zh";

export type Screen =
  | "today"
  | "children"
  | "child"
  | "record"
  | "discover"
  | "activity"
  | "book"
  | "music"
  | "bookshelf"
  | "observations"
  // The weekly look back over Moments (pages/WeeklyRecapPage.tsx).
  | "recap"
  | "profile"
  | "week"
  | "saved"
  | "notes"
  | "goals"
  | "entry"
  | "entryEdit"
  | "language"
  | "appearance"
  | "notifications"
  | "notificationPrefs"
  | "personal"
  | "privacy"
  | "help"
  | "backup"
  | "deletedChildren"
  | "account"
  | "guestImport"
  | "signIn";

export type ModalKind = "quick" | "filters" | "addChild" | "editChild" | "plan" | "weekAdd" | "tried" | null;
