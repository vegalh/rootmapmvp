import type { Child } from "../types";
import mayaPhoto from "../assets/children/maya.svg";
import leoPhoto from "../assets/children/leo.svg";

// Add a new child by appending an entry here with a unique `id`.
// `dob` is the child's birthdate; their displayed age is computed from it automatically.
export const initialChildren: Child[] = [
  { id: "emma", first: "Maya", last: "Hao", dob: "2023-08-10", enrolled: "September 2025", lessons: 12, group: "Primary", photo: mayaPhoto, enrolledZh: "2025年9月" },
  { id: "noah", first: "Leo", last: "Hao", dob: "2024-02-10", enrolled: "January 2026", lessons: 8, group: "Toddler", photo: leoPhoto, enrolledZh: "2026年1月" },
];
