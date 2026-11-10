import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, Field } from "../components/ui";
import { cloudConfig } from "../lib/cloud/config";
import { setUsageSharing, usageSharingAvailable, useUsageSharing } from "../lib/analytics/tracker";
import type { Lang, ProfileInfo, Screen } from "../types";
import { routineLabel, type Copy } from "../lib/i18n";
import { saveSetting } from "../lib/data/hooks";
import { readSetting } from "../lib/data/store";
import { addPhoto, photoUrl } from "../lib/photos";
import { ROUTINES, type Routine } from "../lib/todayIdeas";
import { platform } from "../lib/platform";
import type { ReminderSetting } from "../lib/platform/reminders";

export function SettingsPage({ screen, go, back, lang, setLang, appearance, setAppearance, routines, setRoutines, reminder, setReminderOn, setReminderTime, profile, setProfile, notify, t }: {
  screen: Screen;
  go: (s: Screen) => void;
  // Shows a short message in the app's toast (e.g. a photo that couldn't be added).
  notify: (message: string) => void;
  back: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  appearance: string;
  setAppearance: (v: string) => void;
  routines: Routine[];
  setRoutines: (routines: Routine[]) => void;
  // The daily idea reminder (iOS app only, lib/platform/reminders.ts).
  reminder: ReminderSetting;
  setReminderOn: (on: boolean) => void;
  setReminderTime: (time: string) => void;
  profile: ProfileInfo;
  setProfile: (p: ProfileInfo) => void;
  t: Copy;
}) {
  const [name, setName] = useState(profile.name);
  const [photo, setPhoto] = useState(profile.photo);
  const [contact, setContact] = useState(profile.contact);
  const title = screen === "language" ? t.language
    : screen === "appearance" ? t.appearance
    : screen === "notes" ? t.myNotes
    : screen === "notificationPrefs" ? t.reminderTitle
    : screen === "routine" ? t.ourRoutine
    : screen === "personal" ? t.personal
    : screen === "privacy" ? t.privacy
    : t.help;

  if (screen === "notes") {
    return (
      <main className="simple-page">
        <PageHeader title={title} back={back} />
        <textarea
          className="notes-pad"
          defaultValue={readSetting("rootmap-personal-notes", "")}
          onChange={e => void saveSetting("rootmap-personal-notes", e.target.value)}
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

  // Our routine: any of the moments, or none (Today's Inspiration as before).
  if (screen === "routine") {
    return (
      <main className="simple-page">
        <PageHeader title={title} back={back} />
        <p className="settings-intro">{t.routineIntro}</p>
        <div className="choice-list" role="group" aria-label={t.ourRoutine}>
          {ROUTINES.map(r => {
            const on = routines.includes(r);
            return (
              <button className={on ? "active" : ""} aria-pressed={on} data-routine={r} onClick={() => setRoutines(on ? routines.filter(x => x !== r) : [...routines, r])} key={r}>
                <span>{routineLabel(r, t)}</span>{on && <Icon name="check" />}
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  if (screen === "notificationPrefs") {
    return (
      <main className="simple-page">
        <PageHeader title={title} back={back} />
        {/* One gentle reminder a day, off until the parent turns it on (permission is asked only then). The website
            can't send one, so it says where it can. */}
        {platform.reminders.available ? (
          <>
            <div className="usage-switch">
              <span>
                <strong id="reminder-label">{t.reminderTitle}</strong>
                <small>{t.reminderHint}</small>
              </span>
              <button role="switch" aria-checked={reminder.on} aria-labelledby="reminder-label" className={reminder.on ? "on" : ""} onClick={() => setReminderOn(!reminder.on)}>
                <i />
              </button>
            </div>
            {reminder.on && (
              <div className="form-fields">
                <Field label={t.reminderTime}><input type="time" value={reminder.time} onChange={e => e.target.value && setReminderTime(e.target.value)} /></Field>
              </div>
            )}
          </>
        ) : (
          <div className="info-card">
            <Icon name="bell" size={28} />
            <h2>{t.reminderTitle}</h2>
            <p>{t.reminderHint}</p>
            <p><strong>{t.reminderWebOnly}</strong></p>
          </div>
        )}
      </main>
    );
  }

  if (screen === "personal") {
    // Downscaled like child photos (it's shown as a small avatar) and stored on this device.
    const pickPhoto = (file: File | undefined) => {
      if (!file) return;
      addPhoto(file, 640, 0.85).then(setPhoto, (e: Error) => notify(e.message === "full" ? t.storageFull : e.message === "failed" ? t.storageFailed : t.photoUnsupported));
    };
    return (
      <main className="simple-page">
        <PageHeader title={title} back={back} />
        <div className="info-card">
          {photo ? <img className="profile-edit-photo" src={photoUrl(photo)} alt="" /> : <i className="profile-edit-photo profile-photo-empty"><Icon name="user" size={30} /></i>}
          <p>{t.personalText}</p>
          <label className="wide-primary photo-upload-button">
            {t.uploadPhoto}
            <input type="file" accept="image/*" hidden onChange={e => pickPhoto(e.target.files?.[0])} />
          </label>
        </div>
        <div className="form-fields">
          <Field label={t.fullNameLabel}><input type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field>
          <Field label={t.contactInfoLabel}><input type="text" value={contact} onChange={e => setContact(e.target.value)} placeholder={t.contactPlaceholder} /></Field>
        </div>
        <button className="wide-primary" onClick={() => { setProfile({ name: name.trim() || profile.name, photo, contact: contact.trim() }); back(); }}>{t.save}</button>
      </main>
    );
  }

  return (
    <main className="simple-page">
      <PageHeader title={title} back={back} />
      <div className="info-card">
        <Icon name={screen === "privacy" ? "shield" : "help"} size={28} />
        <h2>{title}</h2>
        <p>
          {screen === "privacy"
            ? (cloudConfig.enabled ? `${t.privacyText} ${t.privacyTextAccount}` : t.privacyText)
            : t.helpText}
        </p>
      </div>
      {screen === "privacy" && usageSharingAvailable() && <UsageSharingSwitch t={t} />}
      {screen === "privacy" && (
        <section className="menu-section">
          <div>
            <button onClick={() => go("backup")} aria-label={t.backupRestore}>
              <i><Icon name="layers" size={18} /></i><span>{t.backupRestore}</span><Icon name="chevron" size={16} />
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

// Usage analytics (lib/analytics), off by default. Turning it off deletes what hasn't been sent.
function UsageSharingSwitch({ t }: { t: Copy }) {
  const on = useUsageSharing();
  return (
    <div className="usage-switch">
      <span>
        <strong id="usage-sharing-label">{t.usageSharing}</strong>
        <small>{t.usageSharingHint}</small>
      </span>
      <button role="switch" aria-checked={on} aria-labelledby="usage-sharing-label" className={on ? "on" : ""} onClick={() => setUsageSharing(!on)}>
        <i />
      </button>
    </div>
  );
}
