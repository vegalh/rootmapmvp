import { Icon } from "../components/Icon";
import { PageHeader } from "../components/ui";
import { photoUrl } from "../lib/photos";
import type { Lang, ProfileInfo, Screen } from "../types";
import type { Copy } from "../lib/i18n";
import type { CloudState } from "../lib/cloud/session";

export function ProfilePage({ go, lang, appearance, profile, deletedCount, cloud, t }: { go: (s: Screen) => void; lang: Lang; appearance: string; profile: ProfileInfo; deletedCount: number; cloud: CloudState; t: Copy }) {
  // The RootMap account row exists only in builds with cloud features (never on the public website).
  const accountRow: [string, string, string, string?][] =
    cloud.status === "signed-in" ? [["account", "user", t.accountTitle, cloud.user.email ?? t.accountSignedIn]]
      : cloud.status === "signed-out" ? [["signIn", "user", t.accountSignIn]]
        : [];
  const groups: [string, [string, string, string, string?][]][] = [
    [t.myActivities, [["week", "calendar", t.myWeek], ["saved", "heart", t.savedActivities], ["goals", "target", t.myGoals]]],
    [t.preferences, [["language", "globe", t.language, lang === "en" ? "English" : "简体中文"], ["appearance", "moon", t.appearance, appearance === "dark" ? t.dark : appearance === "system" ? t.system : t.light], ["notificationPrefs", "bell", t.notifications]]],
    [t.account, [...accountRow, ["personal", "user", t.personal], ["deletedChildren", "clock", t.recentlyDeleted, deletedCount ? String(deletedCount) : undefined], ["privacy", "shield", t.privacy], ["help", "help", t.help]]],
  ];
  return (
    <main className="page-content profile-page">
      <PageHeader title={t.profile} subtitle={t.profileSubtitle} />
      <section className="user-summary">
        <img src={photoUrl(profile.photo)} alt="" />
        <div><h2>{profile.name}</h2><p>{t.teacherRole}</p></div>
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
