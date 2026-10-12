import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Lang } from "../types";
import { copy } from "../lib/i18n";

// React port of the approved opening animation. The visual and behavioural reference is the original export in
// design/opening-animation.html (a 390×844 canvas). Markup, inline styles, colours, fonts, timeline and easing
// are carried over unchanged; at 390×844 the layout below resolves to the original pixel positions. On other
// screen sizes the logo and sheet positions are derived from measurements instead of fixed pixels.
//
// Authentication is intentionally not implemented: every account action calls an optional handler and, until a
// real auth system passes one, only shows a short "not available yet" notice. Nothing typed is read or stored.

export type OpeningAuthAction = "create" | "login" | "wechat" | "apple" | "forgot";

type View = "welcome" | "signup" | "login";

const OUT = "cubic-bezier(.22,1,.36,1)";
const POP = "cubic-bezier(.34,1.56,.64,1)";

// Original canvas metrics.
const CANVAS_H = 844;
const LOGO_TOP = 196; // logo group top during the intro
const SETTLED_SCALE = 0.56; // logo scale once the sheet is up
const SETTLED_GAP_TOP = 30; // original gap between the top controls and the settled logo …
const SETTLED_GAP_BOTTOM = 88.24; // … and between the settled logo (346px × 0.56) and the sheet
const MIN_SETTLED_SCALE = 0.34; // below this the wordmark gets too small; the screen scrolls instead
const SHEET_H = 432;

const ROOT_DELAYS = { a: 0, b: 120, c: 60, d: 380, e: 460 };
const TRUNK_DELAYS = { ground: 0, trunk: 0, b1: 220, b2: 300, b3: 380 };
const LEAF_DELAYS = { a: 0, b: 90, c: 180, d: 270, e: 360 };

type Layout = { top0: number; s0: number; settledY: number; settledScale: number; sceneH: number };

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export default function OpeningExperience({ lang, setLang, startAt = "animation", onAuthAction }: {
  lang: Lang;
  // The app's own language setting (same preference the rest of RootMap uses).
  setLang: (lang: Lang) => void;
  // "final" opens directly on the Welcome sheet, like the original's "Final sign-in screen" option.
  startAt?: "animation" | "final";
  // Future hook for real authentication. Without it, actions only explain that accounts aren't available yet.
  onAuthAction?: (action: OpeningAuthAction) => void;
}) {
  const c = copy[lang];
  const reducedMotion = usePrefersReducedMotion();
  const [stage, setStage] = useState(0);
  const [instant, setInstant] = useState(true);
  const [view, setView] = useState<View>("welcome");
  const [notice, setNotice] = useState("");
  const [size, setSize] = useState({ w: 390, h: CANVAS_H });
  const [layout, setLayout] = useState<Layout>({ top0: LOGO_TOP, s0: 1, settledY: -66, settledScale: SETTLED_SCALE, sceneH: CANVAS_H });

  const timers = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const skipHadFocus = useRef(false);
  const focusSkipNext = useRef(false);
  const focusHeadingNext = useRef(false);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  // The original timeline, unchanged.
  const play = useCallback(() => {
    clear();
    setStage(0); setInstant(true); setView("welcome");
    at(60, () => setInstant(false));
    at(250, () => setStage(1));
    at(850, () => setStage(2));
    at(1250, () => setStage(3));
    at(1750, () => setStage(4));
    at(2700, () => setStage(5));
  }, []);

  const showFinal = useCallback(() => { clear(); setStage(5); setInstant(true); }, []);

  useEffect(() => {
    if (startAt === "final" || reducedMotion) showFinal();
    else play();
    return clear;
    // Only on mount: a later reduced-motion change is handled below without restarting a finished intro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reducedMotion) showFinal();
  }, [reducedMotion, showFinal]);

  const settled = stage >= 5;
  const compact = size.h < 760 || size.w < 360;

  // ---- Responsive layout --------------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onResize = () => setSize(s => (s.w === root.clientWidth && s.h === root.clientHeight ? s : { w: root.clientWidth, h: root.clientHeight }));
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const measure = useCallback(() => {
    const group = groupRef.current, word = wordRef.current, chrome = chromeRef.current, sheet = sheetRef.current;
    if (!group || !word || !chrome || !sheet) return;
    const H = size.h;
    const groupH = group.offsetHeight; // untransformed height (382 in the original)
    const visibleH = word.offsetTop + word.offsetHeight; // tree + wordmark; the tagline is hidden once settled
    const chromeBottom = chrome.offsetTop + chrome.offsetHeight;
    const sheetH = sheet.offsetHeight;

    // Intro: keep the original distance from the vertical centre (196px at 844px tall), always leaving room
    // for the "Tap to skip" line below.
    const s0 = Math.min(1, Math.max(0.4, (H - 160) / groupH));
    let top0 = LOGO_TOP + (H - CANVAS_H) / 2;
    top0 = Math.max(12, Math.min(top0, H - 120 - groupH * s0));

    // Settled: fit the logo between the top controls and the sheet, split like the original (30 above, 88 below).
    const free = H - sheetH - chromeBottom;
    let settledScale = Math.min(SETTLED_SCALE, (free - 28) / visibleH);
    let gapTop = (free - visibleH * settledScale) * (SETTLED_GAP_TOP / (SETTLED_GAP_TOP + SETTLED_GAP_BOTTOM));
    let sceneH = H;
    if (settledScale < MIN_SETTLED_SCALE) {
      // Very short screens: keep the wordmark readable and let the sheet sit below it (the screen scrolls).
      settledScale = MIN_SETTLED_SCALE;
      gapTop = 12;
      sceneH = Math.ceil(chromeBottom + gapTop + visibleH * settledScale + 16 + sheetH);
    }
    const settledTop = chromeBottom + gapTop;
    const next = { top0: Math.round(top0 * 10) / 10, s0, settledY: Math.round((settledTop - top0) * 10) / 10, settledScale: Math.round(settledScale * 1000) / 1000, sceneH };
    setLayout(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [size.h]);

  useLayoutEffect(() => { measure(); }, [measure, compact, view, lang]);

  useEffect(() => {
    const sheet = sheetRef.current, group = groupRef.current;
    if (!sheet || !group) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(sheet); ro.observe(group);
    document.fonts?.ready.then(() => measure());
    return () => ro.disconnect();
  }, [measure]);

  // ---- Focus (never trapped: nothing here intercepts Tab) ------------------------------------------------------
  useLayoutEffect(() => {
    if (settled && skipHadFocus.current) {
      skipHadFocus.current = false;
      headingRef.current?.focus({ preventScroll: true });
    }
    if (!settled && focusSkipNext.current) {
      focusSkipNext.current = false;
      skipRef.current?.focus({ preventScroll: true });
    }
  }, [settled]);

  useLayoutEffect(() => {
    if (focusHeadingNext.current) {
      focusHeadingNext.current = false;
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [view]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  const goTo = (next: View) => { focusHeadingNext.current = true; setNotice(""); setView(next); };
  const authAction = (action: OpeningAuthAction) => {
    if (onAuthAction) onAuthAction(action);
    else setNotice(c.openingAuthUnavailable);
  };
  const skip = () => { clear(); setStage(5); setInstant(false); };
  const replay = () => { focusSkipNext.current = true; setNotice(""); play(); };

  // ---- Render values (renderVals() in the original) ------------------------------------------------------------
  const st = stage;
  const inst = instant;
  const tr = (list: [string, number, number?, string?][]) => (inst ? "none" : list.map(([p, d, del, e]) => `${p} ${d}ms ${e || OUT} ${del || 0}ms`).join(", "));
  const r: Record<string, number> = {}, rt: Record<string, string> = {};
  (Object.keys(ROOT_DELAYS) as (keyof typeof ROOT_DELAYS)[]).forEach(k => { r[k] = st >= 1 ? 0 : 40; rt[k] = tr([["stroke-dashoffset", 800, ROOT_DELAYS[k]]]); });
  const tk: Record<string, number> = {}, tt: Record<string, string> = {};
  (Object.keys(TRUNK_DELAYS) as (keyof typeof TRUNK_DELAYS)[]).forEach(k => {
    const on = k === "ground" ? st >= 1 : st >= 2;
    tk[k] = on ? 0 : 40;
    tt[k] = tr([["stroke-dashoffset", k === "ground" ? 500 : 520, TRUNK_DELAYS[k]]]);
  });
  const lf: Record<string, number> = {}, lt: Record<string, string> = {};
  (Object.keys(LEAF_DELAYS) as (keyof typeof LEAF_DELAYS)[]).forEach(k => { lf[k] = st >= 3 ? 1 : 0; lt[k] = tr([["transform", 460, LEAF_DELAYS[k], POP]]); });

  const isLogin = view === "login";
  const f = {
    title: isLogin ? c.openingLoginTitle : c.openingSignupTitle,
    body: isLogin ? c.openingLoginBody : c.openingSignupBody,
    pw: isLogin ? c.openingPwLabel : c.openingPwNew,
    auto: isLogin ? "current-password" : "new-password",
    cta: isLogin ? c.openingLogin : c.openingContinue,
  };
  const zh = lang === "zh";
  const headFont = zh ? "'Noto Sans SC', sans-serif" : "'Caveat', cursive";
  const headSize = compact ? (zh ? 23 : 32) : zh ? 26 : 38;
  const headWeight = zh ? 500 : 700;
  const groupTransform = settled ? `translateY(${layout.settledY}px) scale(${layout.settledScale})` : `translateY(0px) scale(${layout.s0})`;

  // Compact spacing for short or narrow phones; the regular values are the original's.
  const k = compact
    ? { pad: "24px 20px calc(22px + env(safe-area-inset-bottom))", gap: 10, bodySize: 15, bodyLh: 1.5, bodyMb: 6, primaryH: 48, socialH: 44, inputH: 46, sheetHeight: "auto" }
    : { pad: "30px 24px calc(34px + env(safe-area-inset-bottom))", gap: 12, bodySize: 16, bodyLh: 1.55, bodyMb: 8, primaryH: 52, socialH: 46, inputH: 48, sheetHeight: `calc(${SHEET_H}px + env(safe-area-inset-bottom))` };
  const chromeTop = compact ? Math.max(16, Math.round((56 * size.h) / CANVAS_H)) : 56;

  const h1Style: CSSProperties = { margin: 0, fontFamily: headFont, fontSize: headSize, fontWeight: headWeight, lineHeight: 1.15, color: "#2f4d3d", outline: "none" };
  const primaryBtn: CSSProperties = { height: k.primaryH, border: 0, borderRadius: 15, background: "#4b7c63", color: "#ffffff", fontFamily: "inherit", fontSize: 16, fontWeight: 700, cursor: "pointer" };
  const inputStyle: CSSProperties = { height: k.inputH, boxSizing: "border-box", padding: "0 14px", border: "1px solid #e6d6c0", borderRadius: 13, background: "#ffffff", fontFamily: "inherit", fontSize: 16, color: "#3b2a1a" };
  const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 700, color: "#3b2a1a" };

  return (
    <div
      ref={rootRef}
      className="opening"
      lang={zh ? "zh-CN" : "en"}
      style={{ width: "100%", height: "100%", position: "relative", overflowX: "hidden", overflowY: settled && layout.sceneH > size.h ? "auto" : "hidden", background: "#fbf2e4", fontFamily: "'Nunito', 'Noto Sans SC', system-ui, sans-serif", color: "#3b2a1a", lineHeight: "normal" }}
    >
      <div style={{ position: "relative", width: "100%", height: settled ? Math.max(size.h, layout.sceneH) : size.h, overflow: "hidden" }}>

        <div ref={groupRef} style={{ position: "absolute", top: layout.top0, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", transform: groupTransform, transformOrigin: "50% 0", transition: tr([["transform", 760, 0]]) }}>
          <svg viewBox="0 0 46 70" width="184" height="280" aria-hidden="true" style={{ overflow: "visible" }}>
            <g style={{ opacity: settled ? 0.3 : 1, transition: tr([["opacity", 700, 0]]) }}>
              <path d="M23 40 C23 46 20 50 14 56" fill="none" stroke="#c7a684" strokeWidth="1.3" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: r.a, transition: rt.a }} />
              <path d="M23 40 C24 47 27 52 33 57" fill="none" stroke="#c7a684" strokeWidth="1.3" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: r.b, transition: rt.b }} />
              <path d="M23 40 C22 49 23.5 55 23 64" fill="none" stroke="#c7a684" strokeWidth="1.3" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: r.c, transition: rt.c }} />
              <path d="M21 49 C18 51 14 50.5 10 52" fill="none" stroke="#d6bc9f" strokeWidth="1" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: r.d, transition: rt.d }} />
              <path d="M25.5 50 C29 51.5 33 50.5 37 49" fill="none" stroke="#d6bc9f" strokeWidth="1" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: r.e, transition: rt.e }} />
            </g>
            <path d="M17 39h12" fill="none" stroke="#4b7c63" strokeWidth="2.6" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: tk.ground, transition: tt.ground }} />
            <circle cx="23" cy="39" r="1.8" fill="#d98b62" style={{ opacity: st >= 1 && st < 2 ? 1 : 0, transition: tr([["opacity", 300, 0]]) }} />
            <path d="M23 39V19" fill="none" stroke="#4b7c63" strokeWidth="2.6" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: tk.trunk, transition: tt.trunk }} />
            <path d="M23 26l-8-7" fill="none" stroke="#4b7c63" strokeWidth="2.6" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: tk.b1, transition: tt.b1 }} />
            <path d="M23 23l8-9" fill="none" stroke="#4b7c63" strokeWidth="2.6" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: tk.b2, transition: tt.b2 }} />
            <path d="M23 30l11-7" fill="none" stroke="#4b7c63" strokeWidth="2.6" strokeLinecap="round" style={{ strokeDasharray: 40, strokeDashoffset: tk.b3, transition: tt.b3 }} />
            <circle cx="23" cy="11" r="7" fill="#4b7c63" style={{ transform: `scale(${lf.a})`, transformOrigin: "23px 11px", transition: lt.a }} />
            <circle cx="13" cy="16" r="6" fill="#4b7c63" style={{ transform: `scale(${lf.b})`, transformOrigin: "13px 16px", transition: lt.b }} />
            <circle cx="33" cy="12" r="6" fill="#d98b62" style={{ transform: `scale(${lf.c})`, transformOrigin: "33px 12px", transition: lt.c }} />
            <circle cx="15" cy="25" r="5" fill="#d98b62" style={{ transform: `scale(${lf.d})`, transformOrigin: "15px 25px", transition: lt.d }} />
            <circle cx="36" cy="23" r="5.5" fill="#4b7c63" style={{ transform: `scale(${lf.e})`, transformOrigin: "36px 23px", transition: lt.e }} />
          </svg>
          <div ref={wordRef} style={{ marginTop: 6, fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 60, lineHeight: 1, color: "#2f4d3d", opacity: st >= 4 ? 1 : 0, transform: `translateY(${st >= 4 ? 0 : 12}px)`, transition: tr([["opacity", 520, 0], ["transform", 520, 0]]) }}>RootMap</div>
          <div aria-hidden={settled} style={{ marginTop: 12, fontSize: zh ? 17 : 18, fontWeight: 600, letterSpacing: "0.2px", color: "#76654f", opacity: st >= 4 && !settled ? 1 : 0, transform: `translateY(${st >= 4 ? 0 : 10}px)`, transition: tr([["opacity", 480, settled ? 0 : 160], ["transform", 480, 160]]) }}>{c.openingTagline}</div>
        </div>

        {!settled && (
          <button
            ref={skipRef}
            type="button"
            aria-label={c.openingSkipLabel}
            onClick={skip}
            onFocus={() => { skipHadFocus.current = true; }}
            onBlur={() => { skipHadFocus.current = false; }}
            style={{ position: "absolute", inset: 0, border: 0, background: "transparent", cursor: "pointer", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 calc(56px + env(safe-area-inset-bottom)) 0", fontFamily: "inherit" }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: "#76654f", opacity: st >= 1 && !settled ? 1 : 0, transition: "opacity 400ms ease 1200ms" }}>{c.openingSkip}</span>
          </button>
        )}

        <div
          ref={chromeRef}
          inert={!settled}
          style={{ position: "absolute", top: `max(${chromeTop}px, calc(env(safe-area-inset-top) + 8px))`, left: "calc(20px + env(safe-area-inset-left))", right: "calc(20px + env(safe-area-inset-right))", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: settled ? 1 : 0, pointerEvents: settled ? "auto" : "none", transition: tr([["opacity", 400, 450]]) }}
        >
          <button type="button" onClick={replay} aria-label={c.openingReplay} title={c.openingReplay} style={{ width: 44, height: 44, border: 0, borderRadius: "50%", background: "transparent", color: "#4b7c63", display: "grid", placeItems: "center", cursor: "pointer", padding: 0, visibility: view === "welcome" ? "visible" : "hidden" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
          </button>
          <div role="group" aria-label={c.openingLanguage} style={{ display: "flex", gap: 4, padding: 4, borderRadius: 999, background: "#f3e6d2" }}>
            <button type="button" lang="en" aria-pressed={!zh} onClick={() => setLang("en")} style={{ minWidth: 48, height: 36, border: 0, borderRadius: 999, fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", background: !zh ? "#4b7c63" : "transparent", color: !zh ? "#ffffff" : "#2f4d3d" }}>EN</button>
            <button type="button" lang="zh-CN" aria-pressed={zh} onClick={() => setLang("zh")} style={{ minWidth: 48, height: 36, border: 0, borderRadius: 999, fontFamily: "'Noto Sans SC', sans-serif", fontSize: 14, fontWeight: 500, cursor: "pointer", background: zh ? "#4b7c63" : "transparent", color: zh ? "#ffffff" : "#2f4d3d" }}>中文</button>
          </div>
        </div>

        <div
          ref={sheetRef}
          inert={!settled}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: k.sheetHeight, boxSizing: "border-box", padding: k.pad, background: "#fffcf6", borderRadius: "30px 30px 0 0", boxShadow: "0 -10px 34px rgba(59, 42, 26, 0.08)", transform: `translateY(${settled ? "0%" : "105%"})`, transition: tr([["transform", 720, 80]]), display: "flex", flexDirection: "column" }}
        >
          {notice && (
            <p role="status" style={{ position: "absolute", left: 16, right: 16, bottom: "calc(100% + 12px)", margin: "0 auto", width: "fit-content", maxWidth: "calc(100% - 32px)", padding: "10px 18px", borderRadius: 22, background: "#2f4d3d", color: "#ffffff", fontSize: 14, fontWeight: 600, lineHeight: 1.4, textAlign: "center", boxShadow: "0 8px 24px rgba(59, 42, 26, 0.18)" }}>{notice}</p>
          )}

          {view === "welcome" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: k.gap, flex: 1 }}>
              <h1 ref={headingRef} tabIndex={-1} style={h1Style}>{c.openingWelcomeTitle}</h1>
              <p style={{ margin: `0 0 ${k.bodyMb}px 0`, fontSize: k.bodySize, lineHeight: k.bodyLh, color: "#76654f" }}>{c.openingWelcomeBody}</p>
              <button type="button" onClick={() => goTo("signup")} style={primaryBtn}>{c.openingCreate}</button>
              <button type="button" onClick={() => goTo("login")} style={{ ...primaryBtn, border: "1.5px solid #4b7c63", background: "transparent", color: "#2f4d3d" }}>{c.openingHave}</button>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, color: "#76654f", fontSize: 13 }}>
                <span style={{ flex: 1, height: 1, background: "#eee1d0" }} />
                <span>{c.openingOr}</span>
                <span style={{ flex: 1, height: 1, background: "#eee1d0" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <button type="button" onClick={() => authAction("wechat")} style={{ height: k.socialH, border: "1px solid #e6d6c0", borderRadius: 13, background: "#ffffff", color: "#3b2a1a", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{c.openingWechat}</button>
                <button type="button" onClick={() => authAction("apple")} style={{ height: k.socialH, border: "1px solid #e6d6c0", borderRadius: 13, background: "#ffffff", color: "#3b2a1a", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{c.openingApple}</button>
              </div>
              <p style={{ margin: "auto 0 0 0", fontSize: 12, lineHeight: 1.5, color: "#76654f", textAlign: "center" }}>{c.openingTerms}</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: k.gap, flex: 1 }}>
              <button type="button" onClick={() => goTo("welcome")} style={{ alignSelf: "flex-start", height: 44, margin: "-12px 0 -4px -10px", padding: "0 10px", border: 0, background: "transparent", color: "#4b7c63", fontFamily: "inherit", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                <span>{c.openingBack}</span>
              </button>
              <h1 ref={headingRef} tabIndex={-1} style={h1Style}>{f.title}</h1>
              <p style={{ margin: "0 0 4px 0", fontSize: k.bodySize, lineHeight: 1.5, color: "#76654f" }}>{f.body}</p>
              {/* Uncontrolled and never read: nothing typed here is kept, sent or stored. */}
              <label style={labelStyle}>
                <span>{c.openingIdLabel}</span>
                <input type="text" autoComplete="username" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                <span>{f.pw}</span>
                <input type="password" autoComplete={f.auto} style={inputStyle} />
              </label>
              <button type="button" onClick={() => authAction(isLogin ? "login" : "create")} style={{ ...primaryBtn, marginTop: "auto" }}>{f.cta}</button>
              {isLogin && (
                <button type="button" className="opening-link" onClick={() => authAction("forgot")} style={{ alignSelf: "center", fontSize: 14, fontWeight: 700, textDecoration: "none", padding: 6, border: 0, background: "transparent", fontFamily: "inherit", cursor: "pointer" }}>{c.openingForgot}</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
