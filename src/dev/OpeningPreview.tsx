import OpeningExperience from "../components/OpeningExperience";
import type { Lang } from "../types";

// Development-only preview of the opening experience, opened with `?opening` (or `?opening=final` to start on the
// Welcome sheet). It is loaded lazily behind import.meta.env.DEV, so it never ships in the production bundle and
// never replaces the normal app: without the query parameter RootMap opens as usual.
export default function OpeningPreview({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  const startAt = new URLSearchParams(window.location.search).get("opening") === "final" ? "final" : "animation";
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", background: "#efe7d6" }}>
      <div style={{ width: "min(100%, 430px)", height: "100dvh" }}>
        <OpeningExperience lang={lang} setLang={setLang} startAt={startAt} />
      </div>
    </div>
  );
}
