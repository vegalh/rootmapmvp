// Keeps a screen's copy of server data fresh without piling up requests (Shared Child Profiles release readiness;
// used by components/ChildCircle.tsx). Pure: no React, no browser APIs, so the rules are unit-tested.
//
// - One request at a time. Asking again while one is on its way queues exactly one more, started when it lands:
//   the answer on its way may predate a change just made, so a change always gets a fresh read after it.
// - Passive asks (coming back to the page, regaining the network, a timer) are skipped if a request started less
//   than `minIntervalMs` ago. Asks after the parent's own change are `force`d and never skipped.
// - An answer is only applied while it is the newest one and the refresher hasn't been stopped (the screen closed or
//   moved to another child), so a slow, stale answer can never overwrite a newer one.

export type Fetched<T> = { ok: true; value: T } | { ok: false; denied: boolean };

export type Refresher = {
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  stop: () => void;
};

export function createRefresher<T>(
  fetch: () => Promise<Fetched<T>>,
  apply: (result: Fetched<T>) => void,
  { minIntervalMs = 5000, now = () => Date.now() }: { minIntervalMs?: number; now?: () => number } = {},
): Refresher {
  let stopped = false;
  let seq = 0;
  let lastStart = -Infinity;
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  const once = async () => {
    const mine = ++seq;
    lastStart = now();
    let result: Fetched<T>;
    try { result = await fetch(); } catch { result = { ok: false, denied: false }; }
    if (!stopped && mine === seq) apply(result);
  };

  const start = (): Promise<void> => {
    running = once().finally(() => { running = null; });
    return running;
  };

  const refresh = ({ force = false } = {}): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) {
      if (!force && now() - lastStart < minIntervalMs) return running;
      // One follow-up at most, however many asks arrive meanwhile.
      queued ??= running.then(() => { queued = null; return stopped ? undefined : start(); });
      return queued;
    }
    if (!force && now() - lastStart < minIntervalMs) return Promise.resolve();
    return start();
  };

  return { refresh, stop: () => { stopped = true; } };
}

// A Supabase RPC answer as a `Fetched`: 42501 means the server refused this person (no longer in the circle, or not
// allowed), anything else (offline, timeout, a server hiccup) is worth trying again later.
export function fromRpc<T>({ data, error }: { data: unknown; error: { code?: string } | null }): Fetched<T> {
  if (error) return { ok: false, denied: error.code === "42501" };
  return { ok: true, value: data as T };
}
