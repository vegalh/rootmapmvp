import { useState } from "react";
import { Icon } from "../components/Icon";
import type { Activity } from "../types";
import { discoverCategoryLabel, localizeActivity, type Copy } from "../lib/i18n";

export function ActivityDetailPage({ activity: rawActivity, saved, toggleSaved, back, openPlan, t }: {
  activity: Activity;
  saved: boolean;
  toggleSaved: () => void;
  back: () => void;
  openPlan: () => void;
  t: Copy;
}) {
  const a = localizeActivity(rawActivity, t);
  const [checked, setChecked] = useState<number[]>([]);
  const share = async () => {
    const data = { title: a.title, text: `${a.title} — ${a.description}` };
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard?.writeText(`${data.title}\n${data.text}`);
      window.alert(t.copiedToClipboard);
    }
  };
  return (
    <main className="detail-page">
      <div className="detail-actions">
        <button onClick={back}><Icon name="back" /></button>
        <div>
          <button className={saved ? "saved" : ""} onClick={toggleSaved}><Icon name="heart" filled={saved} /></button>
          <button onClick={share}><Icon name="share" /></button>
        </div>
      </div>
      <img className="detail-hero" src={a.image} alt="" />
      <div className="detail-content">
        <h1>{a.title}</h1>
        <p className="meta">{a.age}<b>·</b>{discoverCategoryLabel(a.area, t)}<b>·</b>{a.minutes} {t.minutesWord}</p>
        <p className="description">{a.description}</p>
        <div className="domain-row">
          {a.domains.map((d, i) => (
            <span key={d}><i><Icon name={i === 0 ? "user" : i === 1 ? "compass" : i === 2 ? "heart" : "globe"} size={18} /></i>{d}</span>
          ))}
        </div>
        <h2>{t.materials}</h2>
        <div className="material-list">
          {a.materials.map((m, i) => (
            <button className={checked.includes(i) ? "checked" : ""} onClick={() => setChecked(checked.includes(i) ? checked.filter(x => x !== i) : [...checked, i])} key={m}>
              <i>{checked.includes(i) && <Icon name="check" size={13} />}</i>{m}
            </button>
          ))}
        </div>
        <h2>{t.how}</h2>
        <ol>{a.steps.map(s => <li key={s}>{s}</li>)}</ol>
      </div>
      <div className="sticky-action"><button onClick={openPlan}><Icon name="calendar" size={19} />{t.addWeek}</button></div>
    </main>
  );
}
