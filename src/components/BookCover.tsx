import { useState } from "react";
import { Icon } from "./Icon";
import { localizeBook } from "../lib/catalog";
import type { Copy } from "../lib/i18n";
import type { Book } from "../types";

// One of three soft placeholder tones, chosen from the id so a book always gets the same one.
const tone = (id: string) => [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 3;

// The cover of the edition in the current language (English or Chinese), inside the shared 3:4 frame; the image
// keeps its own proportions. Without that edition's cover (or if it can't load), a drawn placeholder shows the
// title in the same language, labelled as a placeholder. The other edition's cover is never used instead.
export default function BookCover({ book, t }: { book: Book; t: Copy }) {
  const { title, cover } = localizeBook(book, t);
  // The cover that failed to load, so a language switch to a working cover shows it again.
  const [failed, setFailed] = useState<string>();
  const image = cover && cover !== failed ? cover : undefined;
  return (
    <span className={`book-cover ${image ? "" : `placeholder tone-${tone(book.id)}`}`}>
      {image
        ? <img src={image} alt="" loading="lazy" decoding="async" onError={() => setFailed(image)} />
        : <><Icon name="book" size={22} /><strong>{title}</strong><em>{t.coverPlaceholder}</em></>}
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
