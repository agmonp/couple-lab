import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decks } from "@shared/data";
import { hasSlashForm, resolveForms, type AddressedPerson } from "@shared/deckForms";
import { AFTERMATH_STEPS, LISTENER_RULES, STRESS_REDUCING_STEPS } from "@shared/structuredSessions";
import { EventLog } from "../src/core/events";
import { achievements, deeperLayerOffer, derive, MAX_LAYER_THIS_STAGE } from "../src/core/model";
import { openDecks, pickDailyQuestion, questionPool, questionText } from "../src/core/questions";
import { PRESSURE_WORDS, dailyNotificationText, weeklyStepText, weeklyStepTime } from "../src/core/reminders";
import { END_QUESTIONS, REVEAL_FOLLOW_UPS } from "../src/content/prompts";
import { AFTERMATH_TEXT, LISTENER_RULES_TEXT, STRESS_TEXT } from "../src/content/sessionText";

const people: AddressedPerson[] = [
  { name: "דנה", form: "f" },
  { name: "יואב", form: "m" },
  { name: "נועה", form: "f" },
  { name: "עומר", form: "m" }
];
const pairs = people.flatMap((x) => people.filter((y) => y !== x).map((y) => [x, y] as const));

function clean(text: string) {
  expect(hasSlashForm(text), text).toBe(false);
  expect(text, text).not.toMatch(/[{}]/);
}

describe("decks carry the depth fields", () => {
  it("every deck has depthLevel, therapeuticGoal, timeMinutes and needsBothPhones", () => {
    for (const deck of decks) {
      expect(deck.depthLevel, deck.id).toBeGreaterThanOrEqual(1);
      expect(deck.depthLevel, deck.id).toBeLessThanOrEqual(7);
      expect(deck.therapeuticGoal?.length, deck.id).toBeGreaterThan(5);
      expect(deck.timeMinutes, deck.id).toBeGreaterThan(0);
      expect(typeof deck.needsBothPhones, deck.id).toBe("boolean");
    }
  });

  it("layers 1–3 hold the decks the plan names", () => {
    const byLayer = (n: number) => decks.filter((d) => d.depthLevel === n).map((d) => d.id).sort();
    expect(byLayer(1)).toEqual(["love-maps", "open-ended"]);
    expect(byLayer(2)).toEqual(["appreciation", "fondness"]);
    expect(byLayer(3)).toEqual(["date-opportunity", "rituals", "turn-toward"]);
  });

  it("this stage never opens a layer above 3, even if unlocked further", () => {
    expect(openDecks(7).every((d) => (d.depthLevel ?? 99) <= MAX_LAYER_THIS_STAGE)).toBe(true);
    expect(openDecks(1).map((d) => d.depthLevel)).toEqual([1, 1]);
  });
});

describe("every text the phone shows is in each person's form", () => {
  it("daily and date cards", () => {
    for (const ref of questionPool(3)) {
      for (const [you, them] of pairs) {
        const couple = { A: { id: "A" as const, ...you }, B: { id: "B" as const, ...them } };
        clean(questionText(ref, couple, "A"));
        clean(questionText(ref, couple, "B"));
      }
    }
  });

  it("structured sessions, listener rules, follow-ups and end questions", () => {
    for (const [x, y] of pairs) {
      const roles = { a: x, b: y, s: x, l: y, you: x, them: y };
      for (const t of [...AFTERMATH_TEXT, ...STRESS_TEXT]) {
        for (const part of [t.intent, t.together, t.perPerson, t.turn]) if (part) clean(resolveForms(part, roles));
      }
      for (const rule of LISTENER_RULES_TEXT) clean(resolveForms(rule, roles));
      for (const line of REVEAL_FOLLOW_UPS) clean(resolveForms(line, roles));
      clean(resolveForms(END_QUESTIONS.good, roles));
      clean(resolveForms(END_QUESTIONS.learned, roles));
    }
  });

  it("the phone's session wording follows the shared steps exactly", () => {
    expect(AFTERMATH_TEXT.map((t) => t.key)).toEqual(AFTERMATH_STEPS.map((s) => s.key));
    expect(STRESS_TEXT.map((t) => t.key)).toEqual(STRESS_REDUCING_STEPS.map((s) => s.key));
    expect(LISTENER_RULES_TEXT).toHaveLength(LISTENER_RULES.length);
  });

  it("no slash forms anywhere in the phone's own source strings", () => {
    const dir = path.resolve(__dirname, "../src");
    const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(ts|tsx)$/.test(f));
    for (const file of files) {
      const code = fs.readFileSync(path.join(dir, file), "utf8");
      for (const literal of code.match(/"[^"\n]*[א-ת][^"\n]*"/g) ?? []) {
        expect(hasSlashForm(literal), `${file}: ${literal}`).toBe(false);
      }
    }
  });
});

function coupleLog() {
  const log = new EventLog("t");
  log.append({ layer: "shared", author: "A", type: "couple-set", payload: { A: { name: "דנה", form: "f" }, B: { name: "יואב", form: "m" } } });
  return log;
}

describe("questions and layers", () => {
  it("no daily question repeats until the pool is used up", () => {
    const log = coupleLog();
    const seen = new Set<string>();
    const size = questionPool(1).length;
    for (let day = 1; day <= size; day++) {
      const ref = pickDailyQuestion(derive(log));
      const key = `${ref.deckId}#${ref.index}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      log.append({ layer: "shared", author: "A", type: "daily-chosen", payload: { day: `2026-01-${String(day).padStart(2, "0")}`, ...ref } });
    }
  });

  it("the next layer is offered after three uses, and opens only when both agree", () => {
    const log = coupleLog();
    for (let i = 0; i < 3; i++) {
      log.append({ layer: "shared", author: "A", type: "date-finished", payload: { id: String(i), deckIds: ["love-maps"], startedAt: "", endedAt: "", talkMinutes: 8, cardsTalked: 2, breaks: 0, shared: {} } });
    }
    expect(deeperLayerOffer(derive(log))).toBe(2);
    log.append({ layer: "shared", author: "A", type: "layer-consent", payload: { level: 2 } });
    expect(derive(log).unlockedLayer).toBe(1);
    log.append({ layer: "shared", author: "B", type: "layer-consent", payload: { level: 2 } });
    expect(derive(log).unlockedLayer).toBe(2);
  });

  it("answers stay private until revealed, then both show", () => {
    const log = coupleLog();
    const day = "2026-02-02";
    log.append({ layer: "shared", author: "A", type: "daily-chosen", payload: { day, deckId: "love-maps", index: 0 } });
    log.append({ layer: "private", author: "A", type: "answer-locked", payload: { day, text: "x" } });
    expect(log.missingFor({}).some((e) => e.type === "answer-locked")).toBe(false);
    log.append({ layer: "private", author: "B", type: "answer-locked", payload: { day, text: "y" } });
    log.append({ layer: "shared", author: "A", type: "answer-revealed", payload: { day, text: "x" } });
    log.append({ layer: "shared", author: "B", type: "answer-revealed", payload: { day, text: "y" } });
    expect(derive(log).days[day].revealed).toEqual({ A: "x", B: "y" });
  });
});

describe("no scores, no streaks, no pressure", () => {
  it("achievements are shared and descriptive", () => {
    const log = coupleLog();
    for (let i = 0; i < 10; i++) {
      log.append({ layer: "shared", author: "A", type: "date-finished", payload: { id: String(i), deckIds: ["fondness"], startedAt: "", endedAt: "", talkMinutes: 8, cardsTalked: 2, breaks: 0, shared: {} } });
    }
    const list = achievements(derive(log));
    expect(list).toContain("10 ערבים יחד");
    for (const a of list) {
      expect(a).not.toMatch(/רצף|ציון|נקוד|%|דנה|יואב|יותר מ|פחות מ/);
    }
  });

  it("notification texts never pressure", () => {
    const log = coupleLog();
    const day = "2026-03-03";
    const texts = [dailyNotificationText(derive(log), day)];
    log.append({ layer: "shared", author: "A", type: "daily-chosen", payload: { day, deckId: "love-maps", index: 0 } });
    log.append({ layer: "private", author: "A", type: "answer-locked", payload: { day, text: "x" } });
    const one = dailyNotificationText(derive(log), day);
    expect(one.body).toBe("דנה ענתה. יואב, היא מחכה לשמוע אותך.");
    texts.push(one);
    log.append({ layer: "private", author: "B", type: "answer-locked", payload: { day, text: "y" } });
    texts.push(dailyNotificationText(derive(log), day), weeklyStepText("ארוחת בוקר בלי טלפונים"));
    for (const t of texts) for (const word of PRESSURE_WORDS) expect(`${t.title} ${t.body}`).not.toContain(word);
  });

  it("the weekly step reminder is a week later at 21:00", () => {
    const at = weeklyStepTime(new Date(2026, 9, 27, 22, 15));
    expect([at.getDate(), at.getMonth(), at.getHours(), at.getMinutes()]).toEqual([3, 10, 21, 0]);
  });
});

describe("design tokens follow the website", () => {
  it("the phone palette uses the colors in DESIGN.md", () => {
    const design = fs.readFileSync(path.resolve(__dirname, "../../DESIGN.md"), "utf8");
    const css = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");
    for (const key of ["ink", "mineral-bg", "paper", "muted", "divider", "forest", "forest-deep", "forest-soft", "clay", "clay-soft", "honey"]) {
      const value = design.match(new RegExp(`\\n  ${key}: "(#[0-9a-f]{6})"`))?.[1];
      expect(value, key).toBeDefined();
      expect(css, key).toContain(`--${key}: ${value};`);
    }
    expect(css).toContain('font-family: "Rubik"');
    expect(css).toContain('font-family: "Heebo"');
  });
});
