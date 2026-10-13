import { useCallback, useMemo } from "react";
import { useSetting } from "./data/hooks";
import type { Shelf, ShelfItem } from "../types";

// The Family Bookshelf: books the family owns ("My Books") and wants ("Wishlist"). It belongs to the family,
// not to a child, and is stored as one setting in the data layer (see lib/data/schema.ts, SETTING_SHAPES).
// A book is listed at most once: moving it between shelves changes its `shelf`, never adds a second item.
export const BOOKSHELF_KEY = "rootmap-bookshelf";

// Puts `bookId` on `shelf` (moving it if it's on the other one), or removes it when `shelf` is null. Pure.
// Anything malformed in the stored list (or a repeated id) is dropped rather than shown twice.
export function placeBook(items: ShelfItem[], bookId: string, shelf: Shelf | null, now = new Date().toISOString()): ShelfItem[] {
  const rest = validItems(items).filter(i => i.bookId !== bookId);
  return shelf ? [{ bookId, shelf, addedAt: now }, ...rest] : rest;
}

// The stored list without anything malformed, each book once (its first, i.e. newest, entry).
export function validItems(stored: unknown): ShelfItem[] {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  return stored.filter((i): i is ShelfItem => {
    if (!i || typeof i.bookId !== "string" || (i.shelf !== "owned" && i.shelf !== "wishlist") || typeof i.addedAt !== "string") return false;
    if (seen.has(i.bookId)) return false;
    seen.add(i.bookId);
    return true;
  });
}

export const shelfOf = (items: ShelfItem[], bookId: string): Shelf | null => items.find(i => i.bookId === bookId)?.shelf ?? null;

// Books on one shelf, most recently added or moved first.
export const booksOn = (items: ShelfItem[], shelf: Shelf) =>
  items.filter(i => i.shelf === shelf).sort((a, b) => b.addedAt.localeCompare(a.addedAt)).map(i => i.bookId);

export function useBookshelf() {
  const [stored, setStored] = useSetting<ShelfItem[]>(BOOKSHELF_KEY, []);
  const items = useMemo(() => validItems(stored), [stored]);
  const place = useCallback((bookId: string, shelf: Shelf | null) => setStored(current => placeBook(current, bookId, shelf)), [setStored]);
  return { items, place };
}
