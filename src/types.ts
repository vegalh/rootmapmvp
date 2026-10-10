export type Stage = "Introduced" | "Practicing" | "Independent";
export type Area = "Practical Life" | "Sensorial" | "Language" | "Mathematics" | "Cultural Studies";

export type Child = {
  id: string;
  first: string;
  last: string;
  // ISO birthdate ("2023-08-10"); age is computed from this relative to today.
  dob: string;
  enrolled: string;
  lessons: number;
  group: string;
  photo: string;
  notes?: string;
  // Chinese display variant; falls back to the English field above when absent.
  enrolledZh?: string;
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
  notesZh?: string;
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

export type Lang = "en" | "zh";

export type Screen =
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
  | "language"
  | "appearance"
  | "notifications"
  | "notificationPrefs"
  | "personal"
  | "privacy"
  | "help";

export type ModalKind = "quick" | "filters" | "addChild" | "plan" | "observation" | "weekAdd" | null;
