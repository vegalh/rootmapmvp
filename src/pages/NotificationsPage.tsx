import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/ui";
import { useStored } from "../lib/storage";
import type { Child } from "../types";
import { notificationTabLabel, type Copy } from "../lib/i18n";

// Prototype notification feed; wire this to a real backend when available.
// `text`/`titleKey` reference translation keys in `copy` so the notification feed is bilingual.
const NOTES = [
  { id: "n1", cat: "Follow-ups", childId: "emma", title: "Emma Thompson", textKey: "notifyEmmaFollowUp" as const },
  { id: "n2", cat: "Follow-ups", childId: "noah", title: "Noah Williams", textKey: "notifyNoahFollowUp" as const },
  { id: "n3", cat: "Classroom", titleKey: "classroomUpdateTitle" as const, textKey: "notifyClassroomUpdate" as const },
];

export function NotificationsPage({ childrenData, back, goChild, t }: { childrenData: Child[]; back: () => void; goChild: (id: string) => void; t: Copy }) {
  const [read, setRead] = useStored<string[]>("rootmap-read-notifications", []);
  const [filter, setFilter] = useState("All");
  const notes = NOTES.filter(n => filter === "All" || n.cat === filter);
  return (
    <main className="simple-page notification-page">
      <PageHeader title={t.notificationsTitle} back={back} action={<button className="text-action" onClick={() => setRead(["n1", "n2", "n3"])}>{t.markAll}</button>} />
      <div className="notification-tabs">
        {["All", "Follow-ups", "Classroom"].map(x => <button className={filter === x ? "active" : ""} onClick={() => setFilter(x)} key={x}>{notificationTabLabel(x, t)}</button>)}
      </div>
      {notes.map(n => (
        <button
          className={`notification-item ${!read.includes(n.id) ? "unread" : ""} ${n.cat === "Follow-ups" ? "reminder" : ""}`}
          onClick={() => { setRead([...new Set([...read, n.id])]); if (n.childId) goChild(n.childId); }}
          key={n.id}
        >
          {n.childId ? <img src={childrenData.find(c => c.id === n.childId)?.photo} alt="" /> : <i><Icon name="bell" /></i>}
          <span><strong>{n.titleKey ? t[n.titleKey] : n.title}</strong><p>{t[n.textKey]}</p><small>{notificationTabLabel(n.cat, t)}</small></span>
          <Icon name="chevron" />
        </button>
      ))}
    </main>
  );
}
