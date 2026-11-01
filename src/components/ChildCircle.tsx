import { useCallback, useEffect, useState } from "react";
import { Field, Modal, useConfirm } from "./ui";
import { getCloudClient } from "../lib/cloud/client";
import { syncNow } from "../lib/sync/runner";
import { formatRoute } from "../lib/routes";
import { fmt, localIsoDate } from "../lib/dates";
import { RELATIONSHIPS, accessOfRole, type Access, type Relationship, type TechnicalRole } from "../lib/childAccess";
import { unscope } from "../lib/data/schema";
import type { Child, Lang } from "../types";
import type { Copy } from "../lib/i18n";

// "Emma's Circle": the people who are part of a child's life in RootMap, by name and how they are related to the
// child (Shared Child Profiles Phase 3 + 4; docs/shared-child-profiles-phase4.md). The main view shows only people
// and relationships, never what each may do; everyone (including the person managing the profile) can set their own
// relationship label here. The person managing the profile opens Manage to invite others, change roles, remove
// members and read what each kind of access means. Anyone else can leave the Circle from the main view.
//
// Read from the server (`child_circle`), which returns names and relationships to anyone in the circle and each
// person's access only to the person managing the profile. Nothing here decides what is allowed: every change goes
// through a server function (child_memberships itself is never written to directly) that re-checks the caller.

type Person = { user_id: string | null; display_name: string; relationship: Relationship | null; role: TechnicalRole | null; is_me: boolean };
type TechnicalInviteRole = "editor" | "viewer";
type Invitation = { id: string; role: TechnicalInviteRole; email: string | null; created_at: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };
type InvitationState = "pending" | "accepted" | "expired" | "canceled";

export const accessLabel = (access: Access, t: Copy) => (access === "manage" ? t.accessManage : access === "edit" ? t.accessEdit : t.accessView);
export const accessInfo = (access: Access, t: Copy) => (access === "manage" ? t.accessManageInfo : access === "edit" ? t.accessEditInfo : t.accessViewInfo);
const relationshipLabel = (r: Relationship, t: Copy) => t[`rel_${r}` as const];

const invitationState = (inv: Invitation): InvitationState => {
  if (inv.revoked_at) return "canceled";
  if (inv.accepted_at) return "accepted";
  if (new Date(inv.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
};

export function ChildCircle({ child, homeFamilyId, access, afterLeave, notify, lang, t }: {
  child: Child;
  // The user's own family (a child of it has a plain id).
  homeFamilyId: string;
  access: Access;
  // Called once this device has left the Circle, so the caller can navigate away from a profile it no longer has.
  afterLeave: () => void;
  // Shows a short confirmation or problem (the app's toast).
  notify: (message: string) => void;
  lang: Lang;
  t: Copy;
}) {
  const scope = unscope(child.id);
  const familyId = scope?.familyId ?? homeFamilyId;
  const childId = scope?.id ?? child.id;
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [managing, setManaging] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const client = await getCloudClient();
    if (!client) return;
    const { data, error } = await client.rpc("child_circle", { p_family_id: familyId, p_child_id: childId });
    if (error) { setFailed(true); return; }
    setFailed(false);
    setPeople(data as Person[]);
  }, [familyId, childId]);
  useEffect(() => { void load(); }, [load]);

  const name = (p: Person) => (p.is_me ? t.circleYou : p.display_name.trim() || t.circleSomeone);
  const title = t.circleTitle.replace("{name}", child.first);
  const me = people?.find(p => p.is_me) ?? null;

  const setMyRelationship = async (value: string) => {
    const client = await getCloudClient();
    if (!client || !me?.user_id) return;
    const { error } = await client.rpc("set_circle_relationship", { p_family_id: familyId, p_child_id: childId, p_user_id: me.user_id, p_relationship: value || null });
    if (error) { notify(t.circleUnavailable); return; }
    void load();
  };

  const leave = () => confirm({
    title: t.circleLeaveTitle.replace("{childName}", child.first),
    body: t.circleLeaveBody.replace("{childName}", child.first),
    confirmLabel: t.circleLeaveAction,
    destructive: true,
    onConfirm: async () => {
      const client = await getCloudClient();
      if (!client) return;
      const { error } = await client.rpc("leave_circle", { p_family_id: familyId, p_child_id: childId });
      if (error) { notify(t.circleUnavailable); return; }
      // Hurries the device-side revocation cleanup (Phase 2b) along, rather than waiting for the next scheduled
      // round, so the child disappears from My Children right away.
      syncNow();
      afterLeave();
    },
  });

  return (
    <section className="child-circle" aria-label={title}>
      <div className="section-title">
        <h2>{title}</h2>
        {access === "manage" && people && <button className="text-action" onClick={() => setManaging(true)}>{t.circleManage}</button>}
      </div>
      {failed && !people && <p className="circle-note">{t.circleUnavailable}</p>}
      {people && (
        <ul className="circle-people">
          {people.map((p, i) => (
            <li key={p.user_id ?? `p${i}`}>
              <span className="circle-initial" aria-hidden="true">{name(p).slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{name(p)}</strong>
                {p.relationship && <small>{relationshipLabel(p.relationship, t)}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {access !== "manage" && (
        <>
          <p className="circle-note"><span>{t.circleYourAccess}: </span><strong>{accessLabel(access, t)}</strong> · {accessInfo(access, t)}</p>
          {me?.user_id && (
            <>
              <Field label={t.relationshipLabel}>
                <select value={me.relationship ?? ""} onChange={e => void setMyRelationship(e.target.value)}>
                  <option value="">{t.relationshipNone}</option>
                  {RELATIONSHIPS.map(r => <option value={r} key={r}>{relationshipLabel(r, t)}</option>)}
                </select>
              </Field>
              <button className="text-action danger" onClick={leave}>{t.circleLeave}</button>
            </>
          )}
        </>
      )}
      {managing && people && (
        <ManageCircle child={child} people={people} familyId={familyId} childId={childId} name={name} reload={load} close={() => setManaging(false)} notify={notify} lang={lang} t={t} />
      )}
    </section>
  );
}

// Only for the person managing the profile: each person's relationship, role and removal, what each kind of access
// means, and inviting someone new (Phase 4) with the link they create, plus the circle's pending invitations.
function ManageCircle({ child, people, familyId, childId, name, reload, close, notify, lang, t }: {
  child: Child;
  people: Person[];
  familyId: string;
  childId: string;
  name: (p: Person) => string;
  reload: () => Promise<void>;
  close: () => void;
  notify: (message: string) => void;
  lang: Lang;
  t: Copy;
}) {
  const [error, setError] = useState(false);
  const confirm = useConfirm();

  const setRelationship = async (person: Person, value: string) => {
    const client = await getCloudClient();
    if (!client || !person.user_id) return;
    const { error: e } = await client.rpc("set_circle_relationship", { p_family_id: familyId, p_child_id: childId, p_user_id: person.user_id, p_relationship: value || null });
    setError(!!e);
    await reload();
  };

  const changeRole = async (person: Person, value: string) => {
    const client = await getCloudClient();
    if (!client || !person.user_id) return;
    const { error: e } = await client.rpc("set_member_role", { p_family_id: familyId, p_child_id: childId, p_user_id: person.user_id, p_role: value });
    setError(!!e);
    await reload();
  };

  const removeMember = (person: Person) => confirm({
    title: t.circleRemoveTitle.replace("{name}", name(person)),
    body: t.circleRemoveBody.replace("{name}", name(person)).replace("{childName}", child.first),
    confirmLabel: t.circleRemoveAction,
    destructive: true,
    onConfirm: async () => {
      const client = await getCloudClient();
      if (!client || !person.user_id) return;
      const { error: e } = await client.rpc("remove_member", { p_family_id: familyId, p_child_id: childId, p_user_id: person.user_id });
      if (e) { setError(true); return; }
      await reload();
    },
  });

  // ---- Inviting someone new (Phase 4) ------------------------------------------------------------------------

  const [inviting, setInviting] = useState(false);
  const [role, setRole] = useState<TechnicalInviteRole>("editor");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);

  const loadInvitations = useCallback(async () => {
    const client = await getCloudClient();
    if (!client) return;
    const { data, error: e } = await client.rpc("list_invitations", { p_family_id: familyId, p_child_id: childId });
    if (e) return;
    setInvitations(data as Invitation[]);
  }, [familyId, childId]);
  useEffect(() => { void loadInvitations(); }, [loadInvitations]);

  const generate = async () => {
    setCreating(true);
    try {
      const client = await getCloudClient();
      if (!client) return;
      const { data, error: e } = await client.rpc("create_invitation", { p_family_id: familyId, p_child_id: childId, p_role: role, p_email: email.trim() || null });
      const row = (data as { id: string; token: string; expires_at: string }[] | null)?.[0];
      if (e || !row) { notify(t.inviteFailed); return; }
      // Only shown once, here: the raw token is never stored server-side and never appears again.
      setLink(`${window.location.origin}${window.location.pathname}${formatRoute({ screen: "invite", invite: row.token })}`);
      setEmail("");
      await loadInvitations();
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); notify(t.linkCopied); } catch { notify(t.shareFailed); }
  };
  const shareLink = async () => {
    if (!link) return;
    try {
      if (navigator.share) { await navigator.share({ title: t.inviteTitle.replace("{name}", child.first), url: link }); return; }
      await navigator.clipboard.writeText(link);
      notify(t.linkCopied);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") notify(t.shareFailed);
    }
  };

  const cancelInvitation = (inv: Invitation) => confirm({
    title: t.inviteCancel,
    body: t.inviteCancelConfirm,
    confirmLabel: t.inviteCancel,
    destructive: true,
    onConfirm: async () => {
      const client = await getCloudClient();
      if (!client) return;
      await client.rpc("revoke_invitation", { p_id: inv.id });
      await loadInvitations();
    },
  });

  return (
    <Modal title={t.circleTitle.replace("{name}", child.first)} close={close}>
      <ul className="circle-manage">
        {people.map((p, i) => (
          <li key={p.user_id ?? `p${i}`}>
            <span><strong>{name(p)}</strong><small>{p.role ? accessLabel(accessOfRole(p.role), t) : ""}</small></span>
            {p.role && p.role !== "owner" && p.user_id && (
              <Field label={t.inviteRoleQuestion}>
                <select value={p.role} onChange={e => void changeRole(p, e.target.value)}>
                  <option value="editor">{t.accessEdit}</option>
                  <option value="viewer">{t.accessView}</option>
                </select>
              </Field>
            )}
            <Field label={t.relationshipLabel}>
              <select value={p.relationship ?? ""} onChange={e => void setRelationship(p, e.target.value)} disabled={!p.user_id}>
                <option value="">{t.relationshipNone}</option>
                {RELATIONSHIPS.map(r => <option value={r} key={r}>{relationshipLabel(r, t)}</option>)}
              </select>
            </Field>
            {p.role && p.role !== "owner" && p.user_id && (
              <button className="text-action danger" onClick={() => removeMember(p)}>{t.circleRemoveMember}</button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="journal-status error" role="alert">{t.circleUnavailable}</p>}
      <dl className="circle-access">
        {(["manage", "edit", "view"] as const).map(a => (
          <div key={a}><dt>{accessLabel(a, t)}</dt><dd>{accessInfo(a, t)}</dd></div>
        ))}
      </dl>
      <section className="circle-invite">
        <h3>{t.inviteTitle.replace("{name}", child.first)}</h3>
        <p>{t.inviteManagerNote.replace("{name}", child.first)}</p>
        {!inviting && !link && <button onClick={() => setInviting(true)}>{t.inviteSomeone}</button>}
        {inviting && !link && (
          <div className="invite-form">
            <div className="segmented two" role="group" aria-label={t.inviteRoleQuestion}>
              <button type="button" className={role === "editor" ? "active" : ""} aria-pressed={role === "editor"} onClick={() => setRole("editor")}>{t.accessEdit}</button>
              <button type="button" className={role === "viewer" ? "active" : ""} aria-pressed={role === "viewer"} onClick={() => setRole("viewer")}>{t.accessView}</button>
            </div>
            <Field label={t.inviteEmailLabel}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t.inviteEmailPlaceholder} />
            </Field>
            <div className="sheet-buttons">
              <button onClick={() => setInviting(false)}>{t.cancel}</button>
              <button disabled={creating} onClick={() => void generate()}>{t.inviteGenerate}</button>
            </div>
          </div>
        )}
        {link && (
          <div className="invite-link-ready">
            <p>{t.inviteLinkReady}</p>
            <div className="sheet-buttons even">
              <button onClick={() => void copyLink()}>{t.inviteCopyLink}</button>
              <button onClick={() => void shareLink()}>{t.inviteShareLink}</button>
            </div>
            <button className="text-action" onClick={() => { setLink(null); setInviting(false); setRole("editor"); }}>{t.inviteAnother}</button>
          </div>
        )}
        {invitations && invitations.length > 0 && (
          <div className="invite-pending">
            <h4>{t.invitePending}</h4>
            <ul>
              {invitations.map(inv => {
                const state = invitationState(inv);
                return (
                  <li key={inv.id}>
                    <span>
                      <strong>{accessLabel(accessOfRole(inv.role), t)}</strong>
                      {inv.email && <small>{inv.email}</small>}
                      <small>
                        {state === "accepted" ? t.inviteAcceptedLabel
                          : state === "expired" ? t.inviteExpiredLabel
                          : state === "canceled" ? t.inviteCanceledLabel
                          : t.inviteExpiresOn.replace("{date}", fmt(localIsoDate(new Date(inv.expires_at)), lang))}
                      </small>
                    </span>
                    {state === "pending" && <button className="text-action danger" onClick={() => cancelInvitation(inv)}>{t.inviteCancel}</button>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
      <div className="sheet-buttons"><button onClick={close}>{t.done}</button></div>
    </Modal>
  );
}

export default ChildCircle;
