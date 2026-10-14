import { Icon } from "../components/Icon";
import { PageHeader } from "../components/ui";
import { BookTile } from "../components/BookCover";
import { books } from "../data/books";
import { savedBooks } from "../lib/bookshelf";
import type { Copy } from "../lib/i18n";
import type { Book, ShelfItem } from "../types";

// The family's book Wishlist (Profile): one list of the books saved from Discover › Books.
export default function BookshelfPage({ items, openBook, explore, back, t }: {
  items: ShelfItem[];
  openBook: (id: string) => void;
  explore: () => void;
  back: () => void;
  t: Copy;
}) {
  // A book removed from the collection simply isn't shown.
  const shown = savedBooks(items).map(id => books.find(b => b.id === id)).filter((b): b is Book => !!b);
  return (
    <main className="simple-page bookshelf-page">
      <PageHeader title={t.wishlist} subtitle={t.wishlistSubtitle} back={back} />
      {shown.length ? (
        <div className="book-grid">{shown.map(b => <BookTile book={b} open={openBook} t={t} key={b.id} />)}</div>
      ) : (
        <div className="empty shelf-empty">
          <Icon name="heart" size={25} />
          <p>{t.emptyWishlist}</p>
          <button className="small-primary" onClick={explore}>{t.exploreBooks}</button>
        </div>
      )}
    </main>
  );
}
