import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useSetting } from "../lib/data/hooks";
import type { Screen } from "../types";
import { copy, type Copy } from "../lib/i18n";

// The current language's strings, for shared controls' accessible names (Back, Close). Provided by App.
export const CopyContext = createContext<Copy>(copy.en);

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: () => void; action?: React.ReactNode }) {
  const t = useContext(CopyContext);
  return (
    <header className={`page-header ${back ? "with-back" : ""}`}>
      {back && <button className="icon-button" onClick={back} aria-label={t.back}><Icon name="back" /></button>}
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {action && <div className="header-action">{action}</div>}
    </header>
  );
}

export function BottomNav({ active, go, openQuick, t }: { active: Screen; go: (s: Screen) => void; openQuick: () => void; t: Copy }) {
  const items: [Screen, string, string][] = [
    ["today", "sun", t.navToday],
    ["discover", "compass", t.navDiscover],
    ["children", "users", t.navKids],
    ["profile", "user", t.navProfile],
  ];
  return (
    <nav className="bottom-nav" aria-label={t.mainNavigation}>
      {items.slice(0, 2).map(([s, i, l]) => (
        <button className={active === s ? "active" : ""} aria-current={active === s ? "page" : undefined} onClick={() => go(s)} key={s}><Icon name={i} /><span>{l}</span></button>
      ))}
      <button className="nav-add" onClick={openQuick} aria-label={t.quickAdd}><i><Icon name="plus" size={25} /></i></button>
      {items.slice(2).map(([s, i, l]) => (
        <button className={active === s ? "active" : ""} aria-current={active === s ? "page" : undefined} onClick={() => go(s)} key={s}><Icon name={i} /><span>{l}</span></button>
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
  const t = useContext(CopyContext);
  // Escape closes the sheet, like tapping outside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <i />
        <header><h2>{title}</h2><button onClick={() => close()} aria-label={t.close}>×</button></header>
        {content}
      </section>
    </div>
  );
}

// A question before an action, centered in the app frame (the browser's own confirm() would open outside it).
// `onConfirm` runs while the dialog stays open and shows it's busy, so a second tap can't repeat the action; the
// dialog closes when it settles. Cancel, Escape and tapping outside do nothing else.
export type ConfirmRequest = {
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => unknown;
};

// The newest value of a prop, for a confirmed action: it runs after the parent decides, so it must act on the data
// as it is then (a sync may have arrived while the question was open), not as it was when the dialog opened.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

const ConfirmContext = createContext<(request: ConfirmRequest) => void>(() => {});
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children: content }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // While one question is open, another can't replace it.
  const ask = useCallback((next: ConfirmRequest) => setRequest(current => current ?? next), []);
  return (
    <ConfirmContext.Provider value={ask}>
      {content}
      {request && <ConfirmDialog request={request} close={() => setRequest(null)} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ request, close }: { request: ConfirmRequest; close: () => void }) {
  const t = useContext(CopyContext);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const id = useId();
  const cancel = () => { if (!running.current) close(); };

  // Focus starts on the safe choice (Cancel for a destructive action) and returns to the opener afterwards.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>(request.destructive ? "[data-cancel]" : "[data-confirm]")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  // Escape cancels only this dialog (not a sheet underneath), and Tab stays inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); cancel(); return; }
      if (e.key !== "Tab" || !dialog.current) return;
      const buttons = [...dialog.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (!buttons.length) { e.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!dialog.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const confirm = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await request.onConfirm(); } finally { close(); }
  };

  return (
    <div className="overlay confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) cancel(); }}>
      <section ref={dialog} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={request.body ? `${id}-body` : undefined} aria-busy={busy}>
        <h2 id={`${id}-title`}>{request.title}</h2>
        {request.body && <div id={`${id}-body`} className="confirm-body">{request.body}</div>}
        <div className="sheet-buttons even">
          <button data-cancel onClick={cancel} disabled={busy}>{t.cancel}</button>
          <button data-confirm className={request.destructive ? "destructive" : undefined} onClick={() => void confirm()} disabled={busy}>{request.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty"><Icon name="compass" size={25} /><p>{text}</p></div>;
}

export function NotificationToggle({ label }: { label: string }) {
  const [on, setOn] = useSetting<boolean>(`rootmap-pref-${label}`, true);
  return <button onClick={() => setOn(!on)}><span>{label}</span><i className={`switch ${on ? "on" : ""}`}><b /></i></button>;
}
