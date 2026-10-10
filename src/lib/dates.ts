// Formats an ISO date string ("2026-10-08") as "Oct 8, 2026".
export const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const isoToday = () => new Date().toISOString().slice(0, 10);

// Computes whole years/months of age from an ISO birthdate, relative to today.
export function ageFromDob(dob: string): { years: number; months: number; totalYears: number } {
  const birth = new Date(`${dob}T12:00:00`);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  years = Math.max(0, years);
  months = Math.max(0, months);
  return { years, months, totalYears: years + months / 12 };
}
