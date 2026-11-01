import { useCallback, useEffect, useState } from "react";
import { Field, Modal } from "./ui";
import { getCloudClient } from "../lib/cloud/client";
import { RELATIONSHIPS, accessOfRole, type Access, type Relationship, type TechnicalRole } from "../lib/childAccess";
import { unscope } from "../lib/data/schema";
import type { Child } from "../types";
import type { Copy } from "../lib/i18n";

// "Emma's Circle": the people who are part of a child's life in RootMap, by name and how they are related to the child
// (Shared Child Profiles Phase 3; docs/shared-child-profiles-phase3.md). The main view shows only people and
// relationships, never what each may do. The person managing the profile opens Manage to give relationships and to
// read what each kind of access means; everyone else sees one line about what they themselves can do.
//
// Read from the server (`child_circle`), which returns names and relationships to anyone in the circle and each
// person's access only to the person managing the profile. Nothing here decides what is allowed.

type Person = { user_id: string | null; display_name: string; relationship: Relationship | null; role: TechnicalRole | null; is_me: boolean };

export const accessLabel = (access: Access, t: Copy) => (access === "manage" ? t.accessManage : access === "edit" ? t.accessEdit : t.accessView);
export const accessInfo = (access: Access, t: Copy) => (access === "manage" ? t.accessManageInfo : access === "edit" ? t.accessEditInfo : t.accessViewInfo);
const relationshipLabel = (r: Relationship, t: Copy) => t[`rel_${r}` as const];

export function ChildCircle({ child, homeFamilyId, access, t }: {
  child: Child;
  // The user's own family (a child of it has a plain id).
  homeFamilyId: string;
  access: Access;
  t: Copy;
}) {
  const scope = unscope(child.id);
  const familyId = scope?.familyId ?? homeFamilyId;
  const childId = scope?.id ?? child.id;
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [managing, setManaging] = useState(false);

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
        <p className="circle-note"><span>{t.circleYourAccess}: </span><strong>{accessLabel(access, t)}</strong> · {accessInfo(access, t)}</p>
      )}
      {managing && people && (
        <ManageCircle child={child} people={people} familyId={familyId} childId={childId} name={name} reload={load} close={() => setManaging(false)} t={t} />
      )}
    </section>
  );
}

// Only for the person managing the profile: each person's relationship and access, what each kind of access means,
// and (not yet active) inviting someone.
function ManageCircle({ child, people, familyId, childId, name, reload, close, t }: {
  child: Child;
  people: Person[];
  familyId: string;
  childId: string;
  name: (p: Person) => string;
  reload: () => Promise<void>;
  close: () => void;
  t: Copy;
}) {
  const [error, setError] = useState(false);
  const setRelationship = async (person: Person, value: string) => {
    const client = await getCloudClient();
    if (!client || !person.user_id) return;
    const { error: e } = await client.rpc("set_circle_relationship", { p_family_id: familyId, p_child_id: childId, p_user_id: person.user_id, p_relationship: value || null });
    setError(!!e);
    await reload();
  };
  return (
    <Modal title={t.circleTitle.replace("{name}", child.first)} close={close}>
      <ul className="circle-manage">
        {people.map((p, i) => (
          <li key={p.user_id ?? `p${i}`}>
            <span><strong>{name(p)}</strong><small>{p.role ? accessLabel(accessOfRole(p.role), t) : ""}</small></span>
            <Field label={t.relationshipLabel}>
              <select value={p.relationship ?? ""} onChange={e => void setRelationship(p, e.target.value)} disabled={!p.user_id}>
                <option value="">{t.relationshipNone}</option>
                {RELATIONSHIPS.map(r => <option value={r} key={r}>{relationshipLabel(r, t)}</option>)}
              </select>
            </Field>
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
        <p className="circle-note">{t.inviteSoon}</p>
      </section>
      <div className="sheet-buttons"><button onClick={close}>{t.done}</button></div>
    </Modal>
  );
}

export default ChildCircle;
