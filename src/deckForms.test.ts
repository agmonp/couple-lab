import { describe, expect, it } from "vitest";
import { decks } from "./data";
import { addressedCard, deckCardForms, hasSlashForm, resolveForms, resolveSlashForms } from "./deckForms";
import { FEELINGS_PALETTE } from "./structuredSessions";

const dana = { name: "דנה", form: "f" as const };
const yoav = { name: "יואב", form: "m" as const };

describe("resolveForms", () => {
  it("fills names and picks the form of each role", () => {
    expect(resolveForms("{you}, מה {them} {them:עשה|עשתה}?", { you: yoav, them: dana })).toBe("יואב, מה דנה עשתה?");
    expect(resolveForms("{you}, מה {them} {them:עשה|עשתה}?", { you: dana, them: yoav })).toBe("דנה, מה יואב עשה?");
  });

  it("allows an empty masculine side", () => {
    expect(resolveForms("שאל{a:|י}", { a: dana })).toBe("שאלי");
    expect(resolveForms("שאל{a:|י}", { a: yoav })).toBe("שאל");
  });

  it("fails loudly on a role nobody passed", () => {
    expect(() => resolveForms("{s}", { you: dana })).toThrow();
  });
});

describe("resolveSlashForms", () => {
  it("handles suffixes, final letters and whole-word pairs", () => {
    expect(resolveSlashForms("לא מובן/ת", "f")).toBe("לא מובנת");
    expect(resolveSlashForms("לא מוערך/ת", "f")).toBe("לא מוערכת");
    expect(resolveSlashForms("מותקף/ת", "m")).toBe("מותקף");
    expect(resolveSlashForms("שקפ/י", "m")).toBe("שקף");
    expect(resolveSlashForms("שקפ/י", "f")).toBe("שקפי");
    expect(resolveSlashForms("את/ה מבין/ה", "m")).toBe("אתה מבין");
    expect(resolveSlashForms("את/ה מבין/ה", "f")).toBe("את מבינה");
  });

  it("leaves no slash in the feelings palette for either form", () => {
    for (const form of ["m", "f"] as const) {
      for (const word of FEELINGS_PALETTE) expect(hasSlashForm(resolveSlashForms(word, form))).toBe(false);
    }
  });
});

describe("deckCardForms", () => {
  const light = decks.filter((deck) => (deck.depthLevel ?? 99) <= 3);

  it("covers every card of every light deck, index for index", () => {
    expect(light.length).toBeGreaterThanOrEqual(7);
    for (const deck of light) {
      expect(deckCardForms[deck.id], deck.id).toBeDefined();
      expect(deckCardForms[deck.id].length, deck.id).toBe(deck.cards.length);
    }
  });

  it("renders without slash forms or leftover tokens for every pairing", () => {
    const pairs = [[dana, yoav], [yoav, dana], [dana, { name: "נועה", form: "f" as const }], [yoav, { name: "עומר", form: "m" as const }]];
    for (const deck of light) {
      deck.cards.forEach((card, index) => {
        for (const [you, them] of pairs) {
          const text = addressedCard(deck.id, index, card, you, them);
          expect(hasSlashForm(text), text).toBe(false);
          expect(text).not.toMatch(/[{}]/);
        }
      });
    }
  });
});
