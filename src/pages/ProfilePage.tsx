import { Icon } from "../components/Icon";
import { PageHeader } from "../components/ui";
import type { Lang, Screen } from "../types";
import type { Copy } from "../lib/i18n";
import profilePhoto from "../assets/profile/haowei.jpg";

export function ProfilePage({ go, lang, appearance, t }: { go: (s: Screen) => void; lang: Lang; appearance: string; t: Copy }) {
  const groups: [string, [string, string, string, string?][]][] = [
    [t.myActivities, [["week", "calendar", t.myWeek], ["saved", "heart", t.savedActivities], ["notes", "note", t.myNotes]]],
    [t.preferences, [["language", "globe", t.language, lang === "en" ? "English" : "简体中文"], ["appearance", "moon", t.appearance, appearance === "dark" ? t.dark : appearance === "system" ? t.system : t.light], ["notificationPrefs", "bell", t.notifications]]],
    [t.account, [["personal", "user", t.personal], ["privacy", "shield", t.privacy], ["help", "help", t.help]]],
  ];
  return (
    <main className="page-content profile-page">
      <PageHeader title={t.profile} subtitle={t.profileSubtitle} />
      <section className="user-summary">
        <img src={profilePhoto} alt="" />
        <div><h2>{t.parentName}</h2><p>{t.teacherRole}</p></div>
      </section>
      {groups.map(([title, items]) => (
        <section className="menu-section" key={title}>
          <h3>{title}</h3>
          <div>
            {items.map(([screen, icon, label, value]) => (
              <button onClick={() => go(screen as Screen)} key={`${title}-${label}`}>
                <i><Icon name={icon} size={18} /></i><span>{label}</span>{value && <small>{value}</small>}<Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
