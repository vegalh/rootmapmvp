import { Icon } from "../components/Icon";
import { PageHeader } from "../components/ui";
import type { Collection } from "../data/collections";
import { suitableFirst } from "../lib/catalog";
import { collectionActivities, localizeCollection } from "../lib/collections";
import type { Copy } from "../lib/i18n";
import type { Child } from "../types";
import { ActivityCard } from "./DiscoverPage";

// One of RootMap's collections (src/data/collections.ts): its activities as Discover cards, with the hearts working,
// and a toggle that saves the collection itself (My Week › Saved › My collections).
export default function CollectionPage({ collection, saved, toggleSaved, isCollectionSaved, toggleCollectionSaved, open, childrenData, back, t }: {
  collection: Collection;
  saved: string[];
  toggleSaved: (id: string) => void;
  isCollectionSaved: boolean;
  toggleCollectionSaved: () => void;
  open: (id: string) => void;
  // Activities that suit one of the children come first, as on Discover.
  childrenData: Child[];
  back: () => void;
  t: Copy;
}) {
  const { title, subtitle } = localizeCollection(collection, t);
  const list = suitableFirst(collectionActivities(collection), childrenData);
  return (
    <main className="page-content collection-page">
      <PageHeader title={title} subtitle={subtitle} back={back} />
      <div className="collection-meta">
        <span>{list.length} {t.activitiesCount}</span>
        <button className={`collection-save ${isCollectionSaved ? "saved" : ""}`} onClick={toggleCollectionSaved} aria-pressed={isCollectionSaved}>
          <Icon name="heart" size={16} filled={isCollectionSaved} />{isCollectionSaved ? t.collectionSaved : t.saveCollection}
        </button>
      </div>
      <div className="activity-grid">
        {list.map(a => <ActivityCard activity={a} saved={saved.includes(a.id)} toggleSaved={toggleSaved} open={open} t={t} key={a.id} />)}
      </div>
    </main>
  );
}
