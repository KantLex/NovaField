import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { say } from "@/lib/say";
import { detectLocale, DICTIONARY_LOADERS, loadDictionary, translate } from "./index";

// The extractor lists every English string the interface can show.
const keys = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "../../scripts/i18n-keys.mjs")], { encoding: "utf8" })) as string[];
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

const DICTIONARIES = Object.fromEntries(await Promise.all(Object.entries(DICTIONARY_LOADERS).map(async ([l, load]) => [l, await load()] as const)));

describe("translations", () => {
  for (const [locale, dict] of Object.entries(DICTIONARIES)) {
    it(`${locale} covers every string the interface shows`, () => {
      const missing = keys.filter((k) => !(k in dict));
      expect(missing, "Add these with node scripts/i18n-add.mjs").toEqual([]);
    });

    it(`${locale} keeps every {placeholder}`, () => {
      const broken = Object.entries(dict).filter(([en, t]) => placeholders(en).join() !== placeholders(t).join());
      expect(broken).toEqual([]);
    });
  }

  it("fills placeholders and falls back to English", async () => {
    await loadDictionary("ja");
    expect(translate("ja", "Moved {n} takes to {project}.", { n: 3, project: "夜市" })).toBe("3 テイクを 夜市 に移動しました。");
    expect(translate("zh-Hant", "Something brand new")).toBe("Something brand new");
    expect(translate("en", "{n} takes", { n: 2 })).toBe("2 takes");
  });

  it("matches a filled-in sentence from the server back to its template", async () => {
    await loadDictionary("ja");
    const ja = DICTIONARIES.ja;
    const template = "Shortened to {seconds} s: H3 breaks down past this length at {size}.";
    const sent = say(template, { seconds: "9.5", size: "1280×720" });
    expect(sent).toBe("Shortened to 9.5 s: H3 breaks down past this length at 1280×720.");
    expect(translate("ja", sent)).toBe(ja[template].replace("{seconds}", "9.5").replace("{size}", "1280×720"));
    expect(translate("ja", sent)).not.toBe(sent);
    // Only whole sentences match, and short templates ("{s} s") never swallow other text.
    expect(translate("ja", `Note: ${sent}`)).toBe(`Note: ${sent}`);
    expect(translate("ja", "12 s")).toBe("12 s");
  });

  it("picks the browser's language", () => {
    expect(detectLocale(["ja-JP"])).toBe("ja");
    expect(detectLocale(["zh-TW"])).toBe("zh-Hant");
    expect(detectLocale(["zh-HK"])).toBe("zh-Hant");
    expect(detectLocale(["zh-CN"])).toBe("zh-Hans");
    expect(detectLocale(["zh"])).toBe("zh-Hans");
    expect(detectLocale(["ko-KR"])).toBe("ko");
    expect(detectLocale(["pt-BR"])).toBe("pt");
    expect(detectLocale(["th"])).toBe("th");
    expect(detectLocale(["vi-VN"])).toBe("vi");
    expect(detectLocale(["de-DE", "en-GB"])).toBe("en");
  });
});
