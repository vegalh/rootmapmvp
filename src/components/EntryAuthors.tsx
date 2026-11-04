import { useEffect, useState } from "react";
import { getCloudClient } from "../lib/cloud/client";
import { unscope } from "../lib/data/schema";
import type { Relationship } from "../lib/childAccess";
import type { Copy } from "../lib/i18n";

// "Added by Grandma Wu (Grandma)", "Last changed by you": who wrote a Moment, when several people write in a child's
// Journal (Shared Child Profiles Phase 5; migration 20261103000100_entry_authors.sql). Read from the server
// (`entry_people`), which answers anyone who can read the Moment with names and relationships only. Nothing is shown
// when the parent wrote and last changed it themselves (a Journal kept alone looks as it always has), offline, or for
// Moments written before children could be shared. Read again when the Moment changes (`updatedAt`).
//
// Deliberately quiet: one small line under the Moment, never on cards, Journal lists or activity records, and never
// counted or compared. RootMap is about caring for a child together, not about who wrote more.
type Person = { kind: "added" | "changed"; display_name: string; relationship: Relationship | null; is_me: boolean };

export function authorLines(rows: Person[], t: Copy): string[] {
  const added = rows.find(r => r.kind === "added");
  const changed = rows.find(r => r.kind === "changed");
  if (!rows.some(r => !r.is_me)) return [];
  const name = (p: Person) => {
    if (p.is_me) return t.authorYou;
    const n = p.display_name.trim() || t.authorSomeone;
    return p.relationship ? t.authorWithRelationship.replace("{name}", n).replace("{relationship}", t[`rel_${p.relationship}` as const]) : n;
  };
  const lines = added ? [t.entryAddedBy.replace("{name}", name(added))] : [];
  // The same person adding and last changing it is said once.
  const same = added && changed && added.is_me === changed.is_me && added.display_name === changed.display_name && added.relationship === changed.relationship;
  if (changed && !same) lines.push(t.entryChangedBy.replace("{name}", name(changed)));
  return lines;
}

export function EntryAuthors({ entryId, updatedAt, homeFamilyId, t }: { entryId: string; updatedAt?: string; homeFamilyId: string; t: Copy }) {
  const [rows, setRows] = useState<Person[]>([]);
  const scope = unscope(entryId);
  const familyId = scope?.familyId ?? homeFamilyId;
  const recordId = scope?.id ?? entryId;
  useEffect(() => {
    let live = true;
    void getCloudClient().then(async client => {
      if (!client) return;
      const { data, error } = await client.rpc("entry_people", { p_family_id: familyId, p_entry_id: recordId });
      if (live && !error) setRows(data as Person[]);
    });
    return () => { live = false; };
  }, [familyId, recordId, updatedAt]);
  const lines = authorLines(rows, t);
  if (!lines.length) return null;
  return <p className="entry-authors">{lines.join(" · ")}</p>;
}

export default EntryAuthors;
