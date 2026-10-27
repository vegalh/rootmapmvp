import { useState, type FormEvent } from "react";
import { PageHeader } from "./ui";
import { Icon } from "./Icon";
import { isValidPassword, type AuthFailure } from "../lib/cloud/auth";
import { setAccountPassword } from "../lib/cloud/session";
import type { Copy } from "../lib/i18n";

// Creating or changing the signed-in parent's password (lib/cloud/auth.ts). "create" is required: App shows it in place
// of everything else while the signed-in account has no password, with no way past it but saving one. "change" is
// Account › Change password.
export default function PasswordForm({ mode, email, back, done, t }: {
  mode: "create" | "change";
  email: string | null;
  back?: () => void;
  done: () => void;
  t: Copy;
}) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const failureText = (f: AuthFailure) =>
    f === "weak-password" ? t.authWeakPassword : f === "reauth-needed" ? t.authReauth : f === "offline" ? t.authOffline : f === "rate-limited" ? t.authRateLimited : t.authUnavailable;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isValidPassword(password)) { setError(t.authWeakPassword); return; }
    if (password !== again) { setError(t.passwordMismatch); return; }
    setBusy(true); setError("");
    const result = await setAccountPassword(password);
    setBusy(false);
    if (result.ok) done();
    else setError(failureText(result.failure));
  };

  const title = mode === "create" ? t.passwordCreateTitle : t.passwordChangeTitle;
  return (
    <main className="simple-page password-page">
      <PageHeader title={title} back={back} />
      <form className="info-card password-form" onSubmit={submit} noValidate>
        <Icon name="shield" size={28} />
        {mode === "create" && email && <p>{t.passwordCreateBody.replace("{email}", email)}</p>}
        {/* Lets password managers save the new password for this account. */}
        <input type="email" name="username" autoComplete="username" value={email ?? ""} readOnly hidden />
        <label>
          <span>{t.passwordNew}</span>
          <input name="new-password" type="password" autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setError(""); }} aria-invalid={!!error} aria-describedby="password-hint" />
        </label>
        <label>
          <span>{t.passwordConfirm}</span>
          <input name="confirm-password" type="password" autoComplete="new-password" value={again} onChange={e => { setAgain(e.target.value); setError(""); }} aria-invalid={!!error} />
        </label>
        <small id="password-hint">{t.passwordHint}</small>
        {error && <p role="alert" className="password-error">{error}</p>}
        <button type="submit" className="wide-primary" disabled={busy}>{busy ? t.passwordSaving : t.passwordSave}</button>
      </form>
    </main>
  );
}
