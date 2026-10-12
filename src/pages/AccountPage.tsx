import { useState } from "react";
import { Icon } from "../components/Icon";
import { Modal, PageHeader } from "../components/ui";
import type { CloudState } from "../lib/cloud/session";
import type { Copy } from "../lib/i18n";

// The parent's RootMap account (Phase 2B-2 M2): who is signed in, and Sign out. Signing in and out never changes
// what is stored on this device.
export function AccountPage({ cloud, back, signOut, t }: { cloud: CloudState; back: () => void; signOut: () => Promise<void>; t: Copy }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const signedIn = cloud.status === "signed-in" ? cloud : null;

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
