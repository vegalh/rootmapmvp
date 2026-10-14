import { Icon } from "../components/Icon";
import { PageHeader } from "../components/ui";
import type { Copy } from "../lib/i18n";

// Notifications aren't available yet. The page says so plainly instead of showing sample messages; it's only reached
// through its address, since nothing in the app links here until reminders exist.
export function NotificationsPage({ back, t }: { back: () => void; t: Copy }) {
  return (
    <main className="simple-page notification-page">
      <PageHeader title={t.notificationsTitle} back={back} />
      <div className="info-card">
        <Icon name="bell" size={28} />
        <h2>{t.noNotificationsTitle}</h2>
        <p>{t.notificationsComingSoon}</p>
      </div>
    </main>
  );
}
