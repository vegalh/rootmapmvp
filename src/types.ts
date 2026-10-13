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
export type Area = "Practical Life" | "Sensorial" | "Language" | "Mathematics" | "Cultural Studies";

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

// One activity done with a child (collection "records"), shown on the child's Activities tab.
// Records from the Record form carry a learning area and stage; "Mark as Tried" records (kind "tried") only
// say the parent tried a Discover activity on a date, so area and stage are absent there.
export type LessonRecord = SyncMeta & {
  id: string;
  childId: string;
  // Display name; for tried records the activity's English title, kept in case the activity is later removed.
  lesson: string;
  area?: Area;
  stage?: Stage;
  date: string;
  kind?: "tried";
  // Discover activity id (src/data/activities.ts), set on tried records.
  activityId?: string;
  notes?: string;
  nextSteps?: string;
  skills?: string[];
  notesZh?: string;
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
  // Chinese translations of the display fields above; English fields remain the stored/searchable source of truth.
  zh?: {
    title?: string;
    age?: string;
    materialsLabel?: string;
    description?: string;
    domains?: string[];
    materials?: string[];
    steps?: string[];
  };
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
  | "observations"
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
