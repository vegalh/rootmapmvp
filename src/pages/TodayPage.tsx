import { Icon } from "../components/Icon";
import { TreeLogo } from "../components/TreeLogo";
import { ageFromDob, fmtLong, localIsoToday } from "../lib/dates";
import { photoUrl } from "../lib/photos";
import { entryText } from "../lib/entries";
import { discoverCategoryLabel, localizeActivity, type Copy } from "../lib/i18n";
import { activities } from "../data/activities";
import { activityAgeRanges, ageRangeForYears, findActivity } from "../lib/catalog";
import { initialObservations } from "../data/progress";
import { thoughts } from "../data/thoughts";
import type { Activity, Child, Entry, Lang, LessonRecord } from "../types";

// Small stable string hash, so each local calendar day picks the same item all day long.
function dayHash(day: string, salt: string) {
  let h = 5381;
  for (const ch of `${salt}:${day}`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function pickForDay<T extends { id: string }>(items: T[], day: string, salt: string): T | undefined {
  if (!items.length) return undefined;
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[dayHash(day, salt) % sorted.length];
}

// The memory the app made from a bundled demo observation, never edited by the parent: not the parent's own.
const isDemoEntry = (e: Entry) => {
  const seed = initialObservations.find(o => `obs-${o.id}` === e.id);
  return !!seed && (e.text || "") === seed.notes && !e.title && !e.photos.length;
};

// Older memories first: today's entries only resurface when there is nothing earlier.
const preferOlder = <T extends { date: string }>(items: T[], today: string) => {
  const older = items.filter(x => x.date < today);
  return older.length ? older : items;
};

type Memory =
  | { kind: "photo"; entry: Entry; photo: string }
  | { kind: "text"; entry: Entry }
  | { kind: "tried"; record: LessonRecord; activity: Activity };

// Looking Back: a photo Moment, else a text Moment, else a tried activity; nothing when the parent has none yet.
function pickMemory(entries: Entry[], records: LessonRecord[], childrenData: Child[], today: string): Memory | undefined {
  const known = new Set(childrenData.map(c => c.id));
  const mine = entries.filter(e => known.has(e.childId) && !isDemoEntry(e));
  const firstPhoto = (e: Entry) => e.photos.find(p => photoUrl(p));
  const withPhoto = mine.filter(e => firstPhoto(e));
  if (withPhoto.length) {
    const entry = pickForDay(preferOlder(withPhoto, today), today, "memory")!;
    return { kind: "photo", entry, photo: firstPhoto(entry)! };
  }
  const withText = mine.filter(e => (e.title || e.text || "").trim());
  if (withText.length) return { kind: "text", entry: pickForDay(preferOlder(withText, today), today, "memory")! };
  // Only "Mark as Tried" records whose activity still exists, so the card always opens something.
  const tried = records.filter(r => r.kind === "tried" && known.has(r.childId) && !!findActivity(r.activityId));
  const record = pickForDay(preferOlder(tried, today), today, "memory");
  return record ? { kind: "tried", record, activity: findActivity(record.activityId)! } : undefined;
}

// "last month" / "上个月", "3 days ago" / "3天前".
function relativeDay(date: string, today: string, lang: Lang) {
  const days = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(lang === "zh" ? "zh-CN" : "en", { numeric: "auto" });
  if (days < 7) return rtf.format(-Math.max(0, days), "day");
  if (days < 30) return rtf.format(-Math.round(days / 7), "week");
  if (days < 365) return rtf.format(-Math.max(1, Math.round(days / 30)), "month");
  return rtf.format(-Math.round(days / 365), "year");
}

// The home screen: one featured activity, one resurfaced memory and one short reflection, all read-only.
export function TodayPage({ entries, records, childrenData, lang, openActivity, openEntry, openAddChild, t }: {
  entries: Entry[];
  records: LessonRecord[];
  childrenData: Child[];
  lang: Lang;
  openActivity: (id: string) => void;
  openEntry: (id: string) => void;
  // A new family's first step.
  openAddChild: () => void;
  t: Copy;
}) {
  const today = localIsoToday();
  // Today's activity suits one of the children's ages when there is one that does (any activity otherwise).
  const ranges = childrenData.filter(c => c.dob).map(c => ageRangeForYears(ageFromDob(c.dob).totalYears));
  const suited = activities.filter(a => activityAgeRanges(a).some(r => ranges.includes(r)));
  const pool = suited.length ? suited : activities;
  const featured = localizeActivity(pool[dayHash(today, "activity") % pool.length], t);
  const memory = pickMemory(entries, records, childrenData, today);
  const thought = thoughts[dayHash(today, "thought") % thoughts.length];
  const childOf = (id: string) => childrenData.find(c => c.id === id);
  const dateLine = new Date(`${today}T12:00:00`).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <header className="brand-header"><TreeLogo /></header>
      <main className="page-content today-page">
        <div className="hero-title"><p className="today-date">{dateLine}</p><h1>{t.todayTitle}</h1></div>

        {!childrenData.length && (
          <section className="today-welcome" aria-labelledby="today-welcome">
            <h2 id="today-welcome">{t.welcomeFamilyTitle}</h2>
            <p>{t.welcomeFamilyText}</p>
            <button className="wide-primary" onClick={openAddChild}><Icon name="plus" size={18} />{t.addFirstChild}</button>
          </section>
        )}

        <section className="today-section" aria-labelledby="today-inspiration">
          <h2 className="today-eyebrow" id="today-inspiration">{t.todayInspiration}</h2>
          <button className="today-feature" onClick={() => openActivity(featured.id)}>
            <span className="today-feature-image">
              <img src={featured.image} alt="" />
              <span className="today-feature-caption">
                <small>{discoverCategoryLabel(featured.area, t)}</small>
                <strong>{featured.title}</strong>
              </span>
            </span>
            <span className="today-feature-body">
              <span className="today-feature-meta"><span>{featured.age}</span><span><Icon name="clock" size={14} />{featured.minutes} {t.min}</span></span>
              <p>{featured.description}</p>
              <span className="today-link">{t.exploreActivity}<Icon name="chevron" size={16} /></span>
            </span>
          </button>
        </section>

        {memory && (
          <section className="today-section" aria-labelledby="today-looking-back">
            <h2 className="today-eyebrow" id="today-looking-back">{t.lookingBack}</h2>
            {memory.kind === "tried" ? (
              <TriedMemory memory={memory} child={childOf(memory.record.childId)} when={relativeDay(memory.record.date, today, lang)} open={() => openActivity(memory.activity.id)} t={t} />
            ) : (
              <MomentMemory memory={memory} child={childOf(memory.entry.childId)} lang={lang} open={() => openEntry(memory.entry.id)} t={t} />
            )}
          </section>
        )}

        <section className="today-section today-thought" aria-labelledby="today-thought">
          <h2 className="today-eyebrow" id="today-thought">{t.thoughtForParents}</h2>
          <blockquote>{lang === "zh" ? thought.zh : thought.en}</blockquote>
        </section>
      </main>
    </>
  );
}

export default TodayPage;

function MomentMemory({ memory, child, lang, open, t }: { memory: Extract<Memory, { kind: "photo" | "text" }>; child?: Child; lang: Lang; open: () => void; t: Copy }) {
  const { entry } = memory;
  const title = entry.title || (child ? t.momentWith.replace("{name}", child.first) : "");
  const text = entryText(entry, lang);
  return (
    <button className={`today-memory ${memory.kind}`} onClick={open}>
      {memory.kind === "photo" ? (
        <span className={`today-memory-photo ${entry.photos.length > 1 ? "stack" : ""}`}><img src={photoUrl(memory.photo)} alt="" /></span>
      ) : (
        text && <span className="today-memory-quote">{text}</span>
      )}
      <span className="today-memory-caption">
        {title && <strong>{title}</strong>}
        <time>{child ? `${child.first} · ` : ""}{fmtLong(entry.date, lang)}</time>
      </span>
      <span className="today-link">{t.revisitMoment}<Icon name="chevron" size={16} /></span>
    </button>
  );
}

function TriedMemory({ memory, child, when, open, t }: { memory: Extract<Memory, { kind: "tried" }>; child?: Child; when: string; open: () => void; t: Copy }) {
  const a = localizeActivity(memory.activity, t);
  return (
    <button className="today-memory tried" onClick={open}>
      <img src={a.image} alt="" />
      <span>
        <small>{t.rememberActivity}</small>
        <strong>{a.title}</strong>
        <em>{child ? t.triedBy.replace("{name}", child.first).replace("{when}", when) : t.triedWhen.replace("{when}", when)}</em>
        <span className="today-link">{t.details}<Icon name="chevron" size={16} /></span>
      </span>
    </button>
  );
}
