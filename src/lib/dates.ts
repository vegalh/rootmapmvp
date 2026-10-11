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

// Today's date in the device's local timezone (isoToday uses UTC, which can be off by a day).
export function localIsoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const dateLocale = (lang: "en" | "zh") => (lang === "zh" ? "zh-CN" : "en-US");
const asDate = (d: string) => new Date(`${d}T12:00:00`);

// "October 2026" / "2026年10月"
export const fmtMonthYear = (d: string, lang: "en" | "zh") => asDate(d).toLocaleDateString(dateLocale(lang), { month: "long", year: "numeric" });
// "October 11" / "10月11日"
export const fmtMonthDay = (d: string, lang: "en" | "zh") => asDate(d).toLocaleDateString(dateLocale(lang), { month: "long", day: "numeric" });
// "October 11, 2026" / "2026年10月11日"
export const fmtLong = (d: string, lang: "en" | "zh") => asDate(d).toLocaleDateString(dateLocale(lang), { month: "long", day: "numeric", year: "numeric" });
