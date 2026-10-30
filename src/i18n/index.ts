"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Locale = "en" | "ja" | "zh-Hant" | "zh-Hans" | "ko" | "es" | "pt" | "fr" | "ru" | "th" | "vi";

export const LOCALES: { id: Locale; label: string; short: string }[] = [
  { id: "en", label: "English", short: "EN" },
  { id: "ja", label: "日本語", short: "日本語" },
  { id: "zh-Hant", label: "繁體中文", short: "繁中" },
  { id: "zh-Hans", label: "简体中文", short: "简中" },
  { id: "ko", label: "한국어", short: "한국어" },
  { id: "es", label: "Español", short: "ES" },
  { id: "pt", label: "Português", short: "PT" },
  { id: "fr", label: "Français", short: "FR" },
  { id: "ru", label: "Русский", short: "RU" },
  { id: "th", label: "ไทย", short: "ไทย" },
  { id: "vi", label: "Tiếng Việt", short: "VI" },
];

type Dictionary = Record<string, string>;

/**
 * Translations keyed by the English text itself, so anything untranslated simply shows in English.
 * Each language is its own chunk (locales/*.json), fetched when it's chosen: a visitor downloads
 * only theirs. Add strings with `node scripts/i18n-add.mjs`.
 */
export const DICTIONARY_LOADERS: Record<Exclude<Locale, "en">, () => Promise<Dictionary>> = {
  ja: () => import("./locales/ja.json").then((m) => m.default),
  "zh-Hant": () => import("./locales/zh-Hant.json").then((m) => m.default),
  "zh-Hans": () => import("./locales/zh-Hans.json").then((m) => m.default),
  ko: () => import("./locales/ko.json").then((m) => m.default),
  es: () => import("./locales/es.json").then((m) => m.default),
  pt: () => import("./locales/pt.json").then((m) => m.default),
  fr: () => import("./locales/fr.json").then((m) => m.default),
  ru: () => import("./locales/ru.json").then((m) => m.default),
  th: () => import("./locales/th.json").then((m) => m.default),
  vi: () => import("./locales/vi.json").then((m) => m.default),
};

const loaded: Partial<Record<Locale, Dictionary>> = {};

/** Fetch a language's dictionary once; English needs none. */
export async function loadDictionary(locale: Locale): Promise<void> {
  if (locale === "en" || loaded[locale]) return;
  loaded[locale] = await DICTIONARY_LOADERS[locale]();
}

/** The browser's language, mapped to one we have (Taiwan and Hong Kong read Traditional). */
export function detectLocale(langs: readonly string[]): Locale {
  for (const l of langs.map((x) => x.toLowerCase())) {
    if (l.startsWith("ja")) return "ja";
    if (l.startsWith("zh")) return /hant|tw|hk|mo/.test(l) ? "zh-Hant" : "zh-Hans";
    for (const id of ["ko", "es", "pt", "fr", "ru", "th", "vi"] as const) if (l.startsWith(id)) return id;
    if (l.startsWith("en")) return "en";
  }
  return "en";
}

interface LocaleState {
  /** The language on screen: set only once its dictionary has loaded. */
  locale: Locale;
  /** Whether the person picked it (otherwise it follows the browser). */
  chosen: boolean;
  /** The saved choice, waiting for its dictionary after a reload. */
  saved?: Locale;
  setLocale: (l: Locale) => Promise<void>;
}

export const useLocale = create<LocaleState>()(
  persist(
    (set) => ({
      locale: "en",
      chosen: false,
      setLocale: async (locale) => {
        await loadDictionary(locale);
        set({ locale, chosen: true });
      },
    }),
    {
      name: "novafield-locale",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ locale: s.locale, chosen: s.chosen }),
      // The saved language waits for its dictionary (useLocaleSync) instead of showing untranslated.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LocaleState>;
        return { ...current, chosen: !!p.chosen, saved: p.locale };
      },
      // Applied after the page hydrates (useLocaleSync), so server and first client render agree.
      skipHydration: true,
    },
  ),
);

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

type Template = { re: RegExp; key: string; names: string[] };
const templates: Partial<Record<Locale, Template[]>> = {};

/**
 * A language's sentences with {placeholders}, as patterns that match them filled in. Most specific
 * first, and only those with enough fixed words to be told apart ("{s} s" would match anything).
 */
function templatesOf(locale: Locale): Template[] {
  const dict = loaded[locale];
  if (!dict) return [];
  return (templates[locale] ??= Object.keys(dict)
    .filter((k) => /\{\w+\}/.test(k) && k.replace(/\{\w+\}/g, "").length >= 12)
    .sort((a, b) => b.replace(/\{\w+\}/g, "").length - a.replace(/\{\w+\}/g, "").length)
    .map((key) => ({
      key,
      names: [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      re: new RegExp(`^${key.split(/\{\w+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)")}$`, "s"),
    })));
}

/**
 * Translate `text` (English) into a locale; `{name}` placeholders are filled from `vars`. Text that
 * arrives already filled in (a server message made with say()) is matched back to its template.
 */
export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  if (locale === "en") return vars ? fill(text, vars) : text;
  const dict = loaded[locale];
  const exact = dict?.[text];
  if (exact !== undefined) return vars ? fill(exact, vars) : exact;
  if (!vars && dict)
    for (const t of templatesOf(locale)) {
      const m = t.re.exec(text);
      if (m) return fill(dict[t.key], Object.fromEntries(t.names.map((n, i) => [n, m[i + 1]])));
    }
  return vars ? fill(text, vars) : text;
}

export type T = (text: string, vars?: Record<string, string | number>) => string;

/** The translator for the current language; components re-render when it changes. */
export function useT(): T {
  const locale = useLocale((s) => s.locale);
  return (text, vars) => translate(locale, text, vars);
}

/** The locale to hand to Intl (dates, numbers) for the current language. */
export const intlLocale = () =>
  ({ en: "en", ja: "ja-JP", "zh-Hant": "zh-TW", "zh-Hans": "zh-CN", ko: "ko-KR", es: "es", pt: "pt-BR", fr: "fr-FR", ru: "ru-RU", th: "th-TH", vi: "vi-VN" })[useLocale.getState().locale];

/** Outside components (toasts from event handlers): the current language right now. */
export const tr: T = (text, vars) => translate(useLocale.getState().locale, text, vars);

/** Follow the browser's language until the person chooses one, and keep <html lang> in step. */
export function useLocaleSync() {
  const locale = useLocale((s) => s.locale);
  useEffect(() => {
    void Promise.resolve(useLocale.persist.rehydrate()).then(async () => {
      const { chosen, saved } = useLocale.getState();
      const locale = chosen && saved ? saved : detectLocale(navigator.languages ?? [navigator.language]);
      await loadDictionary(locale);
      useLocale.setState({ locale });
    });
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
}
