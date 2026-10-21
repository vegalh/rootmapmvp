import { collections, type Collection } from "../data/collections";
import type { Activity } from "../types";
import { catalogItems, type CatalogItem } from "./catalog";
import type { Copy } from "./i18n";

// RootMap's collections (src/data/collections.ts) over the one activity catalog (activities and music).

// A collection needs at least this many activities to be shown.
export const MIN_COLLECTION_SIZE = 3;

// The collection's activities, in catalog order.
export function collectionActivities(c: Collection): CatalogItem[] {
  return catalogItems().filter(c.match);
}

// Whether a collection is shown now: in season (`months`, in the local calendar) and with enough activities.
export function isCollectionShown(c: Collection, { date = new Date(), items = catalogItems() }: { date?: Date; items?: Activity[] } = {}): boolean {
  if (c.months && !c.months.includes(date.getMonth() + 1)) return false;
  return items.filter(c.match).length >= MIN_COLLECTION_SIZE;
}

// The collections shown now, in their usual order.
export function shownCollections(options: { date?: Date; items?: Activity[]; list?: Collection[] } = {}): Collection[] {
  return (options.list ?? collections).filter(c => isCollectionShown(c, options));
}

// The collection with this id, if it is shown now (a saved collection out of season or too small isn't).
export function findShownCollection(id: string | undefined, date = new Date()): Collection | undefined {
  const c = collections.find(x => x.id === id);
  return c && isCollectionShown(c, { date }) ? c : undefined;
}

export function localizeCollection(c: Collection, t: Copy) {
  const zh = t.code === "zh";
  return { title: zh ? c.zh.title : c.title, subtitle: zh ? c.zh.subtitle : c.subtitle };
}

// The picture for each collection's card, by collection id: its first activity photo (music covers are
// illustrations) that no earlier collection in the list shows, so cards one under another don't repeat a picture.
export function collectionImages(list: Collection[]): Map<string, string | undefined> {
  const used = new Set<string>();
  const out = new Map<string, string | undefined>();
  for (const c of list) {
    const items = collectionActivities(c);
    const photos = items.filter(a => a.type === "activity");
    const image = (photos.find(a => !used.has(a.image)) ?? photos[0] ?? items[0])?.image;
    if (image) used.add(image);
    out.set(c.id, image);
  }
  return out;
}
