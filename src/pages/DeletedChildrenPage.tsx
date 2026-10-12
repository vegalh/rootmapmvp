import { Empty, PageHeader } from "../components/ui";
import { fmtLong } from "../lib/dates";
import { photoUrl } from "../lib/photos";
import type { Child, DeletedChild, Entry, Lang, LessonRecord } from "../types";
import type { Copy } from "../lib/i18n";

// Profiles removed from My Children, newest first. Nothing here is ever deleted for good; restoring puts the
// profile back with its original id, so its journal entries and activity records reappear with it.
export function DeletedChildrenPage({ deleted, childrenData, entries, records, restore, back, lang, t }: {
  deleted: DeletedChild[];
  childrenData: Child[];
  entries: Entry[];
  records: LessonRecord[];
  restore: (child: DeletedChild) => void;
  back: () => void;
  lang: Lang;
  t: Copy;
}) {
  const shown = [...deleted].sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
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
                <img src={photoUrl(c.photo)} alt="" />
                <span>
                  <strong>{c.first} {c.last}</strong>
                  <small>{c.deletedAt ? t.deletedOn.replace("{date}", fmtLong(c.deletedAt.slice(0, 10), lang)) : ""}</small>
                  <small>{t.deletedChildData.replace("{entries}", String(entryCount)).replace("{records}", String(recordCount))}</small>
                </span>
                {active
                  ? <em>{t.alreadyInChildren}</em>
                  : <button onClick={() => restore(c)}>{t.restoreChild}</button>}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
