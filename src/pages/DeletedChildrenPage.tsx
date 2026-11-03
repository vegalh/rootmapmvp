import { Empty, PageHeader, useConfirm, useLatest, ChildPhoto } from "../components/ui";
import { fmtLong } from "../lib/dates";
import type { Child, DeletedChild, Entry, Lang, LessonRecord } from "../types";
import type { Copy } from "../lib/i18n";
import { recordView } from "../lib/activityRecords";

// A Moment or activity record removed from the profile of a child others help with (release readiness).
export type DeletedShared = { kind: "entry"; item: Entry; child: Child } | { kind: "record"; item: LessonRecord; child: Child };

// Profiles removed from My Children, newest first. Nothing here is ever deleted for good; restoring puts the
// profile back with its original id, so its journal entries and activity records reappear with it.
//
// Below them, for the person managing a shared child's profile: Moments and activity records removed from it, by
// anyone with Add & Edit (release readiness). Restoring clears the soft delete on the same record (same id, author,
// photos), which syncs to everyone in the circle. Records of children nobody else helps with are not listed: their
// deletion and recovery are unchanged.
export function DeletedChildrenPage({ deleted, childrenData, entries, records, shared = [], restoreShared, restore, back, lang, t }: {
  deleted: DeletedChild[];
  childrenData: Child[];
  entries: Entry[];
  records: LessonRecord[];
  shared?: DeletedShared[];
  restoreShared?: (d: DeletedShared) => Promise<void>;
  restore: (child: DeletedChild) => Promise<void>;
  back: () => void;
  lang: Lang;
  t: Copy;
}) {
  const confirm = useConfirm();
  const latestRestore = useLatest(restore);
  const latestRestoreShared = useLatest(restoreShared);
  const shown = [...deleted].sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
  const sharedShown = [...shared].sort((a, b) => (b.item.deletedAt || "").localeCompare(a.item.deletedAt || ""));
  const label = (d: DeletedShared) => (d.kind === "entry" ? d.item.title?.trim() || d.item.text?.trim() || "" : d.kind === "record" ? recordView(d.item, t).title : "");
  return (
    <main className="simple-page">
      <PageHeader title={t.recentlyDeleted} back={back} />
      <p className="deleted-intro">{t.recentlyDeletedIntro}</p>
      {!shown.length ? <Empty text={t.noDeletedChildren} /> : (
        <div className="deleted-list">
          {shown.map(c => {
            // Same id as a child already in My Children: restoring would overwrite or split their data.
            const active = childrenData.some(x => x.id === c.id);
            const entryCount = entries.filter(e => e.childId === c.id).length;
            const recordCount = records.filter(r => r.childId === c.id).length;
            return (
              <div className="deleted-row" key={`${c.id}:${c.deletedAt}`}>
                <ChildPhoto child={c} />
                <span>
                  <strong>{c.first} {c.last}</strong>
                  <small>{c.deletedAt ? t.deletedOn.replace("{date}", fmtLong(c.deletedAt.slice(0, 10), lang)) : ""}</small>
                  <small>{t.deletedChildData.replace("{entries}", String(entryCount)).replace("{records}", String(recordCount))}</small>
                </span>
                {active
                  ? <em>{t.alreadyInChildren}</em>
                  : <button onClick={() => confirm({
                      title: t.confirmRestoreChild.replace("{name}", `${c.first} ${c.last}`.trim()),
                      body: <p>{t.deletedChildData.replace("{entries}", String(entryCount)).replace("{records}", String(recordCount))}</p>,
                      confirmLabel: t.restoreChild,
                      onConfirm: () => latestRestore.current(c),
                    })}>{t.restoreChild}</button>}
              </div>
            );
          })}
        </div>
      )}
      {sharedShown.length > 0 && restoreShared && (
        <section className="deleted-shared">
          <h2>{t.deletedSharedTitle}</h2>
          <p className="deleted-intro">{t.deletedSharedIntro}</p>
          <div className="deleted-list">
            {sharedShown.map(d => {
              const kind = d.kind === "entry" ? t.deletedKindEntry : t.deletedKindRecord;
              const text = label(d);
              return (
                <div className="deleted-row" key={`${d.kind}:${d.item.id}`}>
                  <ChildPhoto child={d.child} />
                  <span>
                    <strong>{kind} · {d.child.first}</strong>
                    {text && <small className="deleted-snippet">{text.length > 80 ? `${text.slice(0, 80)}…` : text}</small>}
                    <small>{d.item.deletedAt ? t.deletedOn.replace("{date}", fmtLong(d.item.deletedAt.slice(0, 10), lang)) : ""}</small>
                  </span>
                  <button onClick={() => confirm({
                    title: t.confirmRestoreRecord.replace("{kind}", kind).replace("{name}", d.child.first),
                    body: text ? <p>{text}</p> : undefined,
                    confirmLabel: t.restoreRecord,
                    onConfirm: () => latestRestoreShared.current?.(d),
                  })}>{t.restoreRecord}</button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
