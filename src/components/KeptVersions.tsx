import { useEffect, useState } from "react";
import { getCloudClient } from "../lib/cloud/client";
import { fmtLong, localIsoDate } from "../lib/dates";
import { unscope } from "../lib/data/schema";
import type { Lang } from "../types";
import type { Copy } from "../lib/i18n";

// Versions of a Moment that lost a concurrent edit (release readiness, finding S4). When two people change the same
// part of a Moment at the same time, sync keeps the first to reach the server and stores the other in
// `record_versions` (lib/sync/resolver.ts); until now no screen showed it. This lists them, read-only, below the
// Moment. The server shows a version only to the person managing the child's profile and to the person whose
// version it was (RLS, Phase 1b), so nobody else sees anything here. Offline or none: nothing is shown.
type Kept = { id: string; reason: string; created_at: string | null; updated_at: string; version: { title?: string | null; text?: string | null } };
const SHOWN = new Set(["text_conflict", "field_conflict", "edited_after_delete"]);

export function KeptVersions({ entryId, homeFamilyId, lang, t }: { entryId: string; homeFamilyId: string; lang: Lang; t: Copy }) {
  const [kept, setKept] = useState<Kept[]>([]);
  const scope = unscope(entryId);
  const familyId = scope?.familyId ?? homeFamilyId;
  const recordId = scope?.id ?? entryId;
  useEffect(() => {
    let live = true;
    void getCloudClient().then(async client => {
      if (!client) return;
      const { data, error } = await client.from("record_versions").select("id, reason, created_at, updated_at, version")
        .eq("family_id", familyId).eq("table_name", "entries").eq("record_id", recordId).is("deleted_at", null)
        .order("updated_at", { ascending: false }).limit(20);
      if (live && !error) setKept((data as Kept[]).filter(k => SHOWN.has(k.reason) && (k.version?.text || k.version?.title)));
    });
    return () => { live = false; };
  }, [familyId, recordId]);
  if (!kept.length) return null;
  return (
    <section className="kept-versions">
      <h2>{t.keptVersionsTitle}</h2>
      <p>{t.keptVersionsIntro}</p>
      <ul>
        {kept.map(k => (
          <li key={k.id}>
            <small>{t.keptVersionOn.replace("{date}", fmtLong(localIsoDate(new Date(k.created_at ?? k.updated_at)), lang))}</small>
            {k.version.title && <strong>{k.version.title}</strong>}
            {k.version.text && <p>{k.version.text}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default KeptVersions;
