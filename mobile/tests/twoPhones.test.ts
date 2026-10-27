import { describe, expect, it } from "vitest";
import { EventLog } from "../src/core/events";
import { answered, bothRevealed, derive } from "../src/core/model";
import { pickDailyQuestion, seededRandom } from "../src/core/questions";
import { attachSync, createInMemoryPair } from "../src/core/transport";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const DAY = "2026-10-27";
const COUPLE = { A: { name: "מאיה", form: "f" }, B: { name: "עידו", form: "m" } };

/** Two paired phones: Maya (A) holds phone-a, Ido (B) holds phone-b. */
async function pairOf() {
  const a = new EventLog("phone-a");
  const b = new EventLog("phone-b");
  a.append({ layer: "shared", author: "A", type: "couple-set", payload: COUPLE });
  const [ta, tb] = createInMemoryPair();
  const sa = attachSync(a, ta);
  const sb = attachSync(b, tb);
  const meet = async () => {
    await sa.announce();
    await sb.announce();
    await flush();
    await flush();
  };
  await meet();
  return { a, b, ta, tb, meet };
}

/** What the store does when a person locks today's answer on their own phone. */
function lock(log: EventLog, who: "A" | "B", text: string, guess?: string) {
  log.append({ layer: "private", author: who, type: "answer-locked", payload: { day: DAY, text, guess } });
  log.append({ layer: "shared", author: who, type: "answer-ready", payload: { day: DAY } });
}

/** The store's reveal step: once both agreed, each phone opens its own person's answer. */
function openOwn(log: EventLog, me: "A" | "B") {
  const d = derive(log).days[DAY];
  if (d.consent.A && d.consent.B && d.locked[me] !== undefined && d.revealed[me] === undefined) {
    log.append({ layer: "shared", author: me, type: "answer-revealed", payload: { day: DAY, text: d.locked[me], guess: d.lockedGuess[me] } });
  }
}

describe("two phones: the daily question", () => {
  it("only 'answered' crosses before the reveal, and the texts cross only after both agreed", async () => {
    const { a, b, ta, tb, meet } = await pairOf();
    expect(derive(b).couple?.A.name).toBe("מאיה");

    lock(a, "A", "a walk by the sea", "cooking");
    lock(b, "B", "cooking together", "a walk");
    await meet();

    const onB = derive(b).days[DAY];
    expect(answered(onB, "A")).toBe(true);
    expect(onB.locked.A).toBeUndefined();
    let wire = JSON.stringify([...ta.sent, ...tb.sent]);
    expect(wire).not.toContain("a walk by the sea");
    expect(wire).not.toContain("cooking together");

    // Maya agrees; Ido has not yet. Nothing opens.
    a.append({ layer: "shared", author: "A", type: "reveal-consent", payload: { day: DAY } });
    openOwn(a, "A");
    await meet();
    openOwn(b, "B");
    wire = JSON.stringify([...ta.sent, ...tb.sent]);
    expect(wire).not.toContain("a walk by the sea");
    expect(bothRevealed(derive(b).days[DAY])).toBe(false);

    // Ido agrees too: each phone opens its own answer, and they cross.
    b.append({ layer: "shared", author: "B", type: "reveal-consent", payload: { day: DAY } });
    openOwn(b, "B");
    await meet();
    openOwn(a, "A");
    await meet();

    for (const log of [a, b]) {
      const d = derive(log).days[DAY];
      expect(bothRevealed(d)).toBe(true);
      expect(d.revealed).toEqual({ A: "a walk by the sea", B: "cooking together" });
      expect(d.guesses).toEqual({ A: "cooking", B: "a walk" });
    }
  });

  it("jar notes reach the other phone; private reflections never do", async () => {
    const { a, b, meet } = await pairOf();
    a.append({ layer: "shared", author: "A", type: "jar-note", payload: { id: "n1", to: "B", text: "the coffee" } });
    a.append({ layer: "private", author: "A", type: "date-private-reflection", payload: { dateId: "d1", reflection: { good: "kept" } } });
    await meet();
    const jar = derive(b).jar;
    expect(jar.map((n) => [n.from, n.to, n.text])).toEqual([["A", "B", "the coffee"]]);
    expect(b.all().some((e) => e.type === "date-private-reflection")).toBe(false);

    b.append({ layer: "shared", author: "B", type: "jar-opened", payload: { id: "n1" } });
    await meet();
    expect(derive(a).jar[0].openedAt).toBeDefined();
  });

  it("paired phones pick the same daily question apart", async () => {
    const { a, b } = await pairOf();
    const seed = `2026-10-01T10:00:00Z|${DAY}|daily`;
    const onA = pickDailyQuestion(derive(a), { random: seededRandom(seed) });
    const onB = pickDailyQuestion(derive(b), { random: seededRandom(seed) });
    expect(onA).toEqual(onB);
  });
});
