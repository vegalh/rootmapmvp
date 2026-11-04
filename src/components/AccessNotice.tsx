import { useEffect, useState } from "react";
import { Modal } from "./ui";
import { archivedChanges, discardArchived, type ArchivedChange } from "../lib/data/store";
import { fmt, fmtLong } from "../lib/dates";
import type { Entry } from "../types";
import type { Copy } from "../lib/i18n";

// When a child's profile is no longer shared with this parent (removed from the circle, or the profile was deleted),
// a gentle note on My Children; and the changes made here that couldn't be sent any more, kept on this device
// (Shared Child Profiles Phase 3). Nothing about the child is shown: their data has left this device.
export function AccessNotice({ count, archived, review, dismiss, t }: {
  // Children no longer shared with this parent, not yet acknowledged here.
  count: number;
  archived: number;
  review: () => void;
  dismiss: () => void;
  t: Copy;
}) {
  if (!count && !archived) return null;
  return (
    <section className="access-notice" role="status">
      {count > 0 && <p>{count === 1 ? t.noAccessOne : t.noAccessMany.replace("{n}", String(count))}</p>}
      {archived > 0 && <p>{t.archivedNote.replace("{n}", String(archived))}</p>}
      <div className="access-notice-actions">
        {archived > 0 && <button className="text-action" onClick={review}>{t.archivedReview}</button>}
        {count > 0 && <button className="text-action" onClick={dismiss}>{t.done}</button>}
      </div>
    </section>
  );
}

// Moments where a change made on this device lost to someone else's at the same time (Shared Child Profiles Phase 5;
// lib/sync/runner.ts). Their version is shown; this parent's is kept on the Moment (components/KeptVersions.tsx).
// View opens it, which also clears the note; Done clears them all.
export function KeptEditsNotice({ entries, open, dismiss, t }: { entries: Entry[]; open: (id: string) => void; dismiss: () => void; t: Copy }) {
  if (!entries.length) return null;
  const lang = t.code === "zh" ? "zh" : "en";
  return (
    <section className="access-notice" role="status">
      {entries.map(e => (
        <div key={e.id} className="circle-join">
          <p>{t.keptEditNote.replace("{title}", e.title?.trim() || fmt(e.date, lang))}</p>
          <div className="access-notice-actions">
            <button className="text-action" onClick={() => open(e.id)}>{t.keptEditView}</button>
          </div>
        </div>
      ))}
      <div className="access-notice-actions"><button className="text-action" onClick={dismiss}>{t.done}</button></div>
    </section>
  );
}

const kindLabel = (kind: ArchivedChange["kind"], t: Copy) =>
  ({ entries: t.archivedKindEntry, records: t.archivedKindRecord, children: t.archivedKindChild, photos: t.archivedKindPhoto, versions: t.archivedKindVersion })[kind] ?? t.archivedKindEntry;

// The kept changes: only what kind each was and when it was kept (never its text, photos or child), and Discard.
export function ArchivedChangesSheet({ close, changed, t }: { close: () => void; changed: () => void; t: Copy }) {
  const [items, setItems] = useState<ArchivedChange[] | null>(null);
  const lang = t.code === "zh" ? "zh" : "en";
  const load = () => archivedChanges().then(setItems, () => setItems([]));
  useEffect(() => { void load(); }, []);
  const discard = async (ids: string[]) => {
    await discardArchived(ids);
    await load();
    changed();
  };
  return (
    <Modal title={t.archivedTitle} close={close}>
      <p className="circle-note">{t.archivedIntro}</p>
      {items && !items.length && <p className="circle-note">{t.archivedEmpty}</p>}
      {items && items.length > 0 && (
        <ul className="archived-list">
          {items.map(item => (
            <li key={item.id}>
              <span><strong>{kindLabel(item.kind, t)}</strong><small>{t.archivedKept.replace("{date}", fmtLong(item.keptAt.slice(0, 10), lang))}</small></span>
              <button className="text-action" onClick={() => void discard([item.id])}>{t.archivedDiscard}</button>
            </li>
          ))}
        </ul>
      )}
      <div className="sheet-buttons">
        {items && items.length > 1 && <button className="danger" onClick={() => void discard(items.map(i => i.id))}>{t.archivedDiscardAll}</button>}
        <button onClick={close}>{t.done}</button>
      </div>
    </Modal>
  );
}

export default AccessNotice;
