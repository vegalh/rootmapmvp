import { useState } from "react";
import { Icon } from "./Icon";
import { Empty, FilterPill } from "./ui";
import { BookTile } from "./BookCover";
import { books } from "../data/books";
import { ageOptionsFor, bookAgeRanges, matchesAge, matchesQuery } from "../lib/catalog";
import { ageOptionLabel, type Copy } from "../lib/i18n";

// Discover > Books: the curated collection, searchable by title and author (English or Chinese) and by age.
export default function BooksBrowser({ openBook, t }: { openBook: (id: string) => void; t: Copy }) {
  const [q, setQ] = useState("");
  const [age, setAge] = useState("All Ages");
  const [ageOpen, setAgeOpen] = useState(false);
  const result = books.filter(b => matchesQuery(q, [b.title, b.titleZh, b.author, b.authorZh]) && matchesAge(bookAgeRanges(b), age));
  return (
    <>
      <label className="search discover-search"><Icon name="search" size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchBooks} /></label>
      <div className="filter-row">
        <FilterPill
          label={t.age} value={age} defaultValue="All Ages" onChange={setAge}
          options={ageOptionsFor(books.map(bookAgeRanges))} renderLabel={v => ageOptionLabel(v, t)}
          columns={1} isOpen={ageOpen} onOpenChange={setAgeOpen}
        />
      </div>
      {age !== "All Ages" && <button className="reset-link" onClick={() => setAge("All Ages")}>{t.reset}</button>}
      <div className="section-title"><h2>{t.booksSection}</h2><span>{result.length} {t.booksCount}</span></div>
      <div className="book-grid">
        {result.map(b => <BookTile book={b} open={openBook} t={t} key={b.id} />)}
      </div>
      {!result.length && <Empty text={t.noResults} />}
    </>
  );
}
