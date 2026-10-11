import { useEffect, useLayoutEffect, useRef } from "react";
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

// Compact pill button that opens an accessible popover of options. Used by the Discover page filters.
export function FilterPill({ label, value, defaultValue, onChange, options, renderLabel, columns = 2, isOpen, onOpenChange, align = "left" }: {
  label: string;
  value: string;
  defaultValue: string;
  onChange: (v: string) => void;
  options: string[];
  renderLabel?: (option: string) => string;
  columns?: 1 | 2;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  align?: "left" | "right";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const display = (v: string) => (renderLabel ? renderLabel(v) : v);
  const active = value !== defaultValue;

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onOpenChange]);

  // Keep the popover fully on-screen: a middle pill's popover can otherwise be wide
  // enough to overflow the right (or left) edge of its bounds regardless of align.
  // Bound against the phone-mockup frame (.app-shell) when present, not the full
  // browser window, since the frame is narrower than the window on desktop sizes.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const reposition = () => {
      const pop = popRef.current;
      if (!pop) return;
      pop.style.transform = "";
      const rect = pop.getBoundingClientRect();
      const bounds = pop.closest(".app-shell")?.getBoundingClientRect();
      const margin = 16;
      const left = bounds ? bounds.left + margin : margin;
      const right = bounds ? bounds.right - margin : window.innerWidth - margin;
      let shift = 0;
      if (rect.right > right) shift = right - rect.right;
      if (rect.left + shift < left) shift = left - rect.left;
      if (shift) pop.style.transform = `translateX(${shift}px)`;
    };
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [isOpen]);

  return (
    <div className={`filter-pill-wrap filter-pill-align-${align}`} ref={wrapRef}>
      <button
        type="button"
        className={`filter-pill ${active ? "active" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => onOpenChange(!isOpen)}
      >
        <span>{label}: {display(value)}</span>
        <Icon name="down" size={15} />
      </button>
      {isOpen && (
        <div className="filter-popover" role="listbox" aria-label={label} ref={popRef}>
          <div className={`filter-popover-options cols-${columns}`}>
            {options.map(o => {
              const selected = o === value;
              return (
                <button
                  type="button"
                  key={o}
                  role="option"
                  aria-selected={selected}
                  className={`filter-popover-option ${selected ? "selected" : ""}`}
                  onClick={() => { onChange(o); onOpenChange(false); }}
                >
                  <span>{display(o)}</span>
                  {selected && <Icon name="check" size={15} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
