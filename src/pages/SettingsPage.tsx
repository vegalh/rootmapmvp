import { Icon } from "../components/Icon";
import { PageHeader, NotificationToggle } from "../components/ui";
import type { Lang, Screen } from "../types";
import type { Copy } from "../lib/i18n";

export function SettingsPage({ screen, back, lang, setLang, appearance, setAppearance, t }: {
  screen: Screen;
  back: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  appearance: string;
  setAppearance: (v: string) => void;
  t: Copy;
}) {
  const title = screen === "language" ? t.language
    : screen === "appearance" ? t.appearance
    : screen === "notes" ? t.myNotes
    : screen === "notificationPrefs" ? t.notifications
    : screen === "personal" ? t.personal
    : screen === "privacy" ? t.privacy
    : t.help;

  if (screen === "notes") {
    return (
      <main className="simple-page">
        <PageHeader title={title} back={back} />
        <textarea
          className="notes-pad"
          defaultValue={localStorage.getItem("rootmap-personal-notes") || ""}
          onChange={e => localStorage.setItem("rootmap-personal-notes", e.target.value)}
          placeholder={t.notesPlaceholder}
        />
      </main>
    );
  }

  const options = screen === "language" ? [["en", "English"], ["zh", "简体中文"]] : [["light", t.light], ["dark", t.dark], ["system", t.system]];
  if (screen === "language" || screen === "appearance") {
    return (
      <main className="simple-page">
        <PageHeader title={title} back={back} />
        <div className="choice-list">
          {options.map(([v, l]) => (
            <button className={(screen === "language" ? lang : appearance) === v ? "active" : ""} onClick={() => (screen === "language" ? setLang(v as Lang) : setAppearance(v))} key={v}>
              <span>{l}</span>{(screen === "language" ? lang : appearance) === v && <Icon name="check" />}
            </button>
          ))}
        </div>
      </main>
    );
  }

  if (screen === "notificationPrefs") {
    return (
      <main className="simple-page">
        <PageHeader title={title} back={back} />
        <div className="choice-list">
          {[t.followUpReminders, t.weeklyPlanningReminders, t.classroomUpdates].map(x => <NotificationToggle label={x} key={x} />)}
        </div>
      </main>
    );
  }

  return (
    <main className="simple-page">
      <PageHeader title={title} back={back} />
      <div className="info-card">
        <Icon name={screen === "privacy" ? "shield" : screen === "help" ? "help" : "user"} size={28} />
        <h2>{title}</h2>
        <p>
          {screen === "privacy"
            ? t.privacyText
            : screen === "help"
            ? t.helpText
            : t.personalText}
        </p>
        <button className="wide-primary">{screen === "help" ? t.contactSupport : t.manageButton}</button>
      </div>
    </main>
  );
}
