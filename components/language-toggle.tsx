"use client";

import { Language } from "@/lib/i18n";

type LanguageToggleProps = {
  language: Language;
  onToggle: () => void;
  label: string;
};

export function LanguageToggle({ language, onToggle, label }: LanguageToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-full border border-rootmap-200 bg-white px-4 py-2 text-sm font-medium text-rootmap-700 transition hover:border-rootmap-500 hover:text-rootmap-900"
      aria-label={language === "en" ? "Switch to Chinese" : "Switch to English"}
    >
      {label}
    </button>
  );
}
