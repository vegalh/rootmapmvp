import { useCallback, useEffect, useRef, useState } from "react";
import { Field, Modal, useConfirm } from "./ui";
import { getCloudClient } from "../lib/cloud/client";
import { syncNow } from "../lib/sync/runner";
import { formatRoute } from "../lib/routes";
import { fmt, localIsoDate } from "../lib/dates";
import { RELATIONSHIPS, accessOfRole, type Access, type Relationship, type TechnicalRole } from "../lib/childAccess";
import { scopedId, unscope } from "../lib/data/schema";
import { createRefresher, fromRpc, type Fetched, type Refresher } from "../lib/refresher";
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
//
// Kept fresh (release readiness): read again after every change made here, when the parent's own access changes
// (sync noticed a new role), when Manage opens, when the page comes back to the foreground or the network returns,
// and, while Manage is open with an invitation still pending, every POLL_MS so someone joining by link shows up.
// One request at a time and never a stale answer over a newer one (lib/refresher.ts). Once the server says this
// person is no longer in the circle, the names are taken off the screen.

type Person = { user_id: string | null; display_name: string; relationship: Relationship | null; role: TechnicalRole | null; is_me: boolean };
type TechnicalInviteRole = "editor" | "viewer";
type Invitation = { id: string; role: TechnicalInviteRole; email: string | null; created_at: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };
type InvitationState = "pending" | "accepted" | "expired" | "canceled";
// A live offer to hand a child's profile to someone (Phase 5, migration 20261103000200_ownership_transfer.sql): made by
// the caller as the person managing it (`incoming` false, with the recipient's id), or made to the caller.
type Transfer = { id: string; family_id: string; child_id: string; child_first: string; from_name: string; to_user: string | null; to_name: string; expires_at: string; incoming: boolean };

export const accessLabel = (access: Access, t: Copy) => (access === "manage" ? t.accessManage : access === "edit" ? t.accessEdit : t.accessView);
export const accessInfo = (access: Access, t: Copy) => (access === "manage" ? t.accessManageInfo : access === "edit" ? t.accessEditInfo : t.accessViewInfo);
const relationshipLabel = (r: Relationship, t: Copy) => t[`rel_${r}` as const];

const POLL_MS = 15000;

// A list read from the server for this child, refreshed as described above. Returns `reload(force = true)`.
function useServerList<T>(fetch: () => Promise<Fetched<T>>, apply: (result: Fetched<T>) => void, key: string) {
  const latest = useRef({ fetch, apply });
  latest.current = { fetch, apply };
  const refresher = useRef<Refresher | null>(null);
  useEffect(() => {
    const r = createRefresher<T>(() => latest.current.fetch(), result => latest.current.apply(result));
    refresher.current = r;
    void r.refresh({ force: true });
    const passive = () => { if (document.visibilityState === "visible") void r.refresh(); };
    document.addEventListener("visibilitychange", passive);
    window.addEventListener("focus", passive);
    window.addEventListener("online", passive);
    return () => {
      r.stop();
      document.removeEventListener("visibilitychange", passive);
      window.removeEventListener("focus", passive);
      window.removeEventListener("online", passive);
    };
  }, [key]);
  return useCallback((force = true) => refresher.current?.refresh({ force }) ?? Promise.resolve(), []);
}

const rpcList = async <T,>(fn: string, args: Record<string, unknown>): Promise<Fetched<T>> => {
  const client = await getCloudClient();
  if (!client) return { ok: false, denied: false };
  return fromRpc<T>(await client.rpc(fn, args));
};

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

  const load = useServerList<Person[]>(
    () => rpcList("child_circle", { p_family_id: familyId, p_child_id: childId }),
    result => {
      setFailed(!result.ok);
      if (result.ok) setPeople(result.value);
      // No longer in the circle: nobody's name stays on this screen. Offline: the last list stays.
      else if (result.denied) { setPeople(null); setManaging(false); }
    },
    `${familyId}/${childId}`,
  );
  // Sync noticed a different role for this person (the Owner changed it): their own line and the list follow.
  const shownAccess = useRef(access);
  useEffect(() => {
    if (shownAccess.current === access) return;
    shownAccess.current = access;
    void load();
  }, [access, load]);

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
        {access === "manage" && people && <button className="text-action" onClick={() => { setManaging(true); void load(); }}>{t.circleManage}</button>}
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
          {access === "edit" && <OwnershipOffers familyId={familyId} childId={childId} notify={notify} t={t} />}
          {me?.user_id && (
            <>
              <Field label={t.relationshipLabel}>
                <select value={me.relationship ?? ""} onChange={e => void setMyRelationship(e.target.value)}>
                  <option value="">{t.relationshipNone}</option>
                  {RELATIONSHIPS.map(r => <option value={r} key={r}>{relationshipLabel(r, t)}</option>)}
                </select>
              </Field>
              {/* The child's own family stays in its circle (after handing its profile to someone else). */}
              {scope && <button className="text-action danger" onClick={leave}>{t.circleLeave}</button>}
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
  reload: (force?: boolean) => Promise<void>;
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

  // ---- Handing the profile to someone with Add & Edit (Phase 5) ---------------------------------------------

  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const loadTransfer = useServerList<Transfer[]>(
    () => rpcList("ownership_transfers", {}),
    result => { if (result.ok) setTransfer(result.value.find(x => !x.incoming && x.family_id === familyId && x.child_id === childId) ?? null); },
    `${familyId}/${childId}`,
  );
  const offerTransfer = (person: Person) => confirm({
    title: t.transferTitle.replace("{child}", child.first).replace("{name}", name(person)),
    body: t.transferBody.replace("{child}", child.first).replace(/\{name\}/g, name(person)),
    confirmLabel: t.transferSend,
    onConfirm: async () => {
      const client = await getCloudClient();
      if (!client || !person.user_id) return;
      const { error: e } = await client.rpc("offer_ownership_transfer", { p_family_id: familyId, p_child_id: childId, p_to_user: person.user_id });
      setError(!!e);
      await loadTransfer();
    },
  });
  const cancelTransfer = async () => {
    const client = await getCloudClient();
    if (!client || !transfer) return;
    const { error: e } = await client.rpc("cancel_ownership_transfer", { p_id: transfer.id });
    setError(!!e);
    await loadTransfer();
  };

  // ---- Inviting someone new (Phase 4) ------------------------------------------------------------------------

  const [inviting, setInviting] = useState(false);
  const [role, setRole] = useState<TechnicalInviteRole>("editor");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  // Neither sharing nor copying worked (some in-app browsers, e.g. WeChat's): the link is shown to copy by hand.
  const [showLink, setShowLink] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);

  const loadInvitations = useServerList<Invitation[]>(
    () => rpcList("list_invitations", { p_family_id: familyId, p_child_id: childId }),
    result => {
      if (result.ok) setInvitations(result.value);
      else if (result.denied) setInvitations(null);
    },
    `${familyId}/${childId}`,
  );
  // Someone joining by link happens on their own device: while an invitation is pending and the page is in front,
  // look again now and then. An invitation newly marked joined brings the people list up to date.
  const pending = invitations?.filter(inv => invitationState(inv) === "pending").length ?? 0;
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void loadInvitations(false); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [pending, loadInvitations]);
  const joined = invitations?.filter(inv => inv.accepted_at).length ?? null;
  const seenJoined = useRef(joined);
  useEffect(() => {
    if (joined === null || joined === seenJoined.current) return;
    const first = seenJoined.current === null;
    seenJoined.current = joined;
    if (!first) void reload();
  }, [joined, reload]);

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
    try { await navigator.clipboard.writeText(link); notify(t.linkCopied); } catch { setShowLink(true); }
  };
  const shareLink = async () => {
    if (!link) return;
    try {
      if (navigator.share) { await navigator.share({ title: t.inviteTitle.replace("{name}", child.first), url: link }); return; }
      await navigator.clipboard.writeText(link);
      notify(t.linkCopied);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setShowLink(true);
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
      const { error: e } = await client.rpc("revoke_invitation", { p_id: inv.id });
      setError(!!e);
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
            {p.role === "editor" && p.user_id && transfer?.to_user === p.user_id && (
              <p className="circle-transfer">
                <span>{t.transferWaiting.replace("{name}", name(p))}</span>
                <button className="text-action" onClick={() => void cancelTransfer()}>{t.transferCancel}</button>
              </p>
            )}
            {p.role === "editor" && p.user_id && !transfer && (
              <button className="text-action" onClick={() => offerTransfer(p)}>{t.transferOffer}</button>
            )}
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
            {showLink && (
              <Field label={t.inviteLinkManual}>
                <input readOnly value={link} onFocus={e => e.currentTarget.select()} />
              </Field>
            )}
            <div className="sheet-buttons even">
              <button onClick={() => void copyLink()}>{t.inviteCopyLink}</button>
              <button onClick={() => void shareLink()}>{t.inviteShareLink}</button>
            </div>
            <button className="text-action" onClick={() => { setLink(null); setShowLink(false); setInviting(false); setRole("editor"); }}>{t.inviteAnother}</button>
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

// "Ana would like you to manage Emma's profile": offers made to this person to take over a child's profile, on My
// Children (every child) and on that child's page (`familyId` + `childId`). Accepting asks once more, then sync picks
// up the new roles (the previous Owner keeps Add & Edit). The server re-checks everything; an offer that was
// cancelled, expired or went stale meanwhile just says it is no longer available.
export function OwnershipOffers({ familyId, childId, notify, t }: { familyId?: string; childId?: string; notify: (message: string) => void; t: Copy }) {
  const [offers, setOffers] = useState<Transfer[]>([]);
  const confirm = useConfirm();
  const reload = useServerList<Transfer[]>(
    () => rpcList("ownership_transfers", {}),
    result => { if (result.ok) setOffers(result.value.filter(x => x.incoming && (!childId || (x.family_id === familyId && x.child_id === childId)))); else if (result.denied) setOffers([]); },
    `${familyId ?? ""}/${childId ?? ""}`,
  );
  const from = (o: Transfer) => o.from_name.trim() || t.circleSomeone;
  const accept = (o: Transfer) => confirm({
    title: t.transferAcceptTitle.replace("{child}", o.child_first),
    body: t.transferIncomingInfo.replace("{name}", from(o)),
    confirmLabel: t.transferAccept,
    onConfirm: async () => {
      const client = await getCloudClient();
      if (!client) return;
      const { data, error } = await client.rpc("accept_ownership_transfer", { p_id: o.id });
      notify(!error && (data === "ok" || data === "accepted") ? t.transferDone.replace("{child}", o.child_first) : t.transferUnavailable);
      syncNow();
      await reload();
    },
  });
  const decline = async (o: Transfer) => {
    setOffers(current => current.filter(x => x.id !== o.id));
    const client = await getCloudClient();
    await client?.rpc("decline_ownership_transfer", { p_id: o.id });
    void reload();
  };
  if (!offers.length) return null;
  return (
    <section className="access-notice circle-joins" role="status">
      {offers.map(o => (
        <div key={o.id} className="circle-join">
          <p>{t.transferIncoming.replace("{name}", from(o)).replace("{child}", o.child_first)}</p>
          <div className="access-notice-actions">
            <button className="text-action" onClick={() => accept(o)}>{t.transferAccept}</button>
            <button className="text-action" onClick={() => void decline(o)}>{t.transferDecline}</button>
          </div>
        </div>
      ))}
    </section>
  );
}

// "Nina joined Emma's Circle": for the person managing a child's profile, the people who joined by invitation since
// they last looked (release readiness; migration 20261102000100_circle_joins.sql). The server keeps them with the
// invitation itself, so each acceptance is announced once, on every device, until dismissed. Only a display name is
// shown, never an email. View opens the child's page, where the circle is.
type Join = { id: string; family_id: string; child_id: string; child_first: string; member_name: string };

export function CircleJoins({ homeFamilyId, openChild, t }: { homeFamilyId: string; openChild: (id: string) => void; t: Copy }) {
  const [joins, setJoins] = useState<Join[]>([]);
  const reload = useServerList<Join[]>(
    () => rpcList("circle_joins", {}),
    result => { if (result.ok) setJoins(result.value); else if (result.denied) setJoins([]); },
    homeFamilyId,
  );
  const dismiss = async (id: string) => {
    setJoins(current => current.filter(j => j.id !== id));
    const client = await getCloudClient();
    await client?.rpc("dismiss_circle_joins", { p_ids: [id] });
    void reload();
  };
  if (!joins.length) return null;
  return (
    <section className="access-notice circle-joins" role="status">
      {joins.map(j => (
        <div key={j.id} className="circle-join">
          <p>{(j.member_name.trim() ? t.circleJoinedNamed.replace("{name}", j.member_name.trim()) : t.circleJoinedSomeone).replace("{child}", j.child_first)}</p>
          <div className="access-notice-actions">
            <button className="text-action" onClick={() => { void dismiss(j.id); openChild(j.family_id === homeFamilyId ? j.child_id : scopedId(j.family_id, j.child_id)); }}>{t.circleJoinedView}</button>
            <button className="text-action" onClick={() => void dismiss(j.id)}>{t.done}</button>
          </div>
        </div>
      ))}
    </section>
  );
}

export default ChildCircle;
