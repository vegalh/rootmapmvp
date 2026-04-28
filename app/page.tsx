"use client";

import { useMemo, useState } from "react";
import { LanguageToggle } from "@/components/language-toggle";
import { Language, landingCopy } from "@/lib/i18n";

export default function HomePage() {
  const [language, setLanguage] = useState<Language>("en");
  const copy = useMemo(() => landingCopy[language], [language]);

  return (
    <main className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto flex w-full max-w-6xl justify-end">
        <LanguageToggle
          language={language}
          label={copy.switchLabel}
          onToggle={() => setLanguage((prev) => (prev === "en" ? "zh" : "en"))}
        />
      </div>

      <section className="mx-auto mt-8 max-w-6xl rounded-3xl border border-rootmap-100 bg-white/95 p-8 shadow-card md:p-14">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rootmap-500">{copy.brand}</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-rootmap-900 md:text-5xl">
          {copy.tagline}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-rootmap-700">{copy.description}</p>

        <div className="mt-10 inline-flex rounded-full bg-rootmap-100 px-4 py-2 text-sm font-medium text-rootmap-700">
          {copy.audience}
        </div>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <button className="rounded-2xl bg-rootmap-700 px-7 py-3 text-base font-semibold text-white transition hover:bg-rootmap-900">
            {copy.startParent}
          </button>
          <button className="rounded-2xl border border-rootmap-300 bg-white px-7 py-3 text-base font-semibold text-rootmap-700 transition hover:border-rootmap-500 hover:text-rootmap-900">
            {copy.startTeacher}
          </button>
        </div>
      </section>
    </main>
  );
}
