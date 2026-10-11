import type { Child } from "../types";
import emmaPhoto from "../assets/children/emma.jpg";
import noahPhoto from "../assets/children/noah.jpg";

// Add a new child by appending an entry here with a unique `id`.
// `dob` is the child's birthdate; their displayed age is computed from it automatically.
export const initialChildren: Child[] = [
  { id: "emma", first: "Emma", last: "Hao", dob: "2023-08-10", enrolled: "September 2025", lessons: 12, group: "Primary", photo: emmaPhoto, enrolledZh: "2025年9月" },
  { id: "noah", first: "Noah", last: "Hao", dob: "2024-02-10", enrolled: "January 2026", lessons: 8, group: "Toddler", photo: noahPhoto, enrolledZh: "2026年1月" },
  { id: "sophia", first: "Sophia", last: "Martinez", dob: "2023-04-10", enrolled: "August 2025", lessons: 16, group: "Primary", photo: "https://images.unsplash.com/photo-1595760780346-f972eb49709f?auto=format&fit=crop&w=300&q=85", enrolledZh: "2025年8月" },
  { id: "oliver", first: "Oliver", last: "Chen", dob: "2023-09-10", enrolled: "October 2025", lessons: 10, group: "Primary", photo: "https://images.unsplash.com/photo-1608734265656-f035d3e7bcbf?auto=format&fit=crop&w=300&q=85", enrolledZh: "2025年10月" },
  { id: "mia", first: "Mia", last: "Anderson", dob: "2023-11-10", enrolled: "February 2026", lessons: 9, group: "Toddler", photo: "https://images.unsplash.com/photo-1472490059022-d5d084f09e5e?auto=format&fit=crop&w=300&q=85", enrolledZh: "2026年2月" },
  { id: "lucas", first: "Lucas", last: "Davis", dob: "2023-06-10", enrolled: "September 2025", lessons: 11, group: "Primary", photo: "https://images.unsplash.com/photo-1584277899644-95e4e1273719?auto=format&fit=crop&w=300&q=85", enrolledZh: "2025年9月" },
];
