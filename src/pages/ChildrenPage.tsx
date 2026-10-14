import { Icon } from "../components/Icon";
import { TreeLogo } from "../components/TreeLogo";
import { fmt } from "../lib/dates";
import { entryText, newestFirst } from "../lib/entries";
import type { Child, Entry } from "../types";
import { childAge, type Copy } from "../lib/i18n";
import { childOptionLabel, childPhotoSrc, childShortName } from "../lib/children";

export function ChildrenPage({ childrenData, entries, goChild, openEntry, openAddChild, openMoments, t }: {
  childrenData: Child[];
  // The shared Moments collection.
  entries: Entry[];
  goChild: (id: string) => void;
  // Opens one Moment (Recent moments).
  openEntry: (id: string) => void;
  openAddChild: () => void;
  // The full Moments timeline (no longer a tab).
  openMoments: () => void;
  t: Copy;
}) {
  const lang = t.code === "zh" ? "zh" : "en";
  const recent = entries.filter(e => childrenData.some(c => c.id === e.childId)).sort(newestFirst);
  const latest = (id: string) => recent.find(e => e.childId === id);

  return (
    <>
      <header className="brand-header">
        <TreeLogo />
        {/* The page's only Add Child button: always here, with or without children. */}
        <button className="header-add-child" onClick={openAddChild}><Icon name="plus" size={18} />{t.addChild}</button>
      </header>
      <main className="page-content children-page">
        <div className="hero-title"><h1>{t.myChildren}</h1><p>{t.childSubtitle}</p></div>
        {childrenData.length ? (
          <div className="children-carousel">
            {childrenData.map(c => {
              const lastObs = latest(c.id);
              const interests = c.interests?.length ? c.interests.join("、") : t.notAddedYet;
              return (
                <button className="child-select-card" onClick={() => goChild(c.id)} key={c.id} aria-label={childOptionLabel(c, childrenData, t)}>
                  <div className="child-select-photo"><img src={childPhotoSrc(c)} alt="" /></div>
                  <div className="child-select-info">
                    <strong>{childShortName(c, childrenData)}</strong>
                    <span className="child-select-age">{childAge(c, t)}</span>
                    <p><em>{t.interestedInLabel}</em> {interests}</p>
                    <p><em>{t.lastObservationLabel}</em> {lastObs ? fmt(lastObs.date, lang) : t.noObservationsYet}</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          // No children yet (a new device, or a new account's space): the header's Add Child is the one way to add.
          <p className="children-empty">{t.noChildrenYet}</p>
        )}
        {!!childrenData.length && (
          <>
            <div className="section-title recent-title"><h2>{t.recentMomentsLabel}</h2><button className="text-action" onClick={openMoments}>{t.allMoments}</button></div>
            <div className="recent-activity">
              {recent.slice(0, 3).map(o => {
                const c = childrenData.find(x => x.id === o.childId);
                if (!c) return null;
                return (
                  <button onClick={() => openEntry(o.id)} key={o.id}>
                    <img src={childPhotoSrc(c)} alt="" />
                    <span><strong>{childOptionLabel(c, childrenData, t)}</strong><small>{o.title || t.independentObservation} · {fmt(o.date, lang)}</small><p>{entryText(o, lang)}</p></span>
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
