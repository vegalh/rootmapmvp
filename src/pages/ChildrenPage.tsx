import { Icon } from "../components/Icon";
import { TreeLogo } from "../components/TreeLogo";
import { Empty } from "../components/ui";
import { fmt } from "../lib/dates";
import type { Child, LessonRecord, Observation } from "../types";
import { childAge, lessonLabel, noteText, type Copy } from "../lib/i18n";

export function ChildrenPage({ childrenData, observations, goChild, openAddChild, openNotifications, t }: {
  childrenData: Child[];
  records: LessonRecord[];
  observations: Observation[];
  goChild: (id: string) => void;
  openAddChild: () => void;
  openNotifications: () => void;
  t: Copy;
}) {
  const latest = (id: string) => observations.filter(o => o.childId === id).sort((a, b) => b.date.localeCompare(a.date))[0];

  return (
    <>
      <header className="brand-header">
        <TreeLogo />
        <button className="bell-button" onClick={openNotifications}><Icon name="bell" /><i /></button>
      </header>
      <main className="page-content children-page">
        <div className="hero-title"><h1>{t.myChildren}</h1><p>{t.childSubtitle}</p></div>
        {childrenData.length ? (
          <div className="children-carousel">
            {childrenData.map(c => {
              const lastObs = latest(c.id);
              const interests = c.interests?.length ? c.interests.join("、") : t.notAddedYet;
              return (
                <button className="child-select-card" onClick={() => goChild(c.id)} key={c.id}>
                  <div className="child-select-photo"><img src={c.photo} alt="" /></div>
                  <div className="child-select-info">
                    <strong>{c.first}</strong>
                    <span className="child-select-age">{childAge(c, t)}</span>
                    <p><em>{t.interestedInLabel}</em> {interests}</p>
                    <p><em>{t.lastObservationLabel}</em> {lastObs ? fmt(lastObs.date) : t.noObservationsYet}</p>
                  </div>
                </button>
              );
            })}
            <button className="child-select-card add-child-card" onClick={openAddChild}>
              <span className="add-child-plus"><Icon name="plus" size={28} /></span>
              <strong>{t.addChild}</strong>
            </button>
          </div>
        ) : (
          <Empty text={t.noResults} />
        )}
        {!!childrenData.length && (
          <>
            <div className="section-title recent-title"><h2>{t.recentMomentsLabel}</h2></div>
            <div className="recent-activity">
              {observations.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map(o => {
                const c = childrenData.find(x => x.id === o.childId);
                if (!c) return null;
                return (
                  <button onClick={() => goChild(c.id)} key={o.id}>
                    <img src={c.photo} alt="" />
                    <span><strong>{c.first} {c.last}</strong><small>{o.lesson ? lessonLabel(o.lesson, t) : t.independentObservation} · {fmt(o.date)}</small><p>{noteText(o.notes, o.notesZh, t)}</p></span>
                    <Icon name="chevron" size={16} />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>
    </>
  );
}
