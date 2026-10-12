import { useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, NotificationToggle, Field } from "../components/ui";
import type { Lang, ProfileInfo, Screen } from "../types";
import type { Copy } from "../lib/i18n";
import { saveSetting } from "../lib/data/hooks";
import { readSetting } from "../lib/data/store";
import { addPhoto, photoUrl } from "../lib/photos";

export function SettingsPage({ screen, back, lang, setLang, appearance, setAppearance, profile, setProfile, t }: {
  screen: Screen;
  back: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  appearance: string;
  setAppearance: (v: string) => void;
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

  if (screen === "personal") {
    // Downscaled like child photos (it's shown as a small avatar) and stored on this device.
    const pickPhoto = (file: File | undefined) => {
      if (!file) return;
      addPhoto(file, 640, 0.85).then(setPhoto, (e: Error) => window.alert(e.message === "full" ? t.storageFull : e.message === "failed" ? t.storageFailed : t.photoUnsupported));
    };
    return (
      <main className="simple-page">
        <PageHeader title={title} back={back} />
        <div className="info-card">
          <img className="profile-edit-photo" src={photoUrl(photo)} alt="" />
          <p>{t.personalText}</p>
          <label className="wide-primary photo-upload-button">
            {t.uploadPhoto}
            <input type="file" accept="image/*" hidden onChange={e => pickPhoto(e.target.files?.[0])} />
          </label>
        </div>
        <div className="form-fields">
          <Field label={t.fullNameLabel}><input type="text" value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label={t.contactInfoLabel}><input type="text" value={contact} onChange={e => setContact(e.target.value)} placeholder={t.contactPlaceholder} /></Field>
        </div>
        <button className="wide-primary" onClick={() => setProfile({ name: name.trim() || profile.name, photo, contact: contact.trim() })}>{t.save}</button>
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
            ? t.privacyText
            : t.helpText}
        </p>
        <button className="wide-primary">{screen === "help" ? t.contactSupport : t.manageButton}</button>
      </div>
    </main>
  );
}
