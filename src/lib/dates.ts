// Formats an ISO date string ("2026-10-08") as "Oct 8, 2026".
export const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const isoToday = () => new Date().toISOString().slice(0, 10);
