import { Icon } from "./Icon";
import { useStored } from "../lib/storage";
import type { Screen } from "../types";
import type { Copy } from "../lib/i18n";

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: () => void; action?: React.ReactNode }) {
  return (
    <header className={`page-header ${back ? "with-back" : ""}`}>
      {back && <button className="icon-button" onClick={back}><Icon name="back" /></button>}
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {action && <div className="header-action">{action}</div>}
    </header>
  );
}

export function BottomNav({ active, go, openQuick, t }: { active: Screen; go: (s: Screen) => void; openQuick: () => void; t: Copy }) {
  const items: [Screen, string, string][] = [
    ["children", "home", t.myChildren],
    ["discover", "compass", t.discover],
    ["observations", "note", t.momentsNav],
    ["profile", "user", t.profile],
  ];
  return (
    <nav className="bottom-nav">
      {items.slice(0, 2).map(([s, i, l]) => (
        <button className={active === s ? "active" : ""} onClick={() => go(s)} key={s}><Icon name={i} /><span>{l}</span></button>
      ))}
      <button className="nav-add" onClick={openQuick}><i><Icon name="plus" size={25} /></i></button>
      {items.slice(2).map(([s, i, l]) => (
        <button className={active === s ? "active" : ""} onClick={() => go(s)} key={s}><Icon name={i} /><span>{l}</span></button>
      ))}
    </nav>
  );
}

export function Shell({ children: content, active, go, openQuick, t, nav = true }: { children: React.ReactNode; active: Screen; go: (s: Screen) => void; openQuick: () => void; t: Copy; nav?: boolean }) {
  return (
    <div className={`screen ${nav ? "has-nav" : ""}`}>
      {content}
      {nav && <BottomNav active={active} go={go} openQuick={openQuick} t={t} />}
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options, renderLabel }: { label: string; value: string; onChange: (v: string) => void; options: string[]; renderLabel?: (option: string) => string }) {
  return (
    <label className="mini-select">
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option value={o} key={o}>{renderLabel ? renderLabel(o) : o}</option>)}</select>
    </label>
  );
}

export function Field({ label, children: content }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{content}</label>;
}

export function Modal({ title, close, children: content }: { title: string; close: () => void; children: React.ReactNode }) {
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section className="bottom-sheet">
        <i />
        <header><h2>{title}</h2><button onClick={close}>×</button></header>
        {content}
      </section>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty"><Icon name="compass" size={25} /><p>{text}</p></div>;
}

export function NotificationToggle({ label }: { label: string }) {
  const [on, setOn] = useStored<boolean>(`rootmap-pref-${label}`, true);
  return <button onClick={() => setOn(!on)}><span>{label}</span><i className={`switch ${on ? "on" : ""}`}><b /></i></button>;
}
