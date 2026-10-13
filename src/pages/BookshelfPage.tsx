import { Icon } from "../components/Icon";
import { PageHeader } from "../components/ui";
import { BookTile } from "../components/BookCover";
import { books } from "../data/books";
import { booksOn } from "../lib/bookshelf";
import type { Copy } from "../lib/i18n";
import type { Book, Shelf, ShelfItem } from "../types";

// The Family Bookshelf (Profile): one bookshelf for the whole family, split into My Books and Wishlist.
export default function BookshelfPage({ items, tab, setTab, openBook, explore, back, t }: {
  items: ShelfItem[];
  tab: Shelf;
  setTab: (tab: Shelf) => void;
  openBook: (id: string) => void;
  explore: () => void;
  back: () => void;
  t: Copy;
}) {
  // A book removed from the collection simply isn't shown.
  const shown = booksOn(items, tab).map(id => books.find(b => b.id === id)).filter((b): b is Book => !!b);
  return (
    <main className="simple-page bookshelf-page">
      <PageHeader title={t.familyBookshelf} subtitle={t.familyBookshelfSubtitle} back={back} />
      <div className="segmented two">
        {([["owned", t.myBooks], ["wishlist", t.wishlist]] as const).map(([x, l]) => (
          <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{l}</button>
        ))}
      </div>
      {shown.length ? (
        <div className="book-grid">{shown.map(b => <BookTile book={b} open={openBook} t={t} key={b.id} />)}</div>
      ) : (
        <div className="empty shelf-empty">
          <Icon name={tab === "owned" ? "book" : "heart"} size={25} />
          <p>{tab === "owned" ? t.emptyMyBooks : t.emptyWishlist}</p>
          <button className="small-primary" onClick={explore}>{t.exploreBooks}</button>
        </div>
      )}
    </main>
  );
}
