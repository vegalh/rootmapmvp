import { entryText } from "./entries";
import { weekHighlights } from "./memories";
import type { Child, Entry, Lang } from "../types";

// Weekly recap › Share: one tall picture of the week, in the app's colours: the dates, the children's first names, up
// to six Moments (a photo when there is one, and the first line of the words) and a small RootMap mark. Never an age,
// a birthday or a last name. The picture is made on this device; it leaves RootMap only if the parent shares it.

export const SHARE_MOMENTS = 6;

export type ShareMoment = { photo?: string; line: string };

// The Moments in the picture, in the order they happened: the fullest first if there are more than six.
export function shareMoments(week: Entry[], lang: Lang, canShowPhoto: (photo: string) => boolean): ShareMoment[] {
  return weekHighlights(week, canShowPhoto, SHARE_MOMENTS).flatMap(e => {
    const photo = e.photos.find(canShowPhoto);
    const line = (entryText(e, lang) || "").split("\n").map(s => s.trim()).find(Boolean) || e.title?.trim() || "";
    return photo || line ? [{ ...(photo ? { photo } : {}), line }] : [];
  });
}

// First names only, in family order.
export function shareNames(childIds: string[], childrenData: Child[], join: string): string {
  return childrenData.filter(c => childIds.includes(c.id)).map(c => c.first.trim()).filter(Boolean).join(join);
}

// ── Drawing ───────────────────────────────────────────────────────────────────────────────────────────────
const W = 1080;
const PAD = 72;
const CARD_PAD = 28;
const INNER = W - PAD * 2 - CARD_PAD * 2;
const PHOTO_H = Math.round(INNER * 0.68);
const COLORS = { bg: "#fbf2e4", card: "#fffcf6", border: "#eee1d0", primary: "#4b7c63", heading: "#2f4d3d", text: "#3b2a1a", muted: "#8a7863", orange: "#d98b62" };
const HEADING = "'Caveat', cursive";
const BODY = "'Nunito', system-ui, sans-serif";

// Only images that keep the canvas readable: photos stored on this device (blob:) or inline (data:).
const drawable = (url: string | undefined) => !!url && /^(blob|data):/.test(url);

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Up to `max` lines of `text` within `width`, the last one ending in "…" when cut short. Words are kept whole where
// there are spaces; Chinese wraps between characters.
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const tokens = /\s/.test(text) ? text.split(/(\s+)/) : [...text];
  const lines: string[] = [];
  let line = "";
  let i = 0;
  for (; i < tokens.length; i++) {
    const next = line + tokens[i];
    if (!line.trim() || ctx.measureText(next).width <= width) { line = next; continue; }
    lines.push(line.trim());
    if (lines.length === max) break;
    line = tokens[i].trimStart();
  }
  if (i < tokens.length) {
    let last = lines[max - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[max - 1] = `${last.trimEnd()}…`;
  } else if (line.trim()) lines.push(line.trim());
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// The image drawn to fill the box, cropped from its centre (object-fit: cover).
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale, sh = h / scale;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

// The tree of components/TreeLogo.tsx, `size` px wide, with "RootMap" beside it, centred on `cx`.
function drawMark(ctx: CanvasRenderingContext2D, cx: number, y: number, size: number) {
  ctx.font = `700 ${Math.round(size * 0.55)}px ${BODY}`;
  const label = "RootMap";
  const total = size + 12 + ctx.measureText(label).width;
  const x = cx - total / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 46, size / 46);
  ctx.strokeStyle = COLORS.primary;
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.stroke(new Path2D("M23 39V19M23 26l-8-7M23 23l8-9M23 30l11-7M17 39h12"));
  for (const [c, cy, r, fill] of [[13, 16, 6, COLORS.primary], [23, 11, 7, COLORS.primary], [33, 12, 6, COLORS.orange], [36, 23, 5.5, COLORS.primary], [15, 25, 5, COLORS.orange]] as const) {
    ctx.beginPath(); ctx.arc(c, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = COLORS.heading;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + size + 12, y + size / 2);
  ctx.textBaseline = "alphabetic";
}

// The picture as a PNG. `photoUrl` turns a photo id into the image to draw.
export async function drawWeekImage({ title, range, names, moments, photoUrl }: {
  title: string;
  range: string;
  names: string;
  moments: ShareMoment[];
  photoUrl: (photo: string) => string | undefined;
}): Promise<Blob> {
  try { await document.fonts?.ready; } catch { /* system fonts */ }
  const images = await Promise.all(moments.map(m => {
    const url = m.photo ? photoUrl(m.photo) : undefined;
    return drawable(url) ? loadImage(url!) : Promise.resolve(null);
  }));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const lineFont = `600 38px ${BODY}`;
  ctx.font = lineFont;
  const lines = moments.map(m => (m.line ? wrap(ctx, m.line, INNER, 2) : []));
  const cardHeight = (i: number) => CARD_PAD * 2 + (images[i] ? PHOTO_H : 0) + (images[i] && lines[i].length ? 22 : 0) + lines[i].length * 50;
  const header = PAD + 96 + 20 + 48 + (names ? 52 : 0) + 40;
  const footer = 40 + 64 + PAD;
  canvas.width = W;
  canvas.height = header + moments.reduce((h, _, i) => h + cardHeight(i) + 28, 0) + footer;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, canvas.height);
  let y = PAD + 80;
  ctx.fillStyle = COLORS.heading;
  ctx.font = `700 96px ${HEADING}`;
  ctx.fillText(title, PAD, y);
  y += 20 + 48;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 40px ${BODY}`;
  ctx.fillText(range, PAD, y);
  if (names) {
    y += 52;
    ctx.fillStyle = COLORS.primary;
    ctx.font = `800 40px ${BODY}`;
    ctx.fillText(wrap(ctx, names, W - PAD * 2, 1)[0], PAD, y);
  }
  y = header;

  moments.forEach((_, i) => {
    const h = cardHeight(i);
    roundRect(ctx, PAD, y, W - PAD * 2, h, 36);
    ctx.fillStyle = COLORS.card;
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    let top = y + CARD_PAD;
    const img = images[i];
    if (img) {
      ctx.save();
      roundRect(ctx, PAD + CARD_PAD, top, INNER, PHOTO_H, 24);
      ctx.clip();
      drawCover(ctx, img, PAD + CARD_PAD, top, INNER, PHOTO_H);
      ctx.restore();
      top += PHOTO_H + (lines[i].length ? 22 : 0);
    }
    ctx.fillStyle = COLORS.text;
    ctx.font = lineFont;
    lines[i].forEach((line, j) => ctx.fillText(line, PAD + CARD_PAD, top + 38 + j * 50));
    y += h + 28;
  });

  drawMark(ctx, W / 2, y + 40, 64);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("image"))), "image/png"));
}
