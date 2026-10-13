import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../components/Icon";
import { Modal } from "../components/ui";
import BookCover from "../components/BookCover";
import { localizeBook } from "../lib/catalog";
import type { Copy } from "../lib/i18n";
import type { Book, Shelf } from "../types";

export default function BookDetailPage({ book, shelf, place, back, notify, t }: {
  book: Book;
  // Where this book is on the Family Bookshelf, or null.
  shelf: Shelf | null;
  place: (bookId: string, shelf: Shelf | null) => void;
  back: () => void;
  notify: (message: string) => void;
  t: Copy;
}) {
  const b = localizeBook(book, t);
  const [choosing, setChoosing] = useState(false);
  const choose = (next: Shelf | null) => {
    setChoosing(false);
    if (next === shelf) return;
    place(book.id, next);
    notify(next === null ? t.removedFromBookshelf
      : next === "owned" ? (shelf ? t.movedToMyBooks : t.addedToMyBooks)
        : (shelf ? t.movedToWishlist : t.addedToWishlist));
  };
  const options: [Shelf, string, string, string][] = [["owned", "book", t.myBooks, t.myBooksHint], ["wishlist", "heart", t.wishlist, t.wishlistHint]];
  // The sheet sits in the app frame like every other bottom sheet (on wide screens the frame is the phone mockup).
  const host = typeof document !== "undefined" ? document.querySelector(".app-shell") ?? document.body : null;

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
        {shelf
          ? <button className="secondary" onClick={() => setChoosing(true)}><Icon name="check" size={19} />{shelf === "owned" ? t.inMyBooks : t.onWishlist}</button>
          : <button onClick={() => setChoosing(true)}><Icon name="plus" size={19} />{t.addToBookshelf}</button>}
      </div>
      {choosing && host && createPortal(
        <Modal title={t.familyBookshelf} close={() => setChoosing(false)}>
          <div className="quick-actions shelf-choices">
            {options.map(([value, icon, label, hint]) => (
              <button className={shelf === value ? "active" : ""} aria-pressed={shelf === value} onClick={() => choose(value)} key={value}>
                <Icon name={icon} />
                <span><strong>{label}</strong><small>{hint}</small></span>
                {shelf === value && <Icon name="check" size={18} />}
              </button>
            ))}
          </div>
          {shelf && <button className="shelf-remove" onClick={() => choose(null)}><Icon name="trash" size={17} />{t.removeFromBookshelf}</button>}
        </Modal>,
        host,
      )}
    </main>
  );
}
