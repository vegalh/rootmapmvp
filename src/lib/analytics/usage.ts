import { FEATURES, type Feature, type UsageKind } from "./catalog";

// The device side of usage analytics, kept pure (no browser APIs, the clock passed in) so the unit tests drive it
// directly. lib/analytics/tracker.ts wires it to the page.

// ── Impressions: at most one per feature per page visit ──────────────────────────────────────────────────────
// A page visit starts when the page address changes (App calls `newVisit`). Re-renders, a language switch or a list
// refreshing in place keep the visit, so they never count again.
export class ImpressionGate {
  private visit = 0;
  private seen = new Set<string>();
  newVisit() {
    this.visit += 1;
    this.seen.clear();
  }
  // True the first time `feature` is shown in this visit.
  first(feature: Feature) {
    if (this.seen.has(feature)) return false;
    this.seen.add(feature);
    return true;
  }
}

// ── Active time ──────────────────────────────────────────────────────────────────────────────────────────────
// Time counts only while the app is visible and the parent did something within the last minute: each action
// (tap, key, scroll) opens a window of IDLE_MS; time inside those windows counts, gaps between them don't. Going
// to the background closes the window at once; coming back counts as an action. A sleeping device or a clock jump
// therefore adds at most IDLE_MS, and a clock going backwards adds nothing.
export const IDLE_MS = 60_000;
// Most time one device reports for one day (the server caps each person's day at the same figure).
export const DAY_CAP_SECONDS = 12 * 60 * 60;

export class ActiveTimer {
  private countedTo = 0;
  private activeUntil = 0;
  private credit: (ms: number, startedAt: number) => void;
  private visible: boolean;
  constructor(credit: (ms: number, startedAt: number) => void, visible = true) {
    this.credit = credit;
    this.visible = visible;
  }

  // Credits time up to `now`. Call it before reporting, so the time so far is included.
  advance(now: number) {
    if (now < this.countedTo) {
      this.countedTo = now;
      this.activeUntil = Math.min(this.activeUntil, now);
      return;
    }
    const end = Math.min(now, this.activeUntil);
    if (end > this.countedTo) {
      this.credit(end - this.countedTo, this.countedTo);
      this.countedTo = end;
    }
  }
  activity(now: number) {
    if (!this.visible) return;
    this.advance(now);
    if (now > this.countedTo) this.countedTo = now;
    this.activeUntil = now + IDLE_MS;
  }
  hidden(now: number) {
    this.advance(now);
    this.visible = false;
    this.activeUntil = Math.min(this.activeUntil, now);
  }
  shown(now: number) {
    this.visible = true;
    this.activity(now);
  }
}

// ── Waiting to be sent ───────────────────────────────────────────────────────────────────────────────────────
// Counts and milliseconds per local day, added up on the device; `seal` turns them into batches for record_usage().
// A batch keeps its random id until it is accepted, so a retry is never counted twice by the server. Nothing in
// here names the parent, the device or a child; the guest id is added only when a batch is sent.
export type UsageBatch = {
  v: 1;
  batch_id: string;
  day: string;
  events: { feature: Feature; kind: UsageKind; count: number }[];
  seconds: number;
};
type Open = { counts: Record<string, number>; ms: number };
type State = { open: Record<string, Open>; sealed: UsageBatch[]; seconds: Record<string, number> };

export const PENDING_KEY = "rootmap.usage-pending";
const MAX_COUNT = 500; // per event per batch (the server's limit)
const MAX_SEALED = 50;
const MAX_AGE_DAYS = 7; // the server refuses older days
type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const isFeature = (f: string): f is Feature => (FEATURES as readonly string[]).includes(f);

export class UsageQueue {
  private storage: KV | undefined;
  constructor(storage: KV | undefined) {
    this.storage = storage;
  }

  private read(): State {
    try {
      const raw = this.storage?.getItem(PENDING_KEY);
      const s = raw ? JSON.parse(raw) : null;
      if (s && typeof s === "object" && s.open && Array.isArray(s.sealed) && s.seconds) return s;
    } catch {
      // unreadable: start again (only counts are lost)
    }
    return { open: {}, sealed: [], seconds: {} };
  }
  private write(s: State) {
    try { this.storage?.setItem(PENDING_KEY, JSON.stringify(s)); } catch { /* full or blocked: counts are best effort */ }
  }
  private bucket(s: State, day: string) {
    return (s.open[day] ??= { counts: {}, ms: 0 });
  }

  add(day: string, feature: Feature, kind: UsageKind) {
    const s = this.read();
    const b = this.bucket(s, day);
    const key = `${feature}|${kind}`;
    b.counts[key] = (b.counts[key] ?? 0) + 1;
    this.write(s);
  }

  // Active time, held to DAY_CAP_SECONDS per day on this device.
  addTime(day: string, ms: number) {
    if (!(ms > 0)) return;
    const s = this.read();
    const b = this.bucket(s, day);
    const room = DAY_CAP_SECONDS * 1000 - (s.seconds[day] ?? 0) * 1000 - b.ms;
    b.ms += Math.max(0, Math.min(ms, room));
    this.write(s);
  }

  // Turns everything open into batches (whole seconds; the remainder waits). Days the server would refuse are
  // dropped, and only the newest MAX_SEALED batches are kept.
  seal(today: string, newId: () => string): UsageBatch[] {
    const s = this.read();
    for (const [day, b] of Object.entries(s.open)) {
      const age = daysBetween(day, today);
      if (!(age >= 0 && age <= MAX_AGE_DAYS)) { delete s.open[day]; continue; }
      const events: UsageBatch["events"] = [];
      for (const [key, n] of Object.entries(b.counts)) {
        const [feature, kind] = key.split("|");
        if (!isFeature(feature) || (kind !== "impression" && kind !== "click") || !(n > 0)) { delete b.counts[key]; continue; }
        const count = Math.min(n, MAX_COUNT);
        events.push({ feature, kind, count });
        if (n > count) b.counts[key] = n - count;
        else delete b.counts[key];
      }
      const seconds = Math.floor(b.ms / 1000);
      b.ms -= seconds * 1000;
      if (!Object.keys(b.counts).length && b.ms === 0) delete s.open[day];
      if (!events.length && seconds === 0) continue;
      s.sealed.push({ v: 1, batch_id: newId(), day, events, seconds });
      s.seconds[day] = (s.seconds[day] ?? 0) + seconds;
    }
    for (const day of Object.keys(s.seconds)) if (!(daysBetween(day, today) <= MAX_AGE_DAYS)) delete s.seconds[day];
    s.sealed = s.sealed.filter(b => { const age = daysBetween(b.day, today); return age >= 0 && age <= MAX_AGE_DAYS; }).slice(-MAX_SEALED);
    this.write(s);
    return s.sealed;
  }

  // The batch was accepted, or refused for good: either way it is not sent again.
  done(batchId: string) {
    const s = this.read();
    s.sealed = s.sealed.filter(b => b.batch_id !== batchId);
    this.write(s);
  }

  clear() {
    try { this.storage?.removeItem(PENDING_KEY); } catch { /* nothing more to do */ }
  }
}

// ── The tracker ──────────────────────────────────────────────────────────────────────────────────────────────
// Everything above put together, with the browser and the network passed in (lib/analytics/tracker.ts).
// Counts only while `enabled` (the build allows analytics) and the parent has turned sharing on. Turning it off
// deletes the queue and the guest id, and nothing more is counted or sent.
export const SHARING_KEY = "rootmap.usage-sharing";
export const GUEST_KEY = "rootmap.usage-guest-id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// "sent": accepted (or already counted); "refused": malformed or over a limit, never worth retrying; "later".
export type SendResult = "sent" | "refused" | "later";
export type TrackerDeps = {
  enabled: boolean;
  storage: KV | undefined;
  now: () => number;
  dayOf: (ms: number) => string; // the device's local date
  newId: () => string;
  // Calls `guestId` only for an anonymous batch; signed in, the batch goes with the session and no guest id.
  send: (batch: UsageBatch, guestId: () => string) => Promise<SendResult>;
};

export function createUsageTracker(d: TrackerDeps) {
  const get = (key: string) => { try { return d.storage?.getItem(key) ?? null; } catch { return null; } };
  const set = (key: string, value: string) => { try { d.storage?.setItem(key, value); } catch { /* this visit only */ } };
  const remove = (key: string) => { try { d.storage?.removeItem(key); } catch { /* nothing more to do */ } };

  const queue = new UsageQueue(d.storage);
  const gate = new ImpressionGate();
  let sharing = d.enabled && get(SHARING_KEY) === "on";
  // Active time is added up in memory and handed to the queue when sending, so scrolling never writes to storage.
  const pendingMs = new Map<string, number>();
  const newTimer = (visible: boolean) => new ActiveTimer((ms, at) => {
    if (!sharing) return;
    const day = d.dayOf(at);
    pendingMs.set(day, (pendingMs.get(day) ?? 0) + ms);
  }, visible);
  let timer = newTimer(false);
  let sending = false;

  const guestId = () => {
    const stored = get(GUEST_KEY);
    if (stored && UUID.test(stored)) return stored;
    const id = d.newId();
    set(GUEST_KEY, id);
    return id;
  };

  return {
    sharing: () => sharing,
    setSharing(on: boolean, visible = false) {
      if (!d.enabled) return;
      if (on) {
        set(SHARING_KEY, "on");
        sharing = true;
        if (visible) timer.shown(d.now());
      } else {
        sharing = false;
        remove(SHARING_KEY);
        remove(GUEST_KEY);
        queue.clear();
        pendingMs.clear();
        timer = newTimer(false);
      }
    },
    newVisit: () => gate.newVisit(),
    impression(feature: Feature) {
      if (sharing && gate.first(feature)) queue.add(d.dayOf(d.now()), feature, "impression");
    },
    click(feature: Feature) {
      if (sharing) queue.add(d.dayOf(d.now()), feature, "click");
    },
    activity: () => { if (sharing) timer.activity(d.now()); },
    shown: () => { if (sharing) timer.shown(d.now()); },
    hidden: () => { if (sharing) timer.hidden(d.now()); },
    // Seals what is waiting and sends it, oldest first, stopping at the first batch that must wait.
    async flush() {
      if (!sharing || sending) return;
      sending = true;
      try {
        timer.advance(d.now());
        for (const [day, ms] of pendingMs) queue.addTime(day, ms);
        pendingMs.clear();
        for (const batch of queue.seal(d.dayOf(d.now()), d.newId)) {
          const result = await d.send(batch, guestId);
          if (!sharing) return;
          if (result === "later") break;
          queue.done(batch.batch_id);
        }
      } finally {
        sending = false;
      }
    },
  };
}
