import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { Child, Screen } from "../types";
import { childInitialsSrc, childPhotoSrc } from "../lib/children";
import { copy, type Copy } from "../lib/i18n";
import { haptic, prefersReducedMotion, revealFocusedField } from "../lib/native";

// The current language's strings, for shared controls' accessible names (Back, Close). Provided by App.
export const CopyContext = createContext<Copy>(copy.en);

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: () => void; action?: React.ReactNode }) {
  const t = useContext(CopyContext);
  return (
    <header className={`page-header ${back ? "with-back" : ""}`}>
      <div>
        {/* The back button sits beside the title (not the subtitle), however long the subtitle is. */}
        <div className="page-title-row">
          {back && <button className="icon-button" onClick={back} aria-label={t.back}><Icon name="back" /></button>}
          <h1>{title}</h1>
        </div>
        {subtitle && <p>{subtitle}</p>}
      </div>
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
      <button className="nav-add" onClick={() => { haptic("light"); openQuick(); }} aria-label={t.quickAdd}><i><Icon name="plus" size={25} /></i></button>
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
      {/* Fades whatever scrolls up behind the bar instead of letting it look cut off by the raised Quick Add
          circle (see .tab-fade in index.css); purely visual, so it never blocks a tap. */}
      {nav && <div className="tab-fade" aria-hidden="true" />}
      {nav && <BottomNav active={active} go={go} openQuick={openQuick} t={t} />}
    </div>
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

// How long a sheet or dialog takes to slide or fade away (matches --dur-exit in index.css).
export const EXIT_MS = 200;

// Sheets opened through ModalOverlay are kept on screen by App while they slide away, whoever closes them (a Save
// button too); `closing` is then true. Any other sheet animates its own dismissal.
export const SheetContext = createContext<{ closing: boolean } | null>(null);

// While any sheet or dialog is open the page behind it doesn't scroll along under the finger.
let scrollLocks = 0;
function useScrollLock() {
  useEffect(() => {
    scrollLocks += 1;
    document.documentElement.classList.add("sheet-open");
    return () => {
      scrollLocks -= 1;
      if (!scrollLocks) document.documentElement.classList.remove("sheet-open");
    };
  }, []);
}

// A bottom sheet. It can be dismissed with ×, Escape, a tap outside it, or by pulling it down (from its top, or
// anywhere once its content is scrolled to the top), as on iOS.
export function Modal({ title, close, children: content }: { title: string; close: () => void; children: React.ReactNode }) {
  const t = useContext(CopyContext);
  const managed = useContext(SheetContext);
  const [leaving, setLeaving] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  const latestClose = useLatest(close);
  const dismiss = useLatest(() => {
    if (managed || prefersReducedMotion()) { latestClose.current(); return; }
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => latestClose.current(), EXIT_MS);
  });
  const closing = leaving || !!managed?.closing;
  useScrollLock();

  // Escape closes the sheet, like tapping outside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismiss]);

  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const stopRevealing = revealFocusedField(el);
    // Pull down to dismiss. Only a downward pull that starts with the content at its top moves the sheet; scrolling
    // the content and touching a field work as before.
    let startY = 0, lastY = 0, lastT = 0, speed = 0, tracking = false, dragging = false;
    const onStart = (e: TouchEvent) => {
      tracking = e.touches.length === 1 && el.scrollTop <= 0 && !(e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
      dragging = false;
      startY = lastY = e.touches[0]?.clientY ?? 0;
      lastT = e.timeStamp;
      speed = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      if (!dragging) {
        if (dy < -4) { tracking = false; return; }
        if (dy < 8) return;
        dragging = true;
        el.style.transition = "none";
      }
      e.preventDefault();
      speed = (y - lastY) / Math.max(1, e.timeStamp - lastT);
      lastY = y;
      lastT = e.timeStamp;
      el.style.transform = `translateY(${Math.max(0, dy - 8)}px)`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!dragging) { tracking = false; return; }
      tracking = dragging = false;
      const moved = lastY - startY;
      // A finger that stopped before lifting isn't a flick.
      if (e.timeStamp - lastT > 100) speed = 0;
      if (moved > Math.min(140, el.offsetHeight * 0.3) || (speed > 0.5 && moved > 30)) {
        haptic("light");
        dismiss.current();
      } else {
        el.style.transition = "";
        el.style.transform = "";
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      stopRevealing();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [dismiss]);

  return (
    <div className={`overlay ${closing ? "closing" : ""}`} onMouseDown={e => { if (e.target === e.currentTarget) dismiss.current(); }}>
      <section ref={sheet} className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <i className="sheet-grabber" aria-hidden="true" />
        <header><h2>{title}</h2><button onClick={() => dismiss.current()} aria-label={t.close}><Icon name="close" size={18} /></button></header>
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
  useLayoutEffect(() => { ref.current = value; });
  return ref;
}

type OwnedRequest = ConfirmRequest & { owner: symbol; id: number };
const ConfirmContext = createContext<{ ask: (request: OwnedRequest) => void; dismiss: (owner: symbol) => void }>({ ask: () => {}, dismiss: () => {} });

// A question belongs to the screen or sheet that asked it: when that goes away (browser Back, or a sync removing
// the child it was about) the question closes unanswered instead of acting on a page that is no longer there.
let requestIds = 0;
export function useConfirm() {
  const { ask, dismiss } = useContext(ConfirmContext);
  const [owner] = useState(() => Symbol("confirm"));
  useEffect(() => () => dismiss(owner), [dismiss, owner]);
  return useCallback((request: ConfirmRequest) => ask({ ...request, owner, id: ++requestIds }), [ask, owner]);
}

export function ConfirmProvider({ children: content }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<OwnedRequest | null>(null);
  // An answered question fades out before it goes (a page going away closes its question at once).
  const [leaving, setLeaving] = useState<OwnedRequest | null>(null);
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setLeaving(null), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);
  // While one question is open, another can't replace it.
  const ask = useCallback((next: OwnedRequest) => setRequest(current => current ?? next), []);
  const dismiss = useCallback((owner: symbol) => {
    setRequest(current => (current?.owner === owner ? null : current));
    setLeaving(current => (current?.owner === owner ? null : current));
  }, []);
  const shown = request ?? leaving;
  const latestRequest = useLatest(request);
  const value = useMemo(() => ({ ask, dismiss }), [ask, dismiss]);
  return (
    <ConfirmContext.Provider value={value}>
      {content}
      {/* Closing clears only this question, never one asked after it. */}
      {shown && (
        <ConfirmDialog
          key={shown.id}
          request={shown}
          closing={!request}
          close={() => {
            // Already gone (its page closed it): nothing to fade out.
            if (latestRequest.current !== shown) return;
            if (!prefersReducedMotion()) setLeaving(shown);
            setRequest(null);
          }}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ request, closing, close }: { request: ConfirmRequest; closing: boolean; close: () => void }) {
  const t = useContext(CopyContext);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const id = useId();
  const cancel = () => { if (!running.current && !closing) close(); };
  useScrollLock();

  // Focus starts on the safe choice (Cancel for a destructive action) and returns to the opener afterwards.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>(request.destructive ? "[data-cancel]" : "[data-confirm]")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  // Escape cancels only this dialog (not a sheet underneath), and Tab stays inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (closing) return;
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
    if (request.destructive) haptic("medium");
    try { await request.onConfirm(); } finally { close(); }
  };

  return (
    <div className={`overlay confirm-overlay ${closing ? "closing" : ""}`} onMouseDown={e => { if (e.target === e.currentTarget) cancel(); }}>
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

// A child's avatar: their photo, or their initials when there is none or it can't be loaded (an unreadable file, or
// an old photo address that no longer works).
export function ChildPhoto({ child }: { child: Pick<Child, "id" | "first" | "last" | "photo"> }) {
  const src = childPhotoSrc(child);
  const [failed, setFailed] = useState("");
  return <img src={failed === src ? childInitialsSrc(child) : src} alt="" onError={() => setFailed(src)} />;
}

export function Empty({ text, children: action }: { text: string; children?: React.ReactNode }) {
  return <div className="empty"><Icon name="compass" size={25} /><p>{text}</p>{action}</div>;
}
