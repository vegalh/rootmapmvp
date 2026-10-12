import { useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Modal, PageHeader } from "../components/ui";
import { exportBackup, parseBackup, summarize, type BackupError, type BackupFile } from "../lib/backup";
import { fmtLong } from "../lib/dates";
import type { Lang } from "../types";
import type { Copy } from "../lib/i18n";

// Far larger than a family's RootMap data; anything bigger is not a RootMap backup.
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const errorText = (error: BackupError, t: Copy) => ({
  notJson: t.backupErrNotJson,
  notBackup: t.backupErrNotBackup,
  newerVersion: t.backupErrNewerVersion,
  badVersion: t.backupErrBadVersion,
  corrupted: t.backupErrCorrupted,
  invalidData: t.backupErrInvalidData,
})[error];

// Restoring is three explicit steps: review the validated file, download a backup of the current data, then
// replace. Nothing is written until the last step, and the last step is all-or-nothing (see applyBackup).
type Restore = { backup: BackupFile; step: "review" } | { backup: BackupFile; step: "safetySaved"; file: string };

export function BackupPage({ snapshot, restore: applyRestore, lastBackup, setLastBackup, restored, back, lang, t }: {
  // The current data in backup form (lib/data/store.ts backupData).
  snapshot: () => Promise<Record<string, unknown>>;
  // Replaces all data with the backup, all or nothing.
  restore: (backup: BackupFile) => Promise<{ ok: true } | { ok: false; rolledBack: boolean }>;
  lastBackup: string;
  setLastBackup: (iso: string) => void;
  // Called after a successful restore; the app reloads so every screen reads the restored data.
  restored: () => void;
  back: () => void;
  lang: Lang;
  t: Copy;
}) {
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [restore, setRestore] = useState<Restore>();
  const input = useRef<HTMLInputElement>(null);
  const day = (iso: string) => fmtLong(iso.slice(0, 10), lang);

  const doExport = async () => {
    try {
      const { backup } = exportBackup(await snapshot(), "rootmap-backup");
      setLastBackup(backup.exportedAt);
      setMessage({ text: t.backupDownloaded });
    } catch {
      setMessage({ text: t.backupExportFailed, error: true });
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setMessage(undefined);
    let text: string;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("too large");
      text = await file.text();
    } catch {
      setMessage({ text: `${t.backupErrUnreadable} ${t.nothingChanged}`, error: true });
      return;
    }
    const result = parseBackup(text);
    if (!result.ok) { setMessage({ text: `${errorText(result.error, t)} ${t.nothingChanged}`, error: true }); return; }
    setRestore({ backup: result.backup, step: "review" });
  };

  // Step 2: the current data must be exported (and pass its own validation) before anything is replaced.
  const saveCurrent = async () => {
    if (!restore) return;
    let file: string;
    try {
      const { backup, fileName } = exportBackup(await snapshot(), "rootmap-before-restore");
      file = fileName;
      setLastBackup(backup.exportedAt);
    } catch {
      setRestore(undefined);
      setMessage({ text: t.safetyFailed, error: true });
      return;
    }
    setRestore({ backup: restore.backup, step: "safetySaved", file });
  };

  const replace = async () => {
    if (restore?.step !== "safetySaved") return;
    const result = await applyRestore(restore.backup);
    if (result.ok) { restored(); return; }
    setRestore(undefined);
    setMessage({ text: result.rolledBack ? t.restoreFailed : t.restoreFailedPartial, error: true });
  };

  const summary = restore && summarize(restore.backup);

  return (
    <main className="simple-page">
      <PageHeader title={t.backupRestore} back={back} />
      <div className="info-card backup-card">
        <Icon name="shield" size={28} />
        <p>{t.backupIntro}</p>
        <p className="backup-includes">{t.backupIncludes}</p>
        <p className="backup-last">{lastBackup ? t.lastBackup.replace("{date}", day(lastBackup)) : t.noBackupYet}</p>
        <button className="wide-primary" onClick={doExport}><Icon name="share" size={18} />{t.exportBackup}</button>
        <label className="wide-secondary">
          <Icon name="clock" size={18} />{t.importBackup}
          <input ref={input} type="file" accept="application/json,.json" hidden onChange={e => pickFile(e.target.files?.[0])} />
        </label>
        {message && <p className={`journal-status backup-message ${message.error ? "error" : ""}`} role={message.error ? "alert" : "status"}>{message.text}</p>}
      </div>

      {restore && summary && (
        <Modal title={t.restoreTitle} close={() => setRestore(undefined)}>
          <div className="restore-summary">
            <strong>{t.restoreFrom.replace("{date}", day(summary.exportedAt))}</strong>
            <span>{t.restoreCounts.replace("{children}", String(summary.children)).replace("{entries}", String(summary.entries)).replace("{photos}", String(summary.photos)).replace("{records}", String(summary.records)).replace("{goals}", String(summary.goals)).replace("{plans}", String(summary.plans))}</span>
          </div>
          <p className="restore-warning" role="alert">{t.restoreWarning}</p>
          {restore.step === "review"
            ? <p className="restore-step">{t.restoreSafetyStep}</p>
            : <p className="tried-done" role="status"><Icon name="check" size={18} />{t.safetyDownloaded.replace("{file}", restore.file)}</p>}
          <div className="sheet-buttons">
            <button onClick={() => setRestore(undefined)}>{t.cancel}</button>
            {restore.step === "review"
              ? <button onClick={saveCurrent}>{t.downloadSafetyBackup}</button>
              : <button onClick={replace}>{t.restoreNow}</button>}
          </div>
        </Modal>
      )}
    </main>
  );
}
