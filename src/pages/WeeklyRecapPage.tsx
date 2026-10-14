import { Icon } from "../components/Icon";
import { ChildPhoto, PageHeader } from "../components/ui";
import { ChildFilter, EntryPhotos } from "../components/EntryTimeline";
import { fmtDayMonth, localIsoToday } from "../lib/dates";
import { entryText } from "../lib/entries";
import { photoUrl } from "../lib/photos";
import { addDays, firstRecapWeek, recapEntries, recapWeekForToday, weekEntries, weekHighlights, weekRange, weekStart } from "../lib/memories";
import type { Child, Entry, Lang } from "../types";
import type { Copy } from "../lib/i18n";

const canShowPhoto = (p: string) => !!photoUrl(p);

// One week of Moments to revisit (Monday to Sunday): a few highlights, then the rest of the week. Only what the
// parent saved, in their own words: no counts, scores, streaks or interpretations. Optional and never announced;
// reached from Today (and Moments). Earlier weeks are a tap away; one child at a time in a family with several.
export function WeeklyRecapPage({ entries, childrenData, week, setWeek, child, setChild, lang, open, back, t }: {
  entries: Entry[];
  childrenData: Child[];
  // The Monday of the week to show; "" lets the page choose (last week, or this week so far).
  week: string;
  setWeek: (week: string) => void;
  // "" for every child, or one child's id.
  child: string;
  setChild: (id: string) => void;
  lang: Lang;
  open: (id: string) => void;
  back: () => void;
  t: Copy;
}) {
  const today = localIsoToday();
  const thisWeek = weekStart(today);
  const ids = childrenData.map(c => c.id);
  const forChild = ids.includes(child) ? child : "";
  const mine = recapEntries(entries, ids, forChild || undefined);
  // An address may name any day, or a week that hasn't come yet: it shows that day's week, at most this week.
  const shown = /^\d{4}-\d{2}-\d{2}$/.test(week) ? (weekStart(week) > thisWeek ? thisWeek : weekStart(week)) : recapWeekForToday(mine, today) ?? thisWeek;
  const first = firstRecapWeek(mine);
  const list = weekEntries(mine, shown);
  const highlights = weekHighlights(list, canShowPhoto);
  const rest = list.filter(e => !highlights.includes(e));
  // The nearest earlier week that has Moments, for an empty week.
  const earlier = mine.filter(e => e.date < shown).reduce<string | undefined>((max, e) => (!max || e.date > max ? e.date : max), undefined);
  const childOf = (id: string) => childrenData.find(c => c.id === id);

  return (
    <main className="page-content recap-page">
      <PageHeader title={t.recapPageTitle} subtitle={t.recapSubtitle} back={back} />
      {childrenData.length > 1 && <ChildFilter value={forChild} onChange={setChild} childrenData={childrenData} allValue="" t={t} />}
      <nav className="recap-weeks" aria-label={t.recapPageTitle}>
        <button className="icon-button" onClick={() => setWeek(addDays(shown, -7))} disabled={!first || shown <= first} aria-label={t.recapPrevious}><Icon name="back" size={18} /></button>
        <h2>{weekRange(shown, lang)}</h2>
        <button className="icon-button recap-next" onClick={() => setWeek(addDays(shown, 7))} disabled={shown >= thisWeek} aria-label={t.recapNext}><Icon name="chevron" size={18} /></button>
      </nav>

      {!list.length && (
        <div className="recap-empty">
          <p>{t.recapEmpty}</p>
          {earlier && <button className="wide-secondary" onClick={() => setWeek(weekStart(earlier))}>{t.recapEarlier}</button>}
        </div>
      )}

      {highlights.map(e => {
        const c = childOf(e.childId);
        const text = entryText(e, lang);
        return (
          <button className="journal-card recap-highlight" onClick={() => open(e.id)} key={e.id}>
            {e.photos.length > 0 && <EntryPhotos photos={e.photos} />}
            <span className="entry-child">
              {c && <ChildPhoto child={c} />}
              <span>{c && <strong>{c.first} {c.last}</strong>}<time>{fmtDayMonth(e.date, lang)}</time></span>
            </span>
            {e.title && <strong>{e.title}</strong>}
            {text && <p>{text}</p>}
          </button>
        );
      })}

      {rest.length > 0 && (
        <section className="recap-rest" aria-labelledby="recap-rest">
          <h3 id="recap-rest">{t.recapAlso}</h3>
          {rest.map(e => {
            const c = childOf(e.childId);
            const photo = e.photos.find(canShowPhoto);
            return (
              <button className="recap-row" onClick={() => open(e.id)} key={e.id}>
                {photo ? <img src={photoUrl(photo)} alt="" loading="lazy" /> : c ? <ChildPhoto child={c} /> : <i />}
                <span>
                  <strong>{e.title || entryText(e, lang) || (c ? t.momentWith.replace("{name}", c.first) : "")}</strong>
                  <small>{c ? `${c.first} · ` : ""}{fmtDayMonth(e.date, lang)}</small>
                </span>
                <Icon name="chevron" size={15} />
              </button>
            );
          })}
        </section>
      )}
    </main>
  );
}

export default WeeklyRecapPage;
