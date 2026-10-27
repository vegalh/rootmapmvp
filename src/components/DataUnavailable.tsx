import { TreeLogo } from "./TreeLogo";
import { copy } from "../lib/i18n";
import type { Lang } from "../types";

// Shown only when this device's RootMap data exists but the browser won't open it (see lib/data/store.ts).
// The app deliberately doesn't fall back to an older copy, which would look like recent memories were lost.
export function DataUnavailable() {
  let lang: Lang = navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
  try {
    const stored = localStorage.getItem("rootmap-language");
    if (stored === '"zh"' || stored === '"en"') lang = JSON.parse(stored);
  } catch {
    // keep the browser language
  }
  const t = copy[lang];
  return (
    <div className="app-shell">
      <main className="simple-page">
        <div className="info-card">
          <TreeLogo />
          <p role="alert">{t.dataUnavailable}</p>
          <button className="wide-primary" onClick={() => window.location.reload()}>{t.tryAgain}</button>
        </div>
      </main>
    </div>
  );
}

export default DataUnavailable;
