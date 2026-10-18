import { useState } from "react";
import { Icon } from "../components/Icon";
import type { Activity } from "../types";
import { categoryOptionLabel, localizeActivity, type Copy } from "../lib/i18n";

export function ActivityDetailPage({ activity: rawActivity, saved, toggleSaved, back, openPlan, openTried, notify, t }: {
  activity: Activity;
  saved: boolean;
  toggleSaved: () => void;
  back: () => void;
  openPlan: () => void;
  openTried: () => void;
  // Shows a short confirmation (the app's toast).
  notify: (message: string) => void;
  t: Copy;
}) {
  const a = localizeActivity(rawActivity, t);
  const [checked, setChecked] = useState<number[]>([]);
  // Shares the activity's own address (lib/routes.ts), which opens this page. Without the share sheet the link is
  // copied; if that isn't possible either, the parent is told rather than shown a false confirmation.
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title: a.title, text: a.title, url }); return; }
      await navigator.clipboard.writeText(url);
      notify(t.linkCopied);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") notify(t.shareFailed);
    }
  };
  return (
    <main className="detail-page">
      <div className="detail-actions">
        <button onClick={back} aria-label={t.back}><Icon name="back" /></button>
        <div>
          <button className={saved ? "saved" : ""} onClick={toggleSaved} aria-pressed={saved} aria-label={(saved ? t.unsaveActivityLabel : t.saveActivityLabel).replace("{title}", a.title)}><Icon name="heart" filled={saved} /></button>
          <button onClick={share} aria-label={t.shareLabel.replace("{title}", a.title)}><Icon name="share" /></button>
        </div>
      </div>
      <img className="detail-hero" src={a.image} alt="" />
      <div className="detail-content">
        <h1>{a.title}</h1>
        <p className="meta">{a.age}<b>·</b>{categoryOptionLabel(a.category, t)}<b>·</b>{a.minutes} {t.minutesWord}</p>
        <p className="description">{a.description}</p>
        <div className="domain-row">
          {a.domains.map((d, i) => (
            <span key={d}><i><Icon name={i === 0 ? "user" : i === 1 ? "compass" : i === 2 ? "heart" : "globe"} size={18} /></i>{d}</span>
          ))}
        </div>
        <h2>{t.materials}</h2>
        <div className="material-list">
          {a.materials.map((m, i) => (
            <button className={checked.includes(i) ? "checked" : ""} aria-pressed={checked.includes(i)} onClick={() => setChecked(checked.includes(i) ? checked.filter(x => x !== i) : [...checked, i])} key={m}>
              <i>{checked.includes(i) && <Icon name="check" size={13} />}</i>{m}
            </button>
          ))}
        </div>
        <h2>{t.how}</h2>
        <ol>{a.steps.map(s => <li key={s}>{s}</li>)}</ol>
        {a.safety && (
          <aside className="safety-note" aria-label={t.safetyTitle}>
            <Icon name="shield" size={20} />
            <div><strong>{t.safetyTitle}</strong><p>{a.safety}</p></div>
          </aside>
        )}
      </div>
      <div className="sticky-action two">
        <button className="secondary" onClick={openTried}><Icon name="check" size={19} />{t.markAsTried}</button>
        <button onClick={openPlan}><Icon name="calendar" size={19} />{t.addWeek}</button>
      </div>
    </main>
  );
}
