import type { Book } from "../types";

// The curated Discover > Books collection: picture books chosen for RootMap. There are no categories, ratings or
// "featured" lists. Ages are RootMap's recommendations for reading together, not publisher ratings.
//
// One record per book: the English and Chinese editions share its `id`, which the Family Bookshelf stores, so
// never change or reuse one. `readingAge` puts the book under every overlapping age filter.
//
// Covers: each edition has its own design, so a book has two optional covers. Only add a cover image you are
// allowed to use (e.g. supplied or approved by the publisher). Put the files in src/assets/books/, named after
// the id, import them at the top of this file and set `coverEn` / `coverZh`:
//
//   import theCarrotSeedEn from "../assets/books/the-carrot-seed-en.jpg";
//   import theCarrotSeedZh from "../assets/books/the-carrot-seed-zh.jpg";
//   { id: "the-carrot-seed", …, coverEn: theCarrotSeedEn, coverZh: theCarrotSeedZh }
//
// Imported images get hashed URLs under the site's base path, so they work on GitHub Pages too. Until an
// edition's cover is added, the app draws a placeholder with the title in that language.
export const books: Book[] = [
  {
    id: "guess-how-much-i-love-you",
    title: "Guess How Much I Love You",
    titleZh: "猜猜我有多爱你",
    author: "Sam McBratney",
    authorZh: "山姆·麦克布雷尼",
    readingAge: { from: 2, to: 6 },
    description: "At bedtime, Little Nutbrown Hare tries to show Big Nutbrown Hare how much he loves him, stretching his arms wide and hopping as high as he can. Each time, Big Nutbrown Hare finds a way to love him back a little more, until sleep gently ends the game.",
    descriptionZh: "睡觉前，小栗色兔子想让大栗色兔子知道自己有多爱他：把手臂张得大大的，跳得高高的。每一次，大栗色兔子都用自己的方式回应，把爱说得再多一点，直到小兔子在这场温柔的比赛中慢慢睡着。",
    whyWeRecommend: "This is a conversation about love that young children can actually picture: arms, hops, the path to the river, the moon. The gentle back-and-forth mirrors how children play with big feelings, and the closing lines give the grown-up the last, quiet word. Many families find themselves inventing their own versions (\"I love you all the way to…\") long after the book is closed.",
    whyWeRecommendZh: "这是一场孩子“看得见”的关于爱的对话：张开的手臂、跳起的高度、通往小河的小路，还有月亮。你一句我一句的温柔“比赛”，正是孩子和大人一起玩味大情感的方式，结尾那句轻声的话则留给了大人。很多家庭读完后，还会继续编出属于自己的版本——“我爱你，一直爱到……”",
  },
  {
    id: "the-carrot-seed",
    title: "The Carrot Seed",
    titleZh: "胡萝卜种子",
    author: "Ruth Krauss",
    authorZh: "露丝·克劳斯",
    readingAge: { from: 2, to: 5 },
    description: "A little boy plants a carrot seed. His mother, his father and his big brother each tell him it won't come up, but he keeps weeding and watering the spot day after day. Told in very few words, it is a quiet story about believing in something while you wait.",
    descriptionZh: "一个小男孩种下了一颗胡萝卜种子。妈妈、爸爸和哥哥都说它不会发芽，可他还是天天拔草、浇水。故事只用了很少的文字，却安静地讲出了在等待中坚持相信的样子。",
    whyWeRecommend: "Young children spend a lot of time waiting, and this book takes that experience seriously. The text is short and patterned enough for a two-year-old to follow and soon \"read\" along, while the simple drawings leave room to wonder what is happening under the ground. It opens easy conversations about patience, about trying again, and about how it feels when grown-ups doubt you.",
    whyWeRecommendZh: "小孩子的生活里有很多等待，这本书认真地对待了这种感受。文字简短而有规律，两岁的孩子也能跟上，很快就能“读”出声来；简洁的画面又留出空间，让孩子去想象地底下正在发生什么。它很自然地引出关于耐心、关于再试一次，以及“大人不相信我时是什么感觉”的亲子对话。",
  },
  {
    // UK title (Bloomsbury, 2007); the US edition is "Take a Kiss to School". Illustrated by Sue Hellard.
    id: "a-pocketful-of-kisses",
    title: "A Pocketful of Kisses",
    titleZh: "一口袋的吻",
    author: "Angela McAllister",
    authorZh: "安杰拉·迈克奥里斯特",
    readingAge: { from: 3, to: 6 },
    description: "Digby is nervous about going to school and leaving his mother behind. Before he sets off, she fills his pocket with kisses he can take out whenever he needs one. A gentle story about separation, and about carrying a parent's love with you into a new place.",
    descriptionZh: "迪比要去上学了，想到要和妈妈分开，他心里很紧张。出门前，妈妈往他的口袋里装满了吻，需要的时候就可以拿出一个。这是一个关于分离的温柔故事，也是关于把爸爸妈妈的爱带进新地方的故事。",
    whyWeRecommend: "Starting school or nursery is one of the first big separations in a child's life, and this story gives that worry a shape a child can hold onto. The pocket of kisses is simple enough to borrow: many families invent their own small ritual before a goodbye. Reading it together before a new start lets children talk about missing someone, and hear that the feeling is normal.",
    whyWeRecommendZh: "上幼儿园或上学，是孩子生命中最早的几次大分离之一。这个故事给了这份担心一个孩子握得住的形状。“一口袋的吻”简单到可以直接借用：很多家庭会在告别前创造属于自己的小仪式。在新的开始之前一起读它，能让孩子说出“我会想你”，也让他们知道，这样的感觉很正常。",
  },
  {
    id: "something-from-nothing",
    title: "Something from Nothing",
    titleZh: "爷爷一定有办法",
    author: "Phoebe Gilman",
    authorZh: "菲比·吉尔曼",
    readingAge: { from: 3, to: 6 },
    description: "When Joseph is a baby, his grandfather sews him a wonderful blanket. As Joseph grows and the blanket wears out, Grandpa reshapes the cloth into something smaller each time. Adapted from a Jewish folktale, with a family of mice living a story of their own beneath the floorboards.",
    descriptionZh: "约瑟还是婴儿的时候，爷爷为他缝了一条奇妙的毯子。约瑟慢慢长大，毯子也慢慢旧了，爷爷每次都把布料改成一件更小的新东西。故事改编自犹太民间故事，地板下还住着一家老鼠，过着属于它们自己的故事。",
    whyWeRecommend: "Children love the rhythm of this book: each time something wears out, they can guess what Grandpa will make next. It shows a grandparent's skill and steady care, and treats old things as material for something new rather than rubbish. Look closely at the mice under the floor; spotting what they do with the scraps becomes a second story for children to discover and tell themselves.",
    whyWeRecommendZh: "孩子们很喜欢这本书的节奏：每当东西旧了，他们都会猜爷爷接下来会做成什么。书里有祖辈的手艺和一份不急不躁的关爱，也让孩子看到，旧东西不是垃圾，而是做新东西的材料。别忘了留意地板下的老鼠一家——发现它们怎样用碎布，会成为孩子自己发现、自己讲述的第二个故事。",
  },
  {
    id: "the-runaway-bunny",
    title: "The Runaway Bunny",
    titleZh: "逃家小兔",
    author: "Margaret Wise Brown",
    authorZh: "玛格丽特·怀兹·布朗",
    readingAge: { from: 2, to: 6 },
    description: "A little bunny tells his mother he is going to run away. He imagines becoming a fish, a rock, a bird and more; each time, his mother calmly explains what she will become so that she can find him. First published in 1942, with pictures by Clement Hurd.",
    descriptionZh: "小兔子告诉妈妈，他要离家出走。他想象自己变成一条鱼、一块石头、一只小鸟……每一次，妈妈都平静地说，她会变成什么来找到他。本书首次出版于1942年，由克雷门·赫德绘图。",
    whyWeRecommend: "Young children often test how far they can go and still be safe, and this book lets them do it in imagination. The question-and-answer pattern is easy to anticipate, so children quickly join in with what the mother will become. Some grown-ups find the mother a little too watchful; it can be worth asking your child how the bunny feels, and how the mother does.",
    whyWeRecommendZh: "小孩子常常会试探：自己能走多远，还依然是安全的。这本书让他们在想象中做这样的试探。一问一答的结构很好预测，孩子很快就会抢着说出妈妈要变成什么。也有大人觉得书里的妈妈“看得有点紧”，读的时候不妨问问孩子：小兔子是什么感觉？妈妈又是什么感觉？",
  },
  {
    id: "the-giving-tree",
    title: "The Giving Tree",
    titleZh: "爱心树",
    author: "Shel Silverstein",
    authorZh: "谢尔·希尔弗斯坦",
    readingAge: { from: 4, to: 6, plus: true },
    description: "A tree loves a boy. When he is small, they play together every day; as he grows up, he keeps coming back to ask for things, and the tree keeps giving what it can. Told in short lines with simple black-and-white drawings, the story follows them across a lifetime.",
    descriptionZh: "一棵树爱着一个男孩。男孩小时候，他们每天一起玩；男孩长大后，一次次回来向树要东西，树也一次次把自己能给的都给了他。故事用简短的句子和简单的黑白线条画，讲述了他们相伴的一生。",
    whyWeRecommend: "Few picture books start as many different conversations. Some readers see unconditional love; others see a relationship where one side only takes, and a giver who never asks for anything back. Rather than handing children a single lesson, read it slowly and ask what they notice: Is the tree happy? What could the boy have given? It suits children old enough to hold two feelings at once.",
    whyWeRecommendZh: "很少有绘本能引出这么多不同的讨论。有人从中读到无条件的爱；也有人看到一段只有一方在索取的关系，以及一个从不为自己要求什么的付出者。与其直接告诉孩子一个道理，不如慢慢读，问问他们看到了什么：树真的快乐吗？男孩本可以给树什么？这本书更适合已经能同时感受两种情绪的大一点的孩子。",
  },
  {
    id: "charlie-needs-a-cloak",
    title: "Charlie Needs a Cloak",
    titleZh: "阿利的红斗篷",
    author: "Tomie dePaola",
    authorZh: "汤米·狄波拉",
    readingAge: { from: 3, to: 6 },
    description: "Charlie the shepherd's cloak is worn out, so he sets out to make a new one himself: shearing his sheep, then washing, carding, spinning, weaving and dyeing the wool before he sews. All the while, one mischievous sheep keeps getting in the way.",
    descriptionZh: "牧羊人阿利的斗篷破旧了，他决定自己做一件新的：剪羊毛，再把羊毛洗净、梳理、纺成线、织成布、染上颜色，最后缝起来。一路上，总有一只调皮的羊在捣乱。",
    whyWeRecommend: "Children wear clothes every day without knowing where they come from. This book follows wool all the way from a sheep's back to a finished cloak, one clear step at a time, so children can see that the things around them are made with hands and time. It is also funny: watching the troublesome sheep in the corners of the pictures rewards slow, careful looking.",
    whyWeRecommendZh: "孩子们每天穿衣服，却很少知道衣服从哪里来。这本书一步一步，跟着羊毛从羊身上一路变成一件斗篷，让孩子看到：身边的东西，是靠一双双手和时间做出来的。它也很好笑——留意画面角落里那只捣蛋的羊，会让孩子越看越仔细。",
  },
  {
    id: "a-squash-and-a-squeeze",
    title: "A Squash and a Squeeze",
    titleZh: "小房子变大房子",
    author: "Julia Donaldson",
    authorZh: "朱莉娅·唐纳森",
    readingAge: { from: 3, to: 6 },
    description: "A little old lady thinks her house is far too small. A wise old man gives her some surprising advice, and soon her home is crowded with farm animals. Told in bouncy rhyme, it is a funny story about how a space can feel different depending on what you compare it with.",
    descriptionZh: "一位老奶奶觉得自己的房子太小了。一位聪明的老爷爷给了她一些出人意料的建议，没过多久，她的屋子里就挤满了农场的动物。故事用轻快押韵的文字，幽默地讲出：一个空间是大是小，常常取决于你拿它和什么比。",
    whyWeRecommend: "The rhyme and repeated refrain invite children to join in, and the growing chaos of animals is pure fun to read aloud. Underneath the jokes is a real idea that young children can grasp: how big or small something feels can change, even when nothing about it has changed. Afterwards, children often enjoy acting it out, or remembering a time something felt different from before.",
    whyWeRecommendZh: "押韵的文字和反复出现的句子，会让孩子忍不住跟着一起念；动物越来越多、屋里越来越乱，读出声来非常有趣。笑声背后藏着一个小孩子也能理解的道理：东西本身没有变，感觉上的大小却可以改变。读完后，孩子们常常喜欢把故事演一遍，或者聊聊自己有没有过“前后感觉不一样”的时候。",
  },
];
