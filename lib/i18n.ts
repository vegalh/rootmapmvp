export type Language = "en" | "zh";

export const landingCopy = {
  en: {
    brand: "Rootmap",
    tagline: "Observe daily. Understand deeply. Support meaningful growth.",
    description:
      "Rootmap helps parents and teachers of children ages 2–8 turn simple daily observations into practical, off-screen learning activities.",
    audience: "Built for families and classrooms",
    startParent: "Start as Parent",
    startTeacher: "Start as Teacher",
    switchLabel: "中文"
  },
  zh: {
    brand: "Rootmap",
    tagline: "每天观察，看见成长，给出有意义的支持。",
    description:
      "Rootmap 帮助 2–8 岁儿童的家长和老师，把每天的简短观察转化为可执行、低屏幕的成长活动建议。",
    audience: "为家庭与课堂共同设计",
    startParent: "以家长身份开始",
    startTeacher: "以老师身份开始",
    switchLabel: "English"
  }
} as const;
