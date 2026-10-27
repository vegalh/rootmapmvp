import { getCloudClient } from "../cloud/client";
import { cloudState } from "../cloud/session";

// The admin analytics page's data: only through am_i_admin() and admin_usage_summary(), which check the caller's
// admin row on the server. Hiding the page's entry is a convenience; the database is what refuses everyone else.
// Every count of people or events from 1 to 2 arrives as null ("<3").

export type UsageRange = 7 | 30 | 90;
export type UsageSummary = {
  from: string;
  to: string;
  accounts: { total: number | null; weekly: number | null; monthly: number | null };
  guests: { weekly: number | null; monthly: number | null };
  daily: { day: string; accounts: number | null; guests: number | null; people: number | null; seconds: number | null }[];
  time: { seconds: number | null; personDays: number | null };
  ages: { age: number; children: number | null }[];
  features: { feature: string; impressions: number | null; clicks: number | null }[];
};

// False for guests, other parents and builds without the cloud. A failure counts as not an admin.
export async function amIAdmin(): Promise<boolean> {
  if (cloudState().status !== "signed-in") return false;
  const client = await getCloudClient();
  if (!client) return false;
  const { data, error } = await client.rpc("am_i_admin");
  return !error && data === true;
}

export async function loadUsageSummary(days: UsageRange): Promise<UsageSummary> {
  const client = await getCloudClient();
  if (!client) throw new Error("unavailable");
  const { data, error } = await client.rpc("admin_usage_summary", { p_days: days });
  if (error) throw new Error(error.code === "42501" ? "forbidden" : "failed");
  return data as UsageSummary;
}
