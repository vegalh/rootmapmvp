import { useState } from "react";
import { Icon } from "../components/Icon";
import { Modal, PageHeader } from "../components/ui";
import type { CloudState } from "../lib/cloud/session";
import { useSyncStatus } from "../lib/cloud/hooks";
import type { SyncStatus } from "../lib/sync/status";
import type { Copy } from "../lib/i18n";

// The parent's RootMap account (Phase 2B-2 M2): who is signed in, and Sign out. Signing in and out never changes
// what is stored on this device.
export function AccountPage({ cloud, back, signOut, t }: { cloud: CloudState; back: () => void; signOut: () => Promise<void>; t: Copy }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const signedIn = cloud.status === "signed-in" ? cloud : null;
  const sync = useSyncStatus();

  const confirm = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    setConfirming(false);
  };

  return (
    <main className="simple-page">
      <PageHeader title={t.accountTitle} back={back} />
      <div className="info-card">
        <Icon name="user" size={28} />
        <h2>{t.accountSignedIn}</h2>
        {signedIn?.user.email && <p style={{ overflowWrap: "anywhere" }}><strong>{signedIn.user.email}</strong></p>}
        {signedIn?.offline && <p>{t.accountOffline}</p>}
        <SyncSummary sync={sync} t={t} />
        <p>{t.accountLocalNote}</p>
        <button className="wide-secondary" onClick={() => setConfirming(true)} disabled={!signedIn}>{t.signOut}</button>
      </div>
      {confirming && (
        <Modal title={t.signOutTitle} close={() => !busy && setConfirming(false)}>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 15, lineHeight: 1.6 }}>{t.signOutBody}</p>
          <div className="sheet-buttons even">
            <button onClick={() => setConfirming(false)} disabled={busy}>{t.cancel}</button>
            <button onClick={() => void confirm()} disabled={busy}>{t.signOut}</button>
          </div>
        </Modal>
      )}
    </main>
  );
}

// Backup status in plain words. "All backed up" appears only when it is true (lib/sync/status.ts).
function SyncSummary({ sync, t }: { sync: SyncStatus; t: Copy }) {
  const lines: string[] = [];
  if (sync.allBackedUp) lines.push(t.syncAllBackedUp);
  else {
    if (sync.phase === "offline") lines.push(t.syncOffline);
    else if (sync.phase === "syncing" || (sync.phase === "idle" && !sync.lastSyncedAt)) lines.push(t.syncWorking);
    else if (sync.phase === "error") lines.push(t.syncError);
    if (sync.pending) lines.push(t.syncPending.replace("{n}", String(sync.pending)));
    if (sync.photosWaiting) lines.push(t.syncPhotosWaiting.replace("{n}", String(sync.photosWaiting)));
    if (sync.photosFailed) lines.push(t.syncPhotosFailed.replace("{n}", String(sync.photosFailed)));
    if (sync.held) lines.push(t.syncHeld.replace("{n}", String(sync.held)));
    if (sync.failed) lines.push(t.syncFailed.replace("{n}", String(sync.failed)));
  }
  return (
    <div className="sync-summary" role="status" data-backed-up={sync.allBackedUp ? "yes" : "no"}>
      {lines.map(line => <p key={line}>{line}</p>)}
    </div>
  );
}
