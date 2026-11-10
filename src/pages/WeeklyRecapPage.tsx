import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { ChildPhoto, PageHeader, useConfirm } from "../components/ui";
import { ChildFilter, EntryChildren, EntryPhotos } from "../components/EntryTimeline";
import { fmtDayMonth, localIsoToday } from "../lib/dates";
import { entryText, mergeShared } from "../lib/entries";
import { photoUrl } from "../lib/photos";
import { addDays, firstRecapWeek, recapEntries, recapWeekForToday, weekEntries, weekHighlights, weekRange, weekStart } from "../lib/memories";
import { drawWeekImage, shareMoments, shareNames } from "../lib/shareWeek";
import { platform } from "../lib/platform";
import { useSetting } from "../lib/data/hooks";
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
  // For every child, a moment saved for several children is shown once, naming them all.
  const weekList = forChild ? { entries: weekEntries(mine, shown), childrenOf: undefined } : mergeShared(weekEntries(mine, shown));
  const list = weekList.entries;
  const highlights = weekHighlights(list, canShowPhoto);
  const rest = list.filter(e => !highlights.includes(e));
  // The nearest earlier week that has Moments, for an empty week.
  const earlier = mine.filter(e => e.date < shown).reduce<string | undefined>((max, e) => (!max || e.date > max ? e.date : max), undefined);
  const childOf = (id: string) => childrenData.find(c => c.id === id);
  const childrenOf = (e: Entry) => weekList.childrenOf?.get(e.id) ?? [e.childId];

  // Share: one picture of the week (lib/shareWeek.ts), made ahead so the share sheet opens straight from the tap.
  // The first time, a note says the picture leaves RootMap once shared.
  const confirm = useConfirm();
  const [noteSeen, setNoteSeen] = useSetting<boolean>("rootmap-share-note-seen", false);
  const [picture, setPicture] = useState<{ key: string; blob: Blob }>();
  const pictureKey = `${shown}|${forChild}|${lang}|${list.map(e => `${e.id}:${e.updatedAt}`).join()}`;
  const makePicture = () => drawWeekImage({
    title: t.shareImageTitle,
    range: weekRange(shown, lang),
    names: shareNames([...new Set(list.flatMap(childrenOf))], childrenData, t.nameJoin),
    moments: shareMoments(list, lang, canShowPhoto),
    photoUrl,
  });
  useEffect(() => {
    if (!list.length) return;
    let current = true;
    makePicture().then(blob => { if (current) setPicture({ key: pictureKey, blob }); }, () => { /* made again on tap */ });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pictureKey]);
  const share = async () => {
    try {
      const blob = picture?.key === pictureKey ? picture.blob : await makePicture();
      await platform.shareImage(`rootmap-week-${shown}.png`, blob, t.shareImageTitle);
    } catch {
      // The picture couldn't be made or handed over; nothing left RootMap.
    }
  };
  const askShare = () => {
    if (noteSeen) { void share(); return; }
    confirm({ title: t.shareNoteTitle, body: <p>{t.shareNote}</p>, confirmLabel: t.share, onConfirm: () => { setNoteSeen(true); return share(); } });
  };

  return (
    <main className="page-content recap-page">
      <PageHeader title={t.recapPageTitle} subtitle={t.recapSubtitle} back={back} action={list.length ? <button className="recap-share" onClick={askShare}><Icon name="share" size={17} />{t.share}</button> : undefined} />
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
        const time = <time>{fmtDayMonth(e.date, lang)}</time>;
        return (
          <button className="journal-card recap-highlight" onClick={() => open(e.id)} key={e.id}>
            {e.photos.length > 0 && <EntryPhotos photos={e.photos} />}
            {c ? <EntryChildren ids={childrenOf(e)} childrenData={childrenData} time={time} t={t} /> : <span className="entry-child"><span>{time}</span></span>}
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
            const names = childrenData.filter(x => childrenOf(e).includes(x.id)).map(x => x.first).join(t.nameJoin);
            const photo = e.photos.find(canShowPhoto);
            return (
              <button className="recap-row" onClick={() => open(e.id)} key={e.id}>
                {photo ? <img src={photoUrl(photo)} alt="" loading="lazy" /> : c ? <ChildPhoto child={c} /> : <i />}
                <span>
                  <strong>{e.title || entryText(e, lang) || (c ? t.momentWith.replace("{name}", c.first) : "")}</strong>
                  <small>{names ? `${names} · ` : ""}{fmtDayMonth(e.date, lang)}</small>
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
