import { describe, expect, it } from "vitest";
import {
  fuzzyMatchesAny,
  fuzzyPhraseMatch,
  levenshtein,
  normalizedTokens,
  tokenEditBudget
} from "./transcriptMatch";

describe("normalizedTokens", () => {
  it("folds niqqud and final letters", () => {
    expect(normalizedTokens("שָׁלוֹם עֲלֵיכֶם")).toEqual(["שלומ", "עליכמ"]);
  });

  it("drops punctuation and empty tokens", () => {
    expect(normalizedTokens("אני, כאן! ")).toEqual(["אני", "כאנ"]);
  });
});

describe("levenshtein", () => {
  it("is zero for identical strings", () => {
    expect(levenshtein("מרגיש", "מרגיש")).toBe(0);
  });

  it("counts single edits", () => {
    expect(levenshtein("מרגיש", "מרגיז")).toBe(1);
    expect(levenshtein("שומעת", "שומאת")).toBe(1);
  });

  it("treats a final letter as one edit from its base form on raw input", () => {
    // The matcher folds finals before measuring; on raw chars they differ.
    expect(levenshtein("צריך", "צריכה")).toBe(2);
  });
});

describe("tokenEditBudget", () => {
  it("requires short function words to be exact", () => {
    expect(tokenEditBudget(2)).toBe(0);
    expect(tokenEditBudget(3)).toBe(0);
  });

  it("allows a small budget for longer words", () => {
    expect(tokenEditBudget(5)).toBe(1);
    expect(tokenEditBudget(8)).toBe(2);
  });
});

describe("fuzzyPhraseMatch", () => {
  it("matches an exact phrase", () => {
    expect(fuzzyPhraseMatch(normalizedTokens("אני מרגיש שאתה רחוק"), "אני מרגיש")).toBe(true);
  });

  it("tolerates a single misheard letter in a long word", () => {
    // "מרגיש" heard as "מרגיז"
    expect(fuzzyPhraseMatch(normalizedTokens("אני מרגיז קצת"), "אני מרגיש")).toBe(true);
  });

  it("does not match when a short function word is wrong", () => {
    // "אני" vs "אתה" — short words must be exact, so this is not a gentle startup.
    expect(fuzzyPhraseMatch(normalizedTokens("אתה מרגיש"), "אני מרגיש")).toBe(false);
  });

  it("does not match across a large edit gap", () => {
    expect(fuzzyPhraseMatch(normalizedTokens("אני אוכל ארוחת ערב"), "אני מרגיש")).toBe(false);
  });

  it("requires all phrase tokens present in one window", () => {
    expect(fuzzyPhraseMatch(normalizedTokens("אני כאן ומרגיש טוב"), "אני מרגיש")).toBe(false);
  });
});

describe("fuzzyMatchesAny", () => {
  it("returns true when any phrase matches", () => {
    expect(fuzzyMatchesAny("תודה שסיפרת לי", ["אני מרגיש", "תודה שסיפרת"])).toBe(true);
  });

  it("returns false for empty phrase lists or empty text", () => {
    expect(fuzzyMatchesAny("שלום", [])).toBe(false);
    expect(fuzzyMatchesAny("", ["אני מרגיש"])).toBe(false);
  });
});
