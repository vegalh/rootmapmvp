import type { Collection } from "../data/collections";
import { collectionActivities, localizeCollection } from "../lib/collections";
import type { Copy } from "../lib/i18n";

// A RootMap collection (Discover › Collections, a vertical list; My Week › Saved, a row): one of its pictures, its
// title, subtitle and how many activities it holds. Opens the collection's page.
// `image` comes from collectionImages over the whole list shown, so neighbouring cards have different pictures.
export default function CollectionCard({ collection, image, open, t }: { collection: Collection; image?: string; open: (id: string) => void; t: Copy }) {
  const list = collectionActivities(collection);
  const { title, subtitle } = localizeCollection(collection, t);
  return (
    <button className="collection-card" onClick={() => open(collection.id)}>
      <span className="collection-card-image">{image && <img src={image} alt="" />}</span>
      <span className="collection-card-text">
        <strong>{title}</strong>
        <small>{subtitle}</small>
        <em>{list.length} {t.activitiesCount}</em>
      </span>
    </button>
  );
}
