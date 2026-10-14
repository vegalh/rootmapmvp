import { Icon } from "../components/Icon";
import BookCover from "../components/BookCover";
import { localizeBook } from "../lib/catalog";
import type { Copy } from "../lib/i18n";
import type { Book, Shelf } from "../types";

export default function BookDetailPage({ book, shelf, place, back, notify, t }: {
  book: Book;
  // Whether (and how) this book is saved; any saved book is on the Wishlist.
  shelf: Shelf | null;
  place: (bookId: string, shelf: Shelf | null) => void;
  back: () => void;
  notify: (message: string) => void;
  t: Copy;
}) {
  const b = localizeBook(book, t);
  const saved = shelf !== null;
  // One tap saves the book to the Wishlist; another removes it.
  const toggle = () => {
    place(book.id, saved ? null : "wishlist");
    notify(saved ? t.removedFromWishlist : t.addedToWishlist);
  };

  return (
    <main className="detail-page book-detail">
      <div className="detail-actions">
        <button onClick={back} aria-label={t.back}><Icon name="back" /></button>
      </div>
      <div className="book-detail-cover"><BookCover book={book} t={t} /></div>
      <div className="detail-content">
        <h1>{b.title}</h1>
        <p className="book-author">{b.author}</p>
        <p className="book-ages"><Icon name="users" size={15} />{t.recommendedAges}<b>·</b>{b.ages}</p>
        <p className="description">{b.description}</p>
        <h2>{t.whyWeRecommend}</h2>
        <p className="book-why">{b.whyWeRecommend}</p>
      </div>
      <div className="sticky-action">
        {saved
          ? <button className="secondary" aria-pressed="true" onClick={toggle} aria-label={t.removeFromWishlistLabel.replace("{title}", b.title)}><Icon name="heart" size={19} filled />{t.onWishlist}</button>
          : <button aria-pressed="false" onClick={toggle}><Icon name="heart" size={19} />{t.addToWishlist}</button>}
      </div>
    </main>
  );
}
