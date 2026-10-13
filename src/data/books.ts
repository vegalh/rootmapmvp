import type { Book } from "../types";

// The curated Discover > Books collection. Every book here is one RootMap recommends; there are no categories,
// ratings or "featured" lists.
//
// To add a book, append an object with a unique, stable `id` (it is what the Family Bookshelf stores, so never
// change or reuse one). `ageRanges` lists every age filter it belongs to ("0–2", "2–3", "3–4", "4–6", "6+").
// For a cover, put the image in src/assets/books/ (portrait, about 3:4, e.g. 600×800), import it at the top of
// this file and set `cover`. Chinese fields (`titleZh`, `authorZh`, …) are optional and fall back to English.
//
//   import myBookCover from "../assets/books/my-book.jpg";
//   {
//     id: "my-book",
//     title: "…", titleZh: "…",
//     author: "…", authorZh: "…",
//     ageRanges: ["2–3", "3–4"],
//     cover: myBookCover,
//     description: "…", descriptionZh: "…",
//     whyWeRecommend: "…", whyWeRecommendZh: "…",
//   },
//
// The entries below are SAMPLES that only show how the collection looks. They are not real books; replace them
// with verified books (and remove `sample: true`).
export const books: Book[] = [
  {
    id: "sample-book-1",
    title: "Sample Book One",
    titleZh: "示例绘本一",
    author: "Sample Author",
    authorZh: "示例作者",
    ageRanges: ["0–2", "2–3"],
    description: "A placeholder entry showing how a board book for the youngest readers appears in RootMap.",
    descriptionZh: "示例条目，展示适合低龄宝宝的纸板书在 RootMap 中的样子。",
    whyWeRecommend: "Replace this with a few warm sentences about why this book is worth sharing.",
    whyWeRecommendZh: "请在这里写几句温暖的话，说明为什么值得和孩子一起读这本书。",
    sample: true,
  },
  {
    id: "sample-book-2",
    title: "Sample Book Two",
    titleZh: "示例绘本二",
    author: "Sample Author",
    authorZh: "示例作者",
    ageRanges: ["2–3", "3–4"],
    description: "A placeholder entry for a picture book suited to toddlers and young preschoolers.",
    descriptionZh: "示例条目，适合幼儿和小班孩子的图画书。",
    whyWeRecommend: "Replace this with what parents and children might enjoy noticing together.",
    whyWeRecommendZh: "请在这里写下亲子共读时可以一起留意的地方。",
    sample: true,
  },
  {
    id: "sample-book-3",
    title: "Sample Book Three",
    titleZh: "示例绘本三",
    author: "Sample Author",
    authorZh: "示例作者",
    ageRanges: ["3–4", "4–6"],
    description: "A placeholder entry for a longer story to read across a few quiet evenings.",
    descriptionZh: "示例条目，适合在几个安静的夜晚慢慢读完的长一点的故事。",
    whyWeRecommend: "Replace this with the reason RootMap chose this book.",
    whyWeRecommendZh: "请在这里写下 RootMap 选择这本书的理由。",
    sample: true,
  },
  {
    id: "sample-book-4",
    title: "Sample Book Four",
    titleZh: "示例绘本四",
    author: "Sample Author",
    authorZh: "示例作者",
    ageRanges: ["4–6"],
    description: "A placeholder entry for a book that invites conversation with older preschoolers.",
    descriptionZh: "示例条目，适合和大班孩子边读边聊的书。",
    whyWeRecommend: "Replace this with a short note on the conversations this book can open.",
    whyWeRecommendZh: "请在这里简单写下这本书能引发的亲子对话。",
    sample: true,
  },
  {
    id: "sample-book-5",
    title: "Sample Book Five",
    titleZh: "示例绘本五",
    author: "Sample Author",
    authorZh: "示例作者",
    ageRanges: ["4–6", "6+"],
    description: "A placeholder entry for a book that grows with the child into the early school years.",
    descriptionZh: "示例条目，可以陪伴孩子进入小学低年级的书。",
    whyWeRecommend: "Replace this with why the book stays meaningful as children grow.",
    whyWeRecommendZh: "请在这里写下这本书为什么能陪伴孩子长大。",
    sample: true,
  },
  {
    id: "sample-book-6",
    title: "Sample Book Six",
    titleZh: "示例绘本六",
    author: "Sample Author",
    authorZh: "示例作者",
    ageRanges: ["6+"],
    description: "A placeholder entry for a chapter book to read aloud together.",
    descriptionZh: "示例条目，适合一起朗读的章节书。",
    whyWeRecommend: "Replace this with what makes it a good read-aloud.",
    whyWeRecommendZh: "请在这里写下它适合朗读的原因。",
    sample: true,
  },
];
