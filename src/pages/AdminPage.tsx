import { useEffect, useState } from "react";
import { PageHeader } from "../components/ui";
import { loadUsageSummary, type UsageRange, type UsageSummary } from "../lib/analytics/admin";
import { FEATURES, clickRate, secondsPerPerson } from "../lib/analytics/catalog";
import { fmt } from "../lib/dates";
import type { Copy } from "../lib/i18n";
import type { Lang } from "../types";

// Usage analytics for RootMap admins (#/admin, Profile › Account › Admin Dashboard). Reached only from Profile when
// am_i_admin() says so; if anyone else
// opens the address, admin_usage_summary() refuses on the server and this page shows only that. Totals only: the
// server sends 1 and 2 as null, shown as "<3", and never sends an email, an id or one family's activity.

const RANGES: UsageRange[] = [7, 30, 90];
const count = (n: number | null) => (n === null ? "<3" : n.toLocaleString());
const minutes = (seconds: number | null, lang: Lang) => {
  if (seconds === null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return lang === "zh" ? `${m} 分钟` : `${m} min`;
  const h = Math.floor(m / 60);
  return lang === "zh" ? `${h} 小时 ${m % 60} 分钟` : `${h} h ${m % 60} min`;
};
const percent = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);

export default function AdminPage({ back, refused, lang, t }: { back: () => void; refused: () => void; lang: Lang; t: Copy }) {
  const [days, setDays] = useState<UsageRange>(30);
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; summary: UsageSummary } | { status: "error"; forbidden: boolean }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    loadUsageSummary(days).then(
      summary => { if (live) setState({ status: "ready", summary }); },
      (e: Error) => {
        if (!live) return;
        const forbidden = e.message === "forbidden" || e.message === "unavailable";
        setState({ status: "error", forbidden });
        if (forbidden) refused();
      },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `refused` is a new function on every App render
  }, [days, attempt]);
  // Asked again when the app returns to the foreground: access revoked in the meantime ends here.
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === "visible") setAttempt(a => a + 1); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);

  if (state.status === "error" && state.forbidden) {
    return (
      <main className="simple-page">
        <PageHeader title={t.adminAnalytics} back={back} />
        <div className="info-card" role="alert">
          <p>{t.adminForbidden}</p>
          <p className="admin-note">{t.adminForbiddenHint}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="simple-page admin-page">
      <PageHeader title={t.adminAnalytics} subtitle={t.adminSubtitle} back={back} />
      <div className="segmented" role="group" aria-label={t.adminRange}>
        {RANGES.map(n => (
          <button key={n} className={n === days ? "active" : ""} aria-pressed={n === days} onClick={() => setDays(n)}>{t.adminLastDays.replace("{n}", String(n))}</button>
        ))}
      </div>
      {state.status === "loading" && <p className="admin-note" role="status">…</p>}
      {state.status === "error" && (
        <div className="info-card">
          <p>{t.adminLoadFailed}</p>
          <button className="wide-secondary" onClick={() => setAttempt(a => a + 1)}>{t.tryAgain}</button>
        </div>
      )}
      {state.status === "ready" && <Summary s={state.summary} lang={lang} t={t} />}
    </main>
  );
}

function Summary({ s, lang, t }: { s: UsageSummary; lang: Lang; t: Copy }) {
  const last = s.daily[s.daily.length - 1];
  const features = [...s.features].sort((a, b) => FEATURES.indexOf(a.feature as never) - FEATURES.indexOf(b.feature as never));
  const day = (d: string) => fmt(d, lang);
  return (
    <>
      <section className="admin-section" aria-labelledby="admin-people">
        <h2 id="admin-people">{t.adminPeople}</h2>
        <div className="admin-tiles">
          <Tile label={t.adminAccounts} value={count(s.accounts.total)} />
          <Tile label={t.adminActiveToday} value={count(last?.accounts ?? 0)} note={`${t.adminGuestsLabel} ${count(last?.guests ?? 0)}`} />
          <Tile label={t.adminActiveWeek} value={count(s.accounts.weekly)} note={`${t.adminGuestsLabel} ${count(s.guests.weekly)}`} />
          <Tile label={t.adminActiveMonth} value={count(s.accounts.monthly)} note={`${t.adminGuestsLabel} ${count(s.guests.monthly)}`} />
        </div>
        <Bars
          title={t.adminDailyActive}
          items={s.daily.map(d => ({ key: d.day, value: d.people, label: `${day(d.day)}: ${count(d.people)} (${t.adminAccountsLabel} ${count(d.accounts)}, ${t.adminGuestsLabel} ${count(d.guests)})` }))}
          from={day(s.from)} to={day(s.to)} t={t}
        />
      </section>

      <section className="admin-section" aria-labelledby="admin-ages">
        <h2 id="admin-ages">{t.adminAges}</h2>
        {s.ages.length ? (
          <div className="admin-ages">
            {s.ages.map(a => {
              const max = Math.max(...s.ages.map(x => x.children ?? 0), 1);
              return (
                <div className="admin-age" key={a.age}>
                  <span>{t.adminAgeYears.replace("{n}", String(a.age))}</span>
                  <i><b style={{ width: `${((a.children ?? 0) / max) * 100}%` }} /></i>
                  <strong>{count(a.children)}</strong>
                </div>
              );
            })}
          </div>
        ) : <p className="admin-note">{t.adminAgeNone}</p>}
      </section>

      <section className="admin-section" aria-labelledby="admin-time">
        <h2 id="admin-time">{t.adminTime}</h2>
        <div className="admin-tiles two">
          <Tile label={t.adminTimeTotal} value={minutes(s.time.seconds, lang)} />
          <Tile label={t.adminTimePerPerson} value={minutes(secondsPerPerson(s.time), lang)} />
        </div>
        <Bars
          title={t.adminDailyTime}
          items={s.daily.map(d => ({ key: d.day, value: d.seconds, label: `${day(d.day)}: ${minutes(d.seconds, lang)}` }))}
          from={day(s.from)} to={day(s.to)} t={t}
        />
        <p className="admin-note">{t.adminTimeHint}</p>
      </section>

      <section className="admin-section" aria-labelledby="admin-features">
        <h2 id="admin-features">{t.adminFeatures}</h2>
        {features.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th scope="col">{t.adminFeature}</th><th scope="col">{t.adminImpressions}</th><th scope="col">{t.adminClicks}</th><th scope="col">{t.adminRate}</th></tr></thead>
              <tbody>
                {features.map(f => (
                  <tr key={f.feature}>
                    <th scope="row">{t.usageFeatures[f.feature] ?? f.feature}</th>
                    <td>{count(f.impressions)}</td>
                    <td>{count(f.clicks)}</td>
                    <td>{percent(clickRate(f.clicks, f.impressions))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="admin-note">{t.adminNoData}</p>}
        <p className="admin-note">{t.adminRateHint}</p>
      </section>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="admin-tile">
      <small>{label}</small>
      <strong>{value}</strong>
      {note && <span>{note}</span>}
    </div>
  );
}

// One series of daily bars on one scale. A hidden value ("<3" or a day with too few people) has no bar; every bar
// says its day and value on hover and to screen readers.
function Bars({ title, items, from, to, t }: { title: string; items: { key: string; value: number | null; label: string }[]; from: string; to: string; t: Copy }) {
  const max = Math.max(...items.map(i => i.value ?? 0), 0);
  return (
    <figure className="admin-bars">
      <figcaption>{title}</figcaption>
      {max > 0 ? (
        <div className="admin-bars-plot" role="list">
          {items.map(i => (
            <span key={i.key} role="listitem" title={i.label} aria-label={i.label}>
              {i.value ? <b style={{ height: `${Math.max(4, (i.value / max) * 100)}%` }} /> : null}
            </span>
          ))}
        </div>
      ) : <p className="admin-note">{t.adminNoData}</p>}
      <div className="admin-bars-axis"><span>{from}</span><span>{to}</span></div>
    </figure>
  );
}
