import { useState } from "react";
import { Icon } from "../components/Icon";
import { TreeLogo } from "../components/TreeLogo";
import { ChildPhoto } from "../components/ui";
import { ageFromDob, fmtLong, localIsoToday } from "../lib/dates";
import { photoUrl } from "../lib/photos";
import { entryText, mergeShared } from "../lib/entries";
import { childShortName } from "../lib/children";
import { trackClick, useImpression } from "../lib/analytics/tracker";
import { categoryOptionLabel, childAge, localizeActivity, routineLabel, type Copy } from "../lib/i18n";
import { durationLabel, findActivity } from "../lib/catalog";
import { ROUTINES, againIdea, doneOrPlannedToday, showAnother, shownIdea, todaysIdeas, type IdeaChoice, type Routine } from "../lib/todayIdeas";
import { dayHash, pickForDay, pickMemory, recapEntries, recapWeekForToday, weekEntries, weekHighlights, weekRange, weekStart, type Memory } from "../lib/memories";
import { todaysPlans } from "../lib/plans";
import { thoughts } from "../data/thoughts";
import type { Child, Entry, Lang, LessonRecord, Plan } from "../types";

// "last month" / "上个月", "3 weeks ago" / "3周前". Looking Back only shows memories at least a week old.
function relativeDay(date: string, today: string, lang: Lang) {
  const days = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(lang === "zh" ? "zh-CN" : "en", { numeric: "auto" });
  if (days < 30) return rtf.format(-Math.max(1, Math.round(days / 7)), "week");
  if (days < 365) return rtf.format(-Math.max(1, Math.round(days / 30)), "month");
  return rtf.format(-Math.round(days / 365), "year");
}

const canShowPhoto = (p: string) => !!photoUrl(p);

// The home screen: today's plan (My Week's plans for today, still to do), an activity idea for one of the children, a
// memory from at least a week ago, the week's Moments to revisit, and a short reflection. Only the plans can be acted
// on (Mark as Tried); everything else is read-only.
export function TodayPage({ entries, records, childrenData, plans, completePlan, routines, answeredRoutine, setRoutines, ideaChoice, setIdeaChoice, planToday, plannable, lang, openActivity, openEntry, openRecord, openRecap, openDiscover, openAddChild, showSignIn, openSignIn, t }: {
  entries: Entry[];
  records: LessonRecord[];
  childrenData: Child[];
  plans: Plan[];
  // My Week's completion: the plan is marked done and each of its children gets the activity in their history.
  completePlan: (plan: Plan) => void;
  // "Our routine" (lib/todayIdeas.ts): when the family is usually together. Asked once, until answered or dismissed.
  routines: Routine[];
  answeredRoutine: boolean;
  setRoutines: (routines: Routine[]) => void;
  // "Show me another": which of the day's ideas each child is on (lib/todayIdeas.ts).
  ideaChoice: IdeaChoice;
  setIdeaChoice: (choice: IdeaChoice) => void;
  // "Do this today": the activity in today's plan for the child, at once. Only for `plannable` children (My Week
  // belongs to the parent's own family).
  planToday: (activityId: string, childId: string) => void;
  plannable: string[];
  lang: Lang;
  openActivity: (id: string) => void;
  openEntry: (id: string) => void;
  // A tried activity in Looking Back opens that record in its child's Activities.
  openRecord: (childId: string, recordId: string) => void;
  openRecap: (week: string) => void;
  openDiscover: () => void;
  // A new family's first step.
  openAddChild: () => void;
  // A reminder to sign in, shown only on builds with cloud sign-in while the parent is browsing as a guest.
  showSignIn?: boolean;
  openSignIn?: () => void;
  t: Copy;
}) {
  const today = localIsoToday();
  // Ideas are for one child at a time, so siblings of different ages each get their own (the day's child rotates; the
  // parent can switch). An activity outside a child's age range is never hidden: Discover lists everything.
  const withAge = childrenData.filter(c => c.dob);
  const [chosen, setChosen] = useState<string>();
  const forChild = withAge.find(c => c.id === chosen) ?? pickForDay(withAge, today, "for-child");
  const years = forChild ? ageFromDob(forChild.dob).totalYears : undefined;
  // Activities for the child's age (lib/todayIdeas.ts), never one they tried or have planned today while there's another.
  const { ideas, suited, routine } = todaysIdeas({ childId: forChild?.id, years, routines, records, plans, today });
  const shown = shownIdea(ideaChoice, forChild?.id, today, ideas.length);
  const featured = localizeActivity(ideas[shown], t);
  // "Again?": one thing the child loved a few days ago, not today's idea or already in their day.
  const again = forChild ? againIdea(records, forChild.id, today, new Set([featured.id, ...doneOrPlannedToday(records, plans, forChild.id, today)])) : undefined;

  const childIds = childrenData.map(c => c.id);
  const memory = pickMemory(entries, records, childIds, today, canShowPhoto, id => !!findActivity(id));
  const recapWeek = recapWeekForToday(recapEntries(entries, childIds), today);
  const thought = thoughts[dayHash(today, "thought") % thoughts.length];
  const childOf = (id: string) => childrenData.find(c => c.id === id);
  // Once the parent picks a child above Today's Inspiration, only that child's plans.
  const planned = todaysPlans(plans, today, chosen && withAge.some(c => c.id === chosen) ? chosen : undefined);
  useImpression("today.lookingBack", !!memory);
  const dateLine = new Date(`${today}T12:00:00`).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <header className="brand-header">
        <TreeLogo />
        {showSignIn && openSignIn && (
          <button className="header-signin" onClick={openSignIn}><Icon name="user" size={15} />{t.headerSignIn}</button>
        )}
      </header>
      <main className="page-content today-page">
        <div className="hero-title"><p className="today-date">{dateLine}</p><h1>{t.todayTitle}</h1></div>

        {!childrenData.length && (
          <section className="today-welcome" aria-labelledby="today-welcome">
            <h2 id="today-welcome">{t.welcomeFamilyTitle}</h2>
            <p>{t.welcomeFamilyText}</p>
            <button className="wide-primary" onClick={openAddChild}><Icon name="plus" size={18} />{t.addFirstChild}</button>
          </section>
        )}

        {planned.length > 0 && (
          <section className="today-section" aria-labelledby="today-plan">
            <h2 className="today-eyebrow" id="today-plan">{t.todaysPlan}</h2>
            <div className="today-plans">
              {planned.map(p => <PlanCard plan={p} childrenData={childrenData} open={() => openActivity(p.activityId)} markTried={() => completePlan(p)} t={t} key={p.id} />)}
            </div>
          </section>
        )}

        {childrenData.length > 0 && !answeredRoutine && <RoutineQuestion save={setRoutines} t={t} />}

        <section className="today-section" aria-labelledby="today-inspiration">
          <h2 className="today-eyebrow" id="today-inspiration">{routine ? routineHeading(routine, t) : t.todayInspiration}</h2>
          {withAge.length > 1 && (
            <div className="today-for" role="group" aria-label={t.todayIdeasFor}>
              {withAge.map(c => (
                <button key={c.id} className={c.id === forChild?.id ? "active" : ""} aria-pressed={c.id === forChild?.id} onClick={() => setChosen(c.id)}>
                  <ChildPhoto child={c} />{childShortName(c, childrenData)}
                </button>
              ))}
            </div>
          )}
          <article className="today-feature">
          <button className="today-feature-open" onClick={() => { trackClick("today.inspiration"); openActivity(featured.id); }}>
            <span className="today-feature-image">
              <img src={featured.image} alt="" />
              <span className="today-feature-caption">
                <small>{categoryOptionLabel(featured.category, t)}</small>
                <strong>{featured.title}</strong>
              </span>
            </span>
            <span className="today-feature-body">
              {forChild && suited && (
                <span className="today-feature-child">{t.todayForChild.replace("{name}", forChild.first).replace("{age}", childAge(forChild, t))}</span>
              )}
              <span className="today-feature-meta"><span>{featured.age}</span><span><Icon name="clock" size={14} />{durationLabel(featured, lang)}</span></span>
              {featured.description && <p>{featured.description}</p>}
              <span className="today-link">{t.exploreActivity}<Icon name="chevron" size={16} /></span>
            </span>
          </button>
          {forChild && plannable.includes(forChild.id) && (
            <div className="today-feature-actions">
              <button className="today-do" onClick={() => planToday(featured.id, forChild.id)}><Icon name="calendar" size={17} />{t.doThisToday}</button>
            </div>
          )}
          </article>
          {forChild && again && (
            <AgainCard activityId={again.record.activityId!} name={forChild.first} days={again.days} open={() => openActivity(again.record.activityId!)} doToday={plannable.includes(forChild.id) ? () => planToday(again.record.activityId!, forChild.id) : undefined} t={t} />
          )}
          {/* A few ideas a day, one at a time; then Discover. Without children, Discover as before. */}
          {!forChild ? (
            <button className="today-more" onClick={openDiscover}>{t.todayMoreIdeas}<Icon name="chevron" size={15} /></button>
          ) : shown < ideas.length - 1 ? (
            <button className="today-more today-another" onClick={() => setIdeaChoice(showAnother(ideaChoice, forChild.id, today, ideas.length))}>{t.showAnother}<Icon name="chevron" size={15} /></button>
          ) : (
            <button className="today-more" onClick={openDiscover}>{t.ideasInDiscover}<Icon name="chevron" size={15} /></button>
          )}
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
          <WeekCard week={recapWeek} entries={mergeShared(weekEntries(recapEntries(entries, childIds), recapWeek)).entries} thisWeek={recapWeek === weekStart(today)} lang={lang} open={() => openRecap(recapWeek)} t={t} />
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

const routineHeading = (r: Routine, t: Copy) =>
  r === "cooking" ? t.ideaCooking : r === "after-dinner" ? t.ideaAfterDinner : r === "bedtime" ? t.ideaBedtime : t.ideaWeekendMorning;

// "Again? Ada loved Scrubbing Potatoes last week.": something the child loved 3 to 14 days ago and hasn't done since.
function AgainCard({ activityId, name, days, open, doToday, t }: { activityId: string; name: string; days: number; open: () => void; doToday?: () => void; t: Copy }) {
  const a = localizeActivity(findActivity(activityId)!, t);
  const when = days < 7 ? t.againFewDays : days < 14 ? t.againLastWeek : t.againTwoWeeks;
  return (
    <article className="today-again">
      <button className="today-again-open" onClick={open}>
        <img src={a.image} alt="" />
        <span>
          <small>{t.againTitle}</small>
          <strong>{t.againLine.replace("{name}", name).replace("{title}", a.title).replace("{when}", when)}</strong>
        </span>
      </button>
      {doToday && <button className="today-again-do" onClick={doToday}><Icon name="calendar" size={15} />{t.doThisToday}</button>}
    </article>
  );
}

// "When are you usually together?": asked once, on a small card. Save keeps the moments chosen (none is fine);
// "Not now" puts the question away for good. Either can be changed in Profile › Our routine.
function RoutineQuestion({ save, t }: { save: (routines: Routine[]) => void; t: Copy }) {
  const [chosen, setChosen] = useState<Routine[]>([]);
  const toggle = (r: Routine) => setChosen(c => (c.includes(r) ? c.filter(x => x !== r) : [...c, r]));
  return (
    <section className="today-routine" aria-labelledby="today-routine">
      <h2 id="today-routine">{t.routineQuestion}</h2>
      <p>{t.routineHint}</p>
      <div className="routine-options">
        {ROUTINES.map(r => (
          <button key={r} data-routine={r} aria-pressed={chosen.includes(r)} className={chosen.includes(r) ? "active" : ""} onClick={() => toggle(r)}>
            {chosen.includes(r) && <Icon name="check" size={15} />}{routineLabel(r, t)}
          </button>
        ))}
      </div>
      <div className="routine-actions">
        <button onClick={() => save([])}>{t.notNow}</button>
        <button className="primary" onClick={() => save(chosen)} disabled={!chosen.length}>{t.save}</button>
      </div>
    </section>
  );
}

// One of today's plans: the activity, who it's for and the planning note. Tapping opens the activity; Mark as Tried
// completes the plan as My Week does.
function PlanCard({ plan, childrenData, open, markTried, t }: { plan: Plan; childrenData: Child[]; open: () => void; markTried: () => void; t: Copy }) {
  const a = localizeActivity(findActivity(plan.activityId)!, t);
  // Children still in My Children (a removed child's name is not shown).
  const names = plan.childIds.map(id => childrenData.find(c => c.id === id)).filter((c): c is Child => !!c).map(c => childShortName(c, childrenData)).join(t.nameJoin);
  const note = plan.note?.trim();
  return (
    <article className="today-plan">
      <button className="today-plan-open" onClick={open}>
        <img src={a.image} alt="" />
        <span>
          <strong>{a.title}</strong>
          {names && <small>{names}</small>}
          {note && <span className="plan-note">{note}</span>}
        </span>
      </button>
      <button className="today-plan-tried" onClick={markTried}><Icon name="check" size={15} />{t.markAsTried}</button>
    </article>
  );
}

// The week's Moments, offered to revisit: a few of its photos (or its first words) and the week's dates. A moment
// shared by siblings comes in once (mergeShared), and a photo is never shown twice.
function WeekCard({ week, entries, thisWeek, lang, open, t }: { week: string; entries: Entry[]; thisWeek: boolean; lang: Lang; open: () => void; t: Copy }) {
  const shown = weekHighlights(entries, canShowPhoto);
  const photos = [...new Set(shown.flatMap(e => e.photos.filter(canShowPhoto).slice(0, 1)))];
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
