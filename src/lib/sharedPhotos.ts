import { familyOfId } from "./childAccess";
import { outboxKey, unscope } from "./data/schema";
import { copyPhotoForFamily, photoMeta, syncRecordFor } from "./data/store";

// Photos of a new Moment about several children (Shared Child Profiles Phase 3). A photo belongs to one family (the
// server keeps it there), so a Moment about children of two families gets, for each other family, its own copy of each
// photo, made on this device (store.ts copyPhotoForFamily) and uploaded into that family. The first family a new photo
// is for keeps it; a photo already in a family stays there; the original is never changed. Returns each child's photo
// ids, or null when a copy couldn't be made (then nothing should be saved).
export async function photosForChildren(childIds: string[], photos: string[]): Promise<Record<string, string[]> | null> {
  const keeper = new Map<string, string | null>();
  for (const p of photos) {
    const family = (photoMeta(p) as { familyId?: string } | undefined)?.familyId;
    if (family) keeper.set(p, family);
    else if (syncRecordFor(outboxKey("photos", p))) keeper.set(p, null); // already the user's own, on the server
  }
  const copies = new Map<string, string>();
  const out: Record<string, string[]> = {};
  for (const childId of childIds) {
    const family = familyOfId(childId);
    const list: string[] = [];
    for (const p of photos) {
      if (!keeper.has(p)) keeper.set(p, family);
      if (keeper.get(p) === family) { list.push(p); continue; }
      const key = `${family ?? ""}|${p}`;
      if (!copies.has(key)) {
        const copy = await copyPhotoForFamily(p, family, unscope(childId)?.id ?? childId);
        if (!copy) return null;
        copies.set(key, copy);
      }
      list.push(copies.get(key)!);
    }
    out[childId] = list;
  }
  return out;
}
