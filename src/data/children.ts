import type { Child } from "../types";
import emmaPhoto from "../assets/children/emma.jpg";
import noahPhoto from "../assets/children/noah.jpg";

// Add a new child by appending an entry here with a unique `id`.
export const initialChildren: Child[] = [
  { id: "emma", first: "Emma", last: "Thompson", age: "3 years, 2 months", shortAge: "3y 2m", ageYears: 3.2, enrolled: "September 2025", lessons: 12, group: "Primary", photo: emmaPhoto, ageZh: "3岁2个月", shortAgeZh: "3岁2月", enrolledZh: "2025年9月" },
  { id: "noah", first: "Noah", last: "Williams", age: "2 years, 8 months", shortAge: "2y 8m", ageYears: 2.7, enrolled: "January 2026", lessons: 8, group: "Toddler", photo: noahPhoto, ageZh: "2岁8个月", shortAgeZh: "2岁8月", enrolledZh: "2026年1月" },
  { id: "sophia", first: "Sophia", last: "Martinez", age: "3 years, 6 months", shortAge: "3y 6m", ageYears: 3.5, enrolled: "August 2025", lessons: 16, group: "Primary", photo: "https://images.unsplash.com/photo-1595760780346-f972eb49709f?auto=format&fit=crop&w=300&q=85", ageZh: "3岁6个月", shortAgeZh: "3岁6月", enrolledZh: "2025年8月" },
  { id: "oliver", first: "Oliver", last: "Chen", age: "3 years, 1 month", shortAge: "3y 1m", ageYears: 3.1, enrolled: "October 2025", lessons: 10, group: "Primary", photo: "https://images.unsplash.com/photo-1608734265656-f035d3e7bcbf?auto=format&fit=crop&w=300&q=85", ageZh: "3岁1个月", shortAgeZh: "3岁1月", enrolledZh: "2025年10月" },
  { id: "mia", first: "Mia", last: "Anderson", age: "2 years, 11 months", shortAge: "2y 11m", ageYears: 2.9, enrolled: "February 2026", lessons: 9, group: "Toddler", photo: "https://images.unsplash.com/photo-1472490059022-d5d084f09e5e?auto=format&fit=crop&w=300&q=85", ageZh: "2岁11个月", shortAgeZh: "2岁11月", enrolledZh: "2026年2月" },
  { id: "lucas", first: "Lucas", last: "Davis", age: "3 years, 4 months", shortAge: "3y 4m", ageYears: 3.3, enrolled: "September 2025", lessons: 11, group: "Primary", photo: "https://images.unsplash.com/photo-1584277899644-95e4e1273719?auto=format&fit=crop&w=300&q=85", ageZh: "3岁4个月", shortAgeZh: "3岁4月", enrolledZh: "2025年9月" },
];
