import { useState, type FormEvent, type ReactNode } from "react";
import { TreeLogo } from "./TreeLogo";
import { deviceLanguage } from "../lib/i18n";
import { enterInviteCode, hasEnteredInviteCode } from "../lib/inviteGate";
import { REQUEST_INVITE_URL } from "../config/inviteCodes";
import type { Lang } from "../types";

// The early-access screen shown before the app: one input, one button, and a link for people without a code.
// A soft gate only; lib/inviteGate.ts says what it does not protect. Its words live here, not in lib/i18n.ts,
// because this screen stands outside the app and goes away with early access.
const words = {
  en: {
    title: "RootMap is in early access",
    body: "Enter your invite code to open RootMap.",
    label: "Invite code",
    button: "Open RootMap",
    wrong: "That code didn't work. Check it and try again.",
    request: "Request an invite",
  },
  zh: {
    title: "RootMap 正在内测",
    body: "输入邀请码，打开 RootMap。",
    label: "邀请码",
    button: "打开 RootMap",
    wrong: "这个邀请码不对，请检查后再试一次。",
    request: "申请邀请",
  },
} satisfies Record<Lang, Record<string, string>>;

function gateLanguage(): Lang {
  try {
    const stored = localStorage.getItem("rootmap-language");
    if (stored === '"zh"' || stored === '"en"') return JSON.parse(stored);
  } catch {
    // keep the browser language
  }
  return deviceLanguage();
}

export function InviteGate({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(hasEnteredInviteCode);
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  if (entered) return <>{children}</>;

  const t = words[gateLanguage()];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (enterInviteCode(code)) setEntered(true);
    else setWrong(true);
  };
  return (
    <div className="app-shell">
      <main className="simple-page invite-gate">
        <form className="info-card" onSubmit={submit}>
          <TreeLogo />
          <h2>{t.title}</h2>
          <p>{t.body}</p>
          <label className="field">
            <input
              aria-label={t.label}
              value={code}
              onChange={event => { setCode(event.target.value); setWrong(false); }}
              placeholder={t.label}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={wrong}
              aria-describedby={wrong ? "invite-gate-error" : undefined}
              autoFocus
            />
          </label>
          {wrong && <p id="invite-gate-error" role="alert" className="invite-gate-error">{t.wrong}</p>}
          <button className="wide-primary" type="submit" disabled={!code.trim()}>{t.button}</button>
          <a className="invite-gate-request" href={REQUEST_INVITE_URL}>{t.request}</a>
        </form>
      </main>
    </div>
  );
}

export default InviteGate;
