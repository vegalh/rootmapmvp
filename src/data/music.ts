import type { MusicActivity } from "../types";
import coverSage from "../assets/music/cover-sage.svg";
import coverApricot from "../assets/music/cover-apricot.svg";
import coverMeadow from "../assets/music/cover-meadow.svg";

// Discover > Music: activities a parent and child do together, guided by a short recording. Not a music library.
//
// To add one, append an object with a unique, stable `id` (saved activities, My Week plans and "Mark as Tried"
// records refer to it, so never change or reuse one, and don't reuse an id from src/data/activities.ts).
// `duration` is the activity's length in minutes. `ageRanges` lists every age filter it belongs to.
//
// Recordings: put the file in src/assets/music/ (MP3 or M4A), import it at the top of this file and set
// `audioSrc`. Without `audioSrc` (or if the file can't be played) the page shows "Recording coming soon"
// instead of a player.
//
//   import freezeDanceAudio from "../assets/music/freeze-dance.mp3";
//   { id: "music-freeze-dance", …, audioSrc: freezeDanceAudio }
//
// The covers below are simple illustrations; replace `coverImage` with an imported image (about 4:3) if you like.
export const musicActivities: MusicActivity[] = [
  {
    id: "music-freeze-dance",
    title: "Freeze Dance",
    titleZh: "音乐停，我也停",
    ageRanges: ["2–3", "3–4", "4–6"],
    duration: 10,
    coverImage: coverSage,
    description: "Dance while the music plays and freeze the moment it stops. A joyful way to practise listening and self-control together.",
    descriptionZh: "音乐响起就跳舞，音乐一停就定住。在欢笑中一起练习倾听和自我控制。",
    howToPlay: [
      "Clear a little space and stand facing each other.",
      "Dance any way you like while the music plays.",
      "When it stops, freeze like a statue until it starts again.",
      "Take turns choosing a funny freeze pose.",
    ],
    howToPlayZh: [
      "空出一小块地方，和孩子面对面站好。",
      "音乐响起时，随意跳舞。",
      "音乐一停，就像雕像一样定住，直到音乐再次响起。",
      "轮流想一个好玩的定格姿势。",
    ],
    whatChildrenExplore: ["Listening carefully", "Starting and stopping", "Body control", "Shared laughter"],
    whatChildrenExploreZh: ["专注倾听", "开始与停止", "身体控制", "一起欢笑"],
  },
  {
    id: "music-clap-the-beat",
    title: "Clap the Beat",
    titleZh: "跟着节拍拍拍手",
    ageRanges: ["0–2", "2–3"],
    duration: 5,
    coverImage: coverApricot,
    description: "Feel the steady beat together by clapping, patting knees and tapping toes. Even the youngest children love joining in.",
    descriptionZh: "拍手、拍膝盖、点点脚尖，一起感受稳定的节拍。再小的孩子也喜欢参与。",
    howToPlay: [
      "Sit together, with your little one on your lap or facing you.",
      "Clap gently along with the beat.",
      "Switch to patting knees, then tapping toes.",
      "Slow down and finish with a quiet hug.",
    ],
    howToPlayZh: [
      "和孩子坐在一起，可以抱在腿上，也可以面对面。",
      "跟着节拍轻轻拍手。",
      "换成拍膝盖，再换成点脚尖。",
      "慢慢放缓，最后给孩子一个安静的拥抱。",
    ],
    whatChildrenExplore: ["Steady beat", "Copying movements", "Closeness and connection"],
    whatChildrenExploreZh: ["稳定的节拍", "模仿动作", "亲密与连结"],
  },
  {
    id: "music-animal-walks",
    title: "Animal Walks",
    titleZh: "小动物走路",
    ageRanges: ["2–3", "3–4"],
    duration: 10,
    coverImage: coverMeadow,
    description: "Move like different animals as the recording guides you: stomp like an elephant, hop like a frog, tiptoe like a mouse.",
    descriptionZh: "跟着音频的引导，学各种小动物走路：像大象一样跺脚，像青蛙一样跳，像小老鼠一样踮脚走。",
    howToPlay: [
      "Listen for which animal comes next.",
      "Move across the room like that animal, together.",
      "Talk about it: is it big or small, fast or slow?",
      "Let your child invent the last animal.",
    ],
    howToPlayZh: [
      "仔细听下一个出场的是什么动物。",
      "和孩子一起，学着它的样子穿过房间。",
      "聊一聊：它是大还是小，是快还是慢？",
      "最后一个动物由孩子来发明。",
    ],
    whatChildrenExplore: ["Gross motor skills", "Imagination", "Big and small, fast and slow"],
    whatChildrenExploreZh: ["大动作发展", "想象力", "大与小、快与慢"],
  },
  {
    id: "music-fast-and-slow",
    title: "Fast and Slow",
    titleZh: "快快慢慢",
    ageRanges: ["3–4", "4–6", "6+"],
    duration: 8,
    coverImage: coverApricot,
    description: "March, tiptoe and sway as the music speeds up and slows down. Children notice changes in tempo and match them with their bodies.",
    descriptionZh: "音乐变快就快走，变慢就慢慢摇摆。孩子会留意速度的变化，并用身体跟上它。",
    howToPlay: [
      "Start by marching on the spot together.",
      "When the music speeds up, move faster; when it slows, move slowly.",
      "Try tiny steps, giant steps and gentle swaying.",
      "Ask your child to be the leader for the last round.",
    ],
    howToPlayZh: [
      "先和孩子一起原地踏步。",
      "音乐变快，动作就变快；音乐变慢，动作就变慢。",
      "试试小碎步、大步走和轻轻摇摆。",
      "最后一轮请孩子来当领队。",
    ],
    whatChildrenExplore: ["Tempo", "Listening and responding", "Coordination", "Leading and following"],
    whatChildrenExploreZh: ["速度变化", "倾听与回应", "身体协调", "带领与跟随"],
  },
  {
    id: "music-echo-song",
    title: "Echo Song",
    titleZh: "你唱我学",
    ageRanges: ["0–2", "2–3", "3–4"],
    duration: 5,
    coverImage: coverSage,
    description: "One voice sings a short phrase and the other sings it back. A gentle singing game that builds listening and early language.",
    descriptionZh: "一个人唱一小句，另一个人跟着唱回来。一个温柔的唱歌游戏，帮助孩子学会倾听和早期语言。",
    howToPlay: [
      "Sing a short, simple phrase or sound.",
      "Pause and let your child echo it back.",
      "Try it loud and soft, high and low.",
      "Swap roles so your child sings first.",
    ],
    howToPlayZh: [
      "唱一小句简单的歌词或声音。",
      "停一下，让孩子跟着唱回来。",
      "试试大声和小声、高音和低音。",
      "交换角色，让孩子先唱。",
    ],
    whatChildrenExplore: ["Listening", "Early language", "Voice and pitch", "Taking turns"],
    whatChildrenExploreZh: ["倾听", "早期语言", "声音与音高", "轮流"],
  },
];
