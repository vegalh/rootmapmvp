import { useState } from "react";
import { Modal } from "./ui";
import type { Copy } from "../lib/i18n";
import { cloudConfig } from "../lib/cloud/config";

// The beta's label and notice (staging builds only; see `isBeta` in lib/cloud/config.ts). The notice opens
// once per browser tab; the label stays on every screen and opens it again.
const SEEN_KEY = "rootmap.beta-notice-seen";

function seenThisTab() {
  try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}

export default function BetaNotice({ t }: { t: Copy }) {
  const [open, setOpen] = useState(() => !seenThisTab());
  const close = () => {
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* shown again next time */ }
    setOpen(false);
  };
  return (
    <div className="beta-layer">
      <button type="button" className="beta-badge" onClick={() => setOpen(true)}>{t.betaLabel}</button>
      {open && (
        <Modal title={t.betaTitle} close={close}>
          <ul className="beta-points">
            {[...t.betaPoints, ...(cloudConfig.enabled ? t.betaCloudPoints : [t.betaLocalNote])].map(p => <li key={p}>{p}</li>)}
          </ul>
          <button type="button" className="wide-secondary" onClick={close}>{t.betaOk}</button>
        </Modal>
      )}
    </div>
  );
}
