// The daily idea reminder (Profile › Daily idea reminder): one local notification a day at the parent's time, iOS app
// only. The website has none, and never loads the notification plugin.

export type ReminderTime = { hour: number; minute: number };
// Setting "rootmap-reminder" (device-only): off by default, at 17:30.
export const REMINDER_KEY = "rootmap-reminder";
export type ReminderSetting = { on: boolean; time: string };
export type ReminderText = { title: string; body: string };

export type Reminders = {
  available: boolean;
  // Asks for permission if it hasn't been given (only ever when the parent turns the reminder on), then sets the
  // reminder. "denied": notifications are off for RootMap in the phone's settings.
  enable(at: ReminderTime, text: ReminderText): Promise<"on" | "denied" | "failed">;
  // Sets the reminder again with a new time or words, never asking: nothing happens without permission.
  reschedule(at: ReminderTime, text: ReminderText): Promise<void>;
  disable(): Promise<void>;
  // Tapping the notification opens the app; `listener` then takes the parent to Today. Returns an unsubscribe.
  onOpen(listener: () => void): () => void;
};

// "17:30" → { hour: 17, minute: 30 }; the default time for anything else.
export const DEFAULT_REMINDER_TIME = "17:30";
export const REMINDER_OFF: ReminderSetting = { on: false, time: DEFAULT_REMINDER_TIME };
export function parseReminderTime(value: string | undefined): ReminderTime {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? "") ?? /^(\d\d):(\d\d)$/.exec(DEFAULT_REMINDER_TIME)!;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export const noReminders: Reminders = {
  available: false,
  enable: async () => "failed",
  reschedule: async () => {},
  disable: async () => {},
  onOpen: () => () => {},
};

// The one reminder's id: setting it again replaces it, so there is never a second one.
const REMINDER_ID = 1730;

// iOS: Capacitor Local Notifications, loaded only inside the app. The reminder repeats daily at that hour and minute
// (a calendar trigger), with no follow-up of any kind.
export function nativeReminders(): Reminders {
  const plugin = () => import("@capacitor/local-notifications").then(m => m.LocalNotifications);
  const schedule = async (at: ReminderTime, text: ReminderText) => {
    const notifications = await plugin();
    await notifications.cancel({ notifications: [{ id: REMINDER_ID }] });
    await notifications.schedule({ notifications: [{ id: REMINDER_ID, title: text.title, body: text.body, schedule: { on: at, allowWhileIdle: true } }] });
  };
  return {
    available: true,
    async enable(at, text) {
      try {
        const notifications = await plugin();
        let status = await notifications.checkPermissions();
        if (status.display !== "granted") status = await notifications.requestPermissions();
        if (status.display !== "granted") return "denied";
        await schedule(at, text);
        return "on";
      } catch {
        return "failed";
      }
    },
    async reschedule(at, text) {
      try {
        if ((await (await plugin()).checkPermissions()).display === "granted") await schedule(at, text);
      } catch { /* kept as it was */ }
    },
    async disable() {
      try { await (await plugin()).cancel({ notifications: [{ id: REMINDER_ID }] }); } catch { /* none set */ }
    },
    onOpen(listener) {
      let handle: { remove: () => Promise<void> } | undefined;
      let removed = false;
      void plugin().then(n => n.addListener("localNotificationActionPerformed", e => { if (e.notification.id === REMINDER_ID) listener(); })).then(h => {
        handle = h;
        if (removed) void h.remove();
      }).catch(() => { /* no plugin */ });
      return () => { removed = true; void handle?.remove(); };
    },
  };
}
