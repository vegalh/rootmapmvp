import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/ui";
import { fmtLong } from "../lib/dates";
import { SyncOffline } from "../lib/sync/engine";
import { accountsThatImported, type ImportAnswers, type ImportCounts, type Prepared } from "../lib/sync/guestImport";
import { acceptImport, dismissImport, prepareImport } from "../lib/sync/runner";
import type { Copy } from "../lib/i18n";
import type { Lang } from "../types";

// Bringing what was saved before signing in into the account (Phase 2B-2 M6; lib/sync/guestImport.ts). One
// question; a second one only for records whose origin isn't known, and one per child that may already be in the
// account. Nothing is copied until "Add to my account"; the device's own copy is never changed.
type Phase = "checking" | "offline" | "failed" | "nothing" | "ready" | "saving";

const countLines = (c: ImportCounts, t: Copy) => [
  [c.entries, t.importMemories], [c.records, t.importActivities], [c.plans, t.importPlans], [c.goals, t.importGoals], [c.saved, t.importSaved], [c.photos, t.importPhotos],
].filter(([n]) => (n as number) > 0).map(([n, text]) => (text as string).replace("{n}", String(n)));

export function GuestImportPage({ userId, back, done, lang, t }: { userId: string; back: () => void; done: (started: boolean) => void; lang: Lang; t: Copy }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [uncertain, setUncertain] = useState<boolean | null>(null);
  const [same, setSame] = useState<Record<string, boolean>>({});

  const check = useCallback(async () => {
    setPhase("checking");
    try {
      const p = await prepareImport();
      setPrepared(p);
      setPhase(!p || p.offer.nothingToImport ? "nothing" : "ready");
    } catch (e) {
      setPhase(e instanceof SyncOffline ? "offline" : "failed");
    }
  }, []);
  useEffect(() => { void check(); }, [check]);

  const offer = prepared?.offer;
  const needsUncertain = !!offer && offer.plan.ask.length > 0;
  const answered = !!offer && (!needsUncertain || uncertain !== null) && offer.duplicates.every(d => d.localId in same);

  const add = async () => {
    if (!offer || !answered) return;
    setPhase("saving");
    const answers: ImportAnswers = { includeUncertain: !!uncertain, sameChild: same };
    try {
      const result = await acceptImport(answers, prepared!);
      done(!!result && result.status !== "decided");
    } catch (e) {
      setPhase(e instanceof SyncOffline ? "offline" : "failed");
    }
  };
  const later = async () => {
    try { await dismissImport(); } catch { /* asked again next time */ }
    back();
  };

  const otherAccount = accountsThatImported().some(id => id !== userId);
  const uncertainItems = offer ? [...offer.uncertainChildNames, ...countLines(offer.uncertain, t)].join(", ") : "";

  return (
    <main className="simple-page guest-import">
      <PageHeader title={t.importTitle} back={back} />
      <div className="info-card">
        <Icon name="user" size={28} />
        {phase === "checking" && <p role="status">{t.importChecking}</p>}
        {phase === "offline" && <p role="alert">{t.importOffline}</p>}
        {phase === "failed" && <p role="alert">{t.importFailed}</p>}
        {phase === "nothing" && <p>{t.importNothing}</p>}
        {(phase === "offline" || phase === "failed") && <button className="wide-secondary" onClick={() => void check()}>{t.tryAgain}</button>}
        {offer && (phase === "ready" || phase === "saving") && (
          <>
            <h2>{t.importTitle}</h2>
            <p>{t.importIntro}</p>
            <div className="import-summary" data-testid="import-summary">
              {offer.childNames.length > 0 && <p><strong>{t.importChildren.replace("{names}", offer.childNames.join(", "))}</strong></p>}
              {countLines(offer.sure, t).map(line => <p key={line}>{line}</p>)}
            </div>
            {offer.demoKept.length > 0 && <p>{t.importDemoKept.replace("{names}", offer.demoKept.join(", "))}</p>}
            {otherAccount && <p role="note">{t.importOtherAccount}</p>}

            {needsUncertain && (
              <fieldset className="import-question" data-testid="import-uncertain">
                <legend>{t.importUncertainTitle}</legend>
                <p>{t.importUncertainBody.replace("{items}", uncertainItems)}</p>
                <div className="stage-choices two">
                  <button type="button" className={uncertain === true ? "active" : ""} aria-pressed={uncertain === true} onClick={() => setUncertain(true)}>{t.importUncertainYes}</button>
                  <button type="button" className={uncertain === false ? "active" : ""} aria-pressed={uncertain === false} onClick={() => setUncertain(false)}>{t.importUncertainNo}</button>
                </div>
              </fieldset>
            )}
            {offer.duplicates.map(d => (
              <fieldset className="import-question" key={d.localId} data-testid="import-duplicate">
                <legend>{t.importSameTitle.replace("{name}", d.name)}</legend>
                <p>{t.importSameBody.replace("{name}", d.name).replace("{dob}", d.dob ? fmtLong(d.dob, lang) : "—")}</p>
                <div className="stage-choices two">
                  <button type="button" className={same[d.localId] === true ? "active" : ""} aria-pressed={same[d.localId] === true} onClick={() => setSame(s => ({ ...s, [d.localId]: true }))}>{t.importSameYes}</button>
                  <button type="button" className={same[d.localId] === false ? "active" : ""} aria-pressed={same[d.localId] === false} onClick={() => setSame(s => ({ ...s, [d.localId]: false }))}>{t.importSameNo}</button>
                </div>
              </fieldset>
            ))}
            <p>{t.importKeptCopy}</p>
            <div className="sheet-buttons even">
              <button onClick={() => void later()} disabled={phase === "saving"}>{t.importNotNow}</button>
              <button onClick={() => void add()} disabled={!answered || phase === "saving"}>{t.importAdd}</button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
