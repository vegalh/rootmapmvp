import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { getCloudClient } from "../lib/cloud/client";
import { scopedId } from "../lib/data/schema";
import { publishedCollection } from "../lib/data/store";
import { syncNow } from "../lib/sync/runner";
import type { Copy } from "../lib/i18n";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Opening an invitation link (#/invite/<token>; Shared Child Profiles Phase 4, docs/shared-child-profiles-phase4.md).
// By the time this page renders, App.tsx has already made sure someone is signed in (an invitation is never shown to
// a signed-out visitor) and has the token from the address. Nothing about the child is asked for until the server
// has checked the token itself: this page shows only what `get_invitation_preview` answers, and the raw token never
// appears in its own text, a toast or a log — only ever inside the one link.
type PreviewStatus = "invalid" | "expired" | "revoked" | "accepted" | "wrong_email" | "valid";
type Phase = "checking" | "failed" | "accepting" | PreviewStatus;
type Preview = { childFirst: string; role: "editor" | "viewer"; inviterName: string };

export function InvitePage({ token, switchAccount, accepted, declined, notify, t }: {
  token: string;
  // Signs out without losing the invitation address, so a different, matching account can sign in to the same link
  // (the "wrong_email" case).
  switchAccount: () => void;
  accepted: (familyId: string, childId: string) => void;
  declined: () => void;
  notify: (message: string) => void;
  t: Copy;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const client = await getCloudClient();
      if (!client) { if (live) setPhase("failed"); return; }
      const { data, error } = await client.rpc("get_invitation_preview", { p_token: token });
      if (!live) return;
      const row = (data as { status: PreviewStatus; child_first: string | null; role: "editor" | "viewer" | null; inviter_name: string | null }[] | null)?.[0];
      if (error || !row) { setPhase("failed"); return; }
      if (row.status === "valid" && row.child_first && row.role) {
        setPreview({ childFirst: row.child_first, role: row.role, inviterName: row.inviter_name || "" });
      }
      setPhase(row.status);
    })();
    return () => { live = false; };
  }, [token]);

  const accept = async () => {
    setPhase("accepting");
    const client = await getCloudClient();
    if (!client) { setPhase("failed"); return; }
    const { data, error } = await client.rpc("accept_invitation", { p_token: token });
    const row = (data as { status: PreviewStatus | "ok"; family_id: string | null; child_id: string | null }[] | null)?.[0];
    if (error || !row) { setPhase("failed"); return; }
    if (row.status !== "ok" || !row.family_id || !row.child_id) { setPhase(row.status as PreviewStatus); return; }
    // A full sync brings the newly shared child (and its records) onto this device before the profile opens, so it
    // is never shown half-loaded. syncNow() only starts a round (it does not return a promise that settles once the
    // round lands), so this waits for the child to actually appear in the local, reactive collection — the same one
    // My Children reads from — rather than opening a profile that isn't there yet.
    const scoped = scopedId(row.family_id, row.child_id);
    for (let i = 0; i < 20 && !publishedCollection("children").some(c => c.id === scoped && !c.deletedAt); i++) {
      syncNow();
      await sleep(400);
    }
    notify(t.inviteJoined.replace("{name}", preview?.childFirst ?? ""));
    accepted(row.family_id, row.child_id);
  };

  const note = phase === "invalid" ? t.inviteNotValid
    : phase === "expired" ? t.inviteExpiredNote
    : phase === "revoked" ? t.inviteNoLongerAvailable
    : phase === "accepted" ? t.inviteAlreadyUsed
    : phase === "wrong_email" ? t.inviteWrongEmailNote
    : phase === "failed" ? t.inviteFailed
    : "";

  return (
    <main className="simple-page invite-page">
      <div className="info-card">
        <Icon name="users" size={28} />
        {phase === "checking" && <p role="status">{t.inviteOpening}</p>}
        {note && (
          <>
            <p role={phase === "failed" ? "alert" : undefined}>{note}</p>
            {phase === "wrong_email" && <button className="wide-secondary" onClick={switchAccount}>{t.inviteSwitchAccount}</button>}
          </>
        )}
        {(phase === "valid" || phase === "accepting") && preview && (
          <>
            <h2>{t.invitePreviewLede.replace("{name}", preview.childFirst)}</h2>
            {preview.inviterName && <p>{t.invitePreviewFrom.replace("{name}", preview.inviterName)}</p>}
            <p>{preview.role === "editor" ? t.accessEditInfo : t.accessViewInfo}</p>
            <div className="sheet-buttons even">
              <button onClick={declined} disabled={phase === "accepting"}>{t.inviteDecline}</button>
              <button onClick={() => void accept()} disabled={phase === "accepting"}>{t.inviteAccept}</button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
