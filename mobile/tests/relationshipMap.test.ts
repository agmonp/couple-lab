import { describe, expect, it } from "vitest";
import { EventLog } from "../src/core/events";
import { derive } from "../src/core/model";
import { MAP_DOMAINS, type MapScores, activeRound, focusDomains, mapDone, mapOpen, practiceFor, seenDifferently } from "../src/core/relationshipMap";
import { openDecks } from "../src/core/questions";
import { attachSync, createInMemoryPair } from "../src/core/transport";

const ROUND = "2026-10";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const all = (n: number): MapScores => Object.fromEntries(MAP_DOMAINS.map((d) => [d.key, n]));

describe("relationship map: focus", () => {
  it("picks the three lowest shared averages, wider gap first on a tie", () => {
    const a = { ...all(8), conflict: 3, repair: 4, flooding: 5, teamwork: 2 };
    const b = { ...all(8), conflict: 3, repair: 2, flooding: 1, teamwork: 4 };
    // conflict 3 (gap 0), repair 3 (gap 2), flooding 3 (gap 4), teamwork 3 (gap 2)
    const keys = focusDomains(a, b).map((f) => f.domain.key);
    expect(keys[0]).toBe("flooding");
    expect(keys).toHaveLength(3);
    expect(keys).not.toContain("conflict");
  });

  it("marks a gap of 3 or more as seen differently, without saying who", () => {
    const a = { ...all(7), safety: 2 };
    const b = { ...all(7), safety: 6, meaning: 3 };
    const focus = focusDomains(a, b);
    expect(focus.find((f) => f.domain.key === "safety")?.differently).toBe(true);
    // Outside the three: nothing left that differs by 3+ once meaning and safety are in focus.
    expect(seenDifferently(a, b, focus.map((f) => f.domain.key))).toEqual([]);
    expect(JSON.stringify(focus)).not.toMatch(/"A"|"B"/);
  });

  it("only suggests decks the couple has opened", () => {
    expect(practiceFor("conflict", ["love-maps"])).toEqual({ kind: "structured", session: "aftermath" });
    expect(practiceFor("friendship", ["love-maps"])).toEqual({ kind: "deck", deckId: "love-maps" });
    expect(practiceFor("fondness", [])).toEqual({ kind: "jar" });
    // Layer 1 is always open: every domain has somewhere to go from the first day.
    const first = openDecks(1).map((d) => d.id);
    for (const d of MAP_DOMAINS) expect(practiceFor(d.key, first), d.key).not.toBeUndefined();
  });
});

describe("relationship map: privacy and opening together", () => {
  it("one phone: locked maps open only through map-revealed", () => {
    const log = new EventLog("phone");
    log.append({ layer: "private", author: "A", type: "map-locked", payload: { round: ROUND, scores: all(6) } });
    log.append({ layer: "private", author: "B", type: "map-locked", payload: { round: ROUND, scores: all(4) } });
    let r = derive(log).maps[ROUND];
    expect(mapDone(r, "A") && mapDone(r, "B")).toBe(true);
    expect(mapOpen(r)).toBe(false);
    for (const who of ["A", "B"] as const) log.append({ layer: "shared", author: who, type: "map-revealed", payload: { round: ROUND, scores: r.locked[who] } });
    const state = derive(log);
    r = state.maps[ROUND];
    expect(mapOpen(r)).toBe(true);
    expect(state.timeline.filter((t) => t.kind === "map")).toHaveLength(1);
  });

  it("two phones: only 'done' crosses before both agree; scores and safety never cross early", async () => {
    const a = new EventLog("phone-a");
    const b = new EventLog("phone-b");
    const [ta, tb] = createInMemoryPair();
    const sa = attachSync(a, ta);
    const sb = attachSync(b, tb);
    const meet = async () => {
      await sa.announce();
      await sb.announce();
      await flush();
      await flush();
    };
    a.append({ layer: "private", author: "A", type: "map-locked", payload: { round: ROUND, scores: all(9) } });
    a.append({ layer: "private", author: "A", type: "safety-check", payload: { round: ROUND, flags: ["pressuredToParticipate"] } });
    a.append({ layer: "shared", author: "A", type: "map-ready", payload: { round: ROUND } });
    await meet();
    const onB = derive(b).maps[ROUND];
    expect(onB.ready.A).toBe(true);
    expect(onB.locked.A).toBeUndefined();
    expect(b.all().some((e) => e.type === "safety-check" || e.type === "map-locked")).toBe(false);
    expect(JSON.stringify(b.toJSON())).not.toContain("pressuredToParticipate");

    b.append({ layer: "private", author: "B", type: "map-locked", payload: { round: ROUND, scores: all(5) } });
    b.append({ layer: "shared", author: "B", type: "map-ready", payload: { round: ROUND } });
    a.append({ layer: "shared", author: "A", type: "map-consent", payload: { round: ROUND } });
    b.append({ layer: "shared", author: "B", type: "map-consent", payload: { round: ROUND } });
    await meet();
    // The store's step: each phone opens its own person's map once both consented.
    for (const [log, me] of [[a, "A"], [b, "B"]] as const) {
      const r = derive(log).maps[ROUND];
      expect(r.consent.A && r.consent.B).toBe(true);
      log.append({ layer: "shared", author: me, type: "map-revealed", payload: { round: ROUND, scores: r.locked[me] } });
    }
    await meet();
    expect(mapOpen(derive(a).maps[ROUND])).toBe(true);
    expect(derive(b).maps[ROUND].revealed.A).toEqual(all(9));
  });

  it("a started round stays active after the month turns", () => {
    const log = new EventLog("phone");
    log.append({ layer: "private", author: "A", type: "map-locked", payload: { round: ROUND, scores: all(6) } });
    expect(activeRound(derive(log), new Date(2026, 10, 3)).round).toBe(ROUND);
    expect(activeRound(derive(new EventLog("x")), new Date(2026, 10, 3)).round).toBe("2026-11");
  });
});
