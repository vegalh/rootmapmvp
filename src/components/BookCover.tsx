import { Icon } from "./Icon";
import { localizeBook } from "../lib/catalog";
import type { Copy } from "../lib/i18n";
import type { Book } from "../types";

// One of three soft placeholder tones, chosen from the id so a book always gets the same one.
const tone = (id: string) => [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 3;

// A book cover at the shared 3:4 proportion. Books without an image get a quiet drawn cover with their title.
export default function BookCover({ book, t }: { book: Book; t: Copy }) {
  const { title } = localizeBook(book, t);
  return (
    <span className={`book-cover ${book.cover ? "" : `placeholder tone-${tone(book.id)}`}`}>
      {book.cover ? <img src={book.cover} alt="" /> : <><Icon name="book" size={22} /><strong>{title}</strong></>}
      {book.sample && <em>{t.sampleLabel}</em>}
    </span>
  );
}

// Cover with the title and author beneath, as shown in the Books grid and on the Family Bookshelf.
export function BookTile({ book, open, t }: { book: Book; open: (id: string) => void; t: Copy }) {
  const b = localizeBook(book, t);
  return (
    <button className="book-tile" onClick={() => open(book.id)}>
      <BookCover book={book} t={t} />
      <strong>{b.title}</strong>
      <small>{b.author}</small>
    </button>
  );
}
