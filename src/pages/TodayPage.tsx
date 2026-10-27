import { useState } from "react";
import { Icon } from "../components/Icon";
import { TreeLogo } from "../components/TreeLogo";
import { ChildPhoto } from "../components/ui";
import { ageFromDob, fmtLong, localIsoToday } from "../lib/dates";
import { photoUrl } from "../lib/photos";
import { entryText } from "../lib/entries";
import { childShortName } from "../lib/children";
import { trackClick, useImpression } from "../lib/analytics/tracker";
import { categoryOptionLabel, childAge, localizeActivity, type Copy } from "../lib/i18n";
import { activities } from "../data/activities";
import { activityAgeRanges, ageRangeForYears, findActivity } from "../lib/catalog";
import { dayHash, pickForDay, pickMemory, recapEntries, recapWeekForToday, weekEntries, weekHighlights, weekRange, weekStart, type Memory } from "../lib/memories";
import { thoughts } from "../data/thoughts";
import type { Child, Entry, Lang, LessonRecord } from "../types";

// "last month" / "上个月", "3 weeks ago" / "3周前". Looking Back only shows memories at least a week old.
function relativeDay(date: string, today: string, lang: Lang) {
  const days = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(lang === "zh" ? "zh-CN" : "en", { numeric: "auto" });
  if (days < 30) return rtf.format(-Math.max(1, Math.round(days / 7)), "week");
  if (days < 365) return rtf.format(-Math.max(1, Math.round(days / 30)), "month");
  return rtf.format(-Math.round(days / 365), "year");
}

const canShowPhoto = (p: string) => !!photoUrl(p);

// The home screen: an activity idea for one of the children, a memory from at least a week ago, the week's
// Moments to revisit, and a short reflection. All read-only.
export function TodayPage({ entries, records, childrenData, lang, openActivity, openEntry, openRecord, openRecap, openDiscover, openAddChild, t }: {
  entries: Entry[];
  records: LessonRecord[];
  childrenData: Child[];
  lang: Lang;
  openActivity: (id: string) => void;
  openEntry: (id: string) => void;
  // A tried activity in Looking Back opens that record in its child's Activities.
  openRecord: (childId: string, recordId: string) => void;
  openRecap: (week: string) => void;
  openDiscover: () => void;
  // A new family's first step.
  openAddChild: () => void;
  t: Copy;
}) {
  const today = localIsoToday();
  // Ideas are for one child at a time, so siblings of different ages each get their own (the day's child rotates; the
  // parent can switch). An activity outside a child's age range is never hidden: Discover lists everything.
  const withAge = childrenData.filter(c => c.dob);
  const [chosen, setChosen] = useState<string>();
  const forChild = withAge.find(c => c.id === chosen) ?? pickForDay(withAge, today, "for-child");
  const range = forChild && ageRangeForYears(ageFromDob(forChild.dob).totalYears);
  const suited = range ? activities.filter(a => activityAgeRanges(a).includes(range)) : [];
  const pool = suited.length ? suited : activities;
  const featured = localizeActivity(pool[dayHash(today, `activity:${forChild?.id ?? ""}`) % pool.length], t);

  const childIds = childrenData.map(c => c.id);
  const memory = pickMemory(entries, records, childIds, today, canShowPhoto, id => !!findActivity(id));
  const recapWeek = recapWeekForToday(recapEntries(entries, childIds), today);
  const thought = thoughts[dayHash(today, "thought") % thoughts.length];
  const childOf = (id: string) => childrenData.find(c => c.id === id);
  useImpression("today.lookingBack", !!memory);
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
          {withAge.length > 1 && (
            <div className="today-for" role="group" aria-label={t.todayIdeasFor}>
              {withAge.map(c => (
                <button key={c.id} className={c.id === forChild?.id ? "active" : ""} aria-pressed={c.id === forChild?.id} onClick={() => setChosen(c.id)}>
                  <ChildPhoto child={c} />{childShortName(c, childrenData)}
                </button>
              ))}
            </div>
          )}
          <button className="today-feature" onClick={() => { trackClick("today.inspiration"); openActivity(featured.id); }}>
            <span className="today-feature-image">
              <img src={featured.image} alt="" />
              <span className="today-feature-caption">
                <small>{categoryOptionLabel(featured.category, t)}</small>
                <strong>{featured.title}</strong>
              </span>
            </span>
            <span className="today-feature-body">
              {forChild && suited.length > 0 && (
                <span className="today-feature-child">{t.todayForChild.replace("{name}", forChild.first).replace("{age}", childAge(forChild, t))}</span>
              )}
              <span className="today-feature-meta"><span>{featured.age}</span><span><Icon name="clock" size={14} />{featured.minutes} {t.min}</span></span>
              <p>{featured.description}</p>
              <span className="today-link">{t.exploreActivity}<Icon name="chevron" size={16} /></span>
            </span>
          </button>
          <button className="today-more" onClick={openDiscover}>{t.todayMoreIdeas}<Icon name="chevron" size={15} /></button>
        </section>

        {memory && (
          <section className="today-section" aria-labelledby="today-looking-back">
            <h2 className="today-eyebrow" id="today-looking-back">{t.lookingBack}</h2>
            {memory.kind === "tried" ? (
              <TriedMemory memory={memory} child={childOf(memory.record.childId)} when={relativeDay(memory.record.date, today, lang)} open={() => { trackClick("today.lookingBack"); openRecord(memory.record.childId, memory.record.id); }} t={t} />
            ) : (
              <MomentMemory memory={memory} child={childOf(memory.entry.childId)} lang={lang} open={() => { trackClick("today.lookingBack"); openEntry(memory.entry.id); }} t={t} />
            )}
          </section>
        )}

        {recapWeek && (
          <WeekCard week={recapWeek} entries={weekEntries(recapEntries(entries, childIds), recapWeek)} thisWeek={recapWeek === weekStart(today)} lang={lang} open={() => openRecap(recapWeek)} t={t} />
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

// The week's Moments, offered to revisit: a few of its photos (or its first words) and the week's dates.
function WeekCard({ week, entries, thisWeek, lang, open, t }: { week: string; entries: Entry[]; thisWeek: boolean; lang: Lang; open: () => void; t: Copy }) {
  const shown = weekHighlights(entries, canShowPhoto);
  const photos = shown.flatMap(e => e.photos.filter(canShowPhoto).slice(0, 1));
  const words = shown.map(e => e.title || entryText(e, lang)).find(Boolean);
  return (
    <section className="today-section" aria-labelledby="today-week">
      <h2 className="today-eyebrow" id="today-week">{thisWeek ? t.recapThisWeek : t.recapLastWeek}</h2>
      <button className="today-week" onClick={open}>
        {photos.length > 0 ? (
          <span className={`today-week-photos n${photos.length}`}>{photos.map(p => <img src={photoUrl(p)} alt="" key={p} />)}</span>
        ) : (
          words && <span className="today-memory-quote">{words}</span>
        )}
        <span className="today-week-caption">
          <strong>{t.recapTitle}</strong>
          <time>{weekRange(week, lang)}</time>
        </span>
        <span className="today-link">{t.recapOpen}<Icon name="chevron" size={16} /></span>
      </button>
    </section>
  );
}

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
  const a = localizeActivity(findActivity(memory.record.activityId)!, t);
  return (
    <button className="today-memory tried" onClick={open}>
      <img src={a.image} alt="" />
      <span>
        <small>{t.rememberActivity}</small>
        <strong>{a.title}</strong>
        <em>{child ? t.triedBy.replace("{name}", child.first).replace("{when}", when) : t.triedWhen.replace("{when}", when)}</em>
        <span className="today-link">{t.viewRecord}<Icon name="chevron" size={16} /></span>
      </span>
    </button>
  );
}
