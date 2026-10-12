// Minimal Chrome DevTools Protocol driver (no dependencies; Node 24 has WebSocket).
import { spawn } from "node:child_process";

export const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch(profileDir, port, size = "390,844") {
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", `--window-size=${size}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 150; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(t => t.type === "page");
      if (page) {
        const page_ = await Page.connect(page.webSocketDebuggerUrl);
        page_.proc = proc;
        return page_;
      }
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error("chrome did not start");
}

export class Page {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const p = new Page(ws);
    await p.send("Page.enable");
    await p.send("Runtime.enable");
    await p.send("Log.enable");
    await p.send("DOM.enable");
    return p;
  }
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Set();
    this.errors = []; this.warnings = []; this.dialogs = [];
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
        return;
      }
      for (const h of this.handlers) h(m);
      if (m.method === "Runtime.consoleAPICalled") {
        const text = m.params.args.map(a => a.value ?? a.description ?? "").join(" ");
        if (m.params.type === "error") this.errors.push(`console.error: ${text}`);
        if (m.params.type === "warning") this.warnings.push(text);
      }
      if (m.method === "Runtime.exceptionThrown") this.errors.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon\.ico/.test(m.params.entry.url || "")) this.errors.push(`log: ${m.params.entry.text} ${m.params.entry.url || ""}`);
      if (m.method === "Page.javascriptDialogOpening") {
        this.dialogs.push(m.params.message);
        this.send("Page.handleJavaScriptDialog", { accept: true, promptText: this.promptText ?? m.params.defaultPrompt });
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  waitEvent(method, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.handlers.delete(h); reject(new Error(`timeout waiting for ${method}`)); }, timeout);
      const h = m => { if (m.method === method) { clearTimeout(t); this.handlers.delete(h); resolve(m.params); } };
      this.handlers.add(h);
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n  in: ${expression.slice(0, 200)}`);
    return r.result.value;
  }
  async nav(url) {
    const loaded = this.waitEvent("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
  }
  async reload() {
    const loaded = this.waitEvent("Page.loadEventFired");
    await this.send("Page.reload", { ignoreCache: false });
    await loaded;
  }
  async waitFor(expression, timeout = 10000, label = expression) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { last = await this.eval(`Promise.resolve(${expression}).then(v => !!v)`); if (last) return last; } catch (e) { last = e.message; }
      await sleep(80);
    }
    throw new Error(`waitFor timed out: ${label} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
  }
  async setFiles(selector, files) {
    const { root } = await this.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no element ${selector}`);
    await this.send("DOM.setFileInputFiles", { files, nodeId });
  }
  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(data, "base64");
  }
  async close() {
    try { await this.send("Browser.close"); } catch { /* closing */ }
    await new Promise(r => { if (this.proc.exitCode !== null) r(); else this.proc.once("exit", r); });
  }
}

// In-page helpers, installed after each navigation.
export const HELPERS = `
window.__t = {
  async dbExists() { return (await indexedDB.databases()).some(d => d.name === "rootmap"); },
  async open() {
    if (!(await this.dbExists())) return null;
    return new Promise((res, rej) => { const r = indexedDB.open("rootmap"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  },
  async all(store) {
    const db = await this.open(); if (!db) return null;
    if (!db.objectStoreNames.contains(store)) { db.close(); return null; }
    return new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { db.close(); res(q.result); }; q.onerror = () => rej(q.error); });
  },
  // Every object store (read from the database itself, so new stores are included automatically).
  async dump() {
    const db = await this.open(); if (!db) return null;
    const names = [...db.objectStoreNames]; db.close();
    const out = {};
    for (const s of names) out[s] = await this.all(s);
    if (out.photoBlobs) out.photoBlobs = out.photoBlobs.map(b => ({ id: b.id, size: b.blob.size, type: b.blob.type }));
    return out;
  },
  async put(store, value) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); }); },
  async del(store, key) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).delete(key); tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); }); },
  async photoB64(id) {
    const db = await this.open();
    const blob = await new Promise((res, rej) => { const q = db.transaction("photoBlobs").objectStore("photoBlobs").get(id); q.onsuccess = () => { db.close(); res(q.result && q.result.blob); }; q.onerror = () => rej(q.error); });
    if (!blob) return null;
    return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(",")[1]); fr.readAsDataURL(blob); });
  },
  deleteDb() { return new Promise((res, rej) => { const r = indexedDB.deleteDatabase("rootmap"); r.onsuccess = () => res(true); r.onerror = () => rej(r.error); r.onblocked = () => res("blocked"); }); },
  ls() { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; },
  text() { return document.body.innerText; },
  click(text, selector = "button") {
    const el = [...document.querySelectorAll(selector)].find(e => e.textContent.trim() === text) || [...document.querySelectorAll(selector)].find(e => e.textContent.includes(text));
    if (!el) throw new Error("no element with text " + text);
    el.click(); return true;
  },
  clickSel(selector, i = 0) { const el = document.querySelectorAll(selector)[i]; if (!el) throw new Error("no " + selector); el.click(); return true; },
  type(selector, value) {
    const el = document.querySelector(selector); if (!el) throw new Error("no " + selector);
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    return true;
  },
  imagesLoaded(selector = "img") { return [...document.querySelectorAll(selector)].map(i => ({ src: i.getAttribute("src")?.slice(0, 30), ok: i.complete && i.naturalWidth > 0 })); },
};
true;
`;
