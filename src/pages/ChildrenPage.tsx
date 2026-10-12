import { Icon } from "../components/Icon";
import { TreeLogo } from "../components/TreeLogo";
import { fmt } from "../lib/dates";
import { photoUrl } from "../lib/photos";
import { entryText, newestFirst } from "../lib/entries";
import type { Child, Entry } from "../types";
import { childAge, type Copy } from "../lib/i18n";

export function ChildrenPage({ childrenData, entries, goChild, openAddChild, openNotifications, t }: {
  childrenData: Child[];
  // The shared Moments collection.
  entries: Entry[];
  goChild: (id: string) => void;
  openAddChild: () => void;
  openNotifications: () => void;
  t: Copy;
}) {
  const recent = entries.filter(e => childrenData.some(c => c.id === e.childId)).sort(newestFirst);
  const latest = (id: string) => recent.find(e => e.childId === id);

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
                  <div className="child-select-photo"><img src={photoUrl(c.photo)} alt="" /></div>
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
          // No children yet (a new device, or a new account's space): the same add card, as a first step.
          <div className="children-carousel">
            <button className="child-select-card add-child-card" onClick={openAddChild}>
              <span className="add-child-plus"><Icon name="plus" size={28} /></span>
              <strong>{t.addFirstChild}</strong>
            </button>
          </div>
        )}
        {!!childrenData.length && (
          <>
            <div className="section-title recent-title"><h2>{t.recentMomentsLabel}</h2></div>
            <div className="recent-activity">
              {recent.slice(0, 3).map(o => {
                const c = childrenData.find(x => x.id === o.childId);
                if (!c) return null;
                return (
                  <button onClick={() => goChild(c.id)} key={o.id}>
                    <img src={photoUrl(c.photo)} alt="" />
                    <span><strong>{c.first} {c.last}</strong><small>{o.title || t.independentObservation} · {fmt(o.date)}</small><p>{entryText(o, t.code === "zh" ? "zh" : "en")}</p></span>
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
