import { describe, expect, it } from "vitest";
import { BREAK_SECONDS } from "@shared/practiceTiming";
import { type DateAction, type DateState, currentSpeaker, dateReducer, startDate } from "../src/core/dateFlow";
import { FaceDownDetector } from "../src/core/faceDown";
import { HAPTICS, patternDuration } from "../src/core/haptics";

const cards = [{ deckId: "love-maps", index: 0 }, { deckId: "love-maps", index: 1 }];
const TURN = 120_000;

function play(state: DateState, actions: DateAction[]) {
  const haptics: string[] = [];
  for (const action of actions) {
    const step = dateReducer(state, action);
    state = step.state;
    haptics.push(...step.effects.map((e) => e.haptic));
  }
  return { state, haptics };
}

describe("date flow", () => {
  it("starts only when the phone is placed down", () => {
    const s = startDate(cards, "A");
    expect(s.phase).toBe("waiting-down");
    expect(dateReducer(s, { type: "tick", now: 10 ** 9 }).state.phase).toBe("waiting-down");
    expect(dateReducer(s, { type: "placed-down", now: 0 }).state.phase).toBe("running");
  });

  it("two turns per card with one long buzz between, speakers swap", () => {
    const { state, haptics } = play(startDate(cards, "A"), [
      { type: "placed-down", now: 0 },
      { type: "tick", now: TURN }
    ]);
    expect(haptics).toEqual(["turnEnd"]);
    expect(state.phase).toBe("running");
    expect(currentSpeaker(state)).toBe("B");
    const end = play(state, [{ type: "tick", now: TURN * 2 }]);
    expect(end.state.phase).toBe("card-done");
    expect(end.state.cardsTalked).toBe(1);
  });

  it("the next card opens with the other partner", () => {
    const { state } = play(startDate(cards, "A"), [
      { type: "placed-down", now: 0 },
      { type: "tick", now: TURN },
      { type: "tick", now: TURN * 2 },
      { type: "next-card" }
    ]);
    expect(state.cardIndex).toBe(1);
    expect(currentSpeaker(state)).toBe("B");
  });

  it("picking the phone up pauses without losing time, putting it down resumes", () => {
    const { state } = play(startDate(cards, "A"), [
      { type: "placed-down", now: 0 },
      { type: "picked-up", now: 30_000 },
      { type: "tick", now: 500_000 }
    ]);
    expect(state.phase).toBe("paused");
    expect(state.remainingMs).toBe(90_000);
    const resumed = play(state, [{ type: "placed-down", now: 600_000 }, { type: "tick", now: 600_000 + 89_000 }]);
    expect(resumed.state.phase).toBe("running");
    expect(resumed.haptics).toEqual([]);
    expect(play(resumed.state, [{ type: "tick", now: 690_000 }]).haptics).toEqual(["turnEnd"]);
  });

  it("the last card ends with three short buzzes", () => {
    const { state, haptics } = play(startDate(cards.slice(0, 1), "A"), [
      { type: "placed-down", now: 0 },
      { type: "tick", now: TURN },
      { type: "tick", now: TURN * 2 }
    ]);
    expect(state.phase).toBe("ended");
    expect(haptics).toEqual(["turnEnd", "dateEnd"]);
    expect(state.talkMs).toBe(TURN * 2);
  });

  it("a break lasts 20 minutes and ends only when both are ready", () => {
    const { state, haptics } = play(startDate(cards, "A"), [
      { type: "placed-down", now: 0 },
      { type: "start-break", now: 50_000 }
    ]);
    expect(haptics).toEqual(["breakStart"]);
    expect(state.phase).toBe("break");
    expect(state.breakReturnAt).toBe(50_000 + BREAK_SECONDS * 1000);
    const one = play(state, [{ type: "ready", partner: "A" }]);
    expect(one.state.phase).toBe("break");
    const both = play(one.state, [{ type: "ready", partner: "B" }]);
    expect(both.state.phase).toBe("paused");
    expect(both.state.remainingMs).toBe(70_000);
    expect(both.state.breaks).toBe(1);
  });

  it("a break taken while paused returns to the same paused turn", () => {
    const { state } = play(startDate(cards, "A"), [
      { type: "placed-down", now: 0 },
      { type: "picked-up", now: 3_000 },
      { type: "start-break", now: 4_000 },
      { type: "ready", partner: "B" },
      { type: "ready", partner: "A" }
    ]);
    expect(state.phase).toBe("paused");
    expect(state.remainingMs).toBe(117_000);
  });

  it("ending early counts the card that was talked", () => {
    const { state } = play(startDate(cards, "A"), [{ type: "placed-down", now: 0 }, { type: "end", now: 40_000 }]);
    expect(state.phase).toBe("ended");
    expect(state.cardsTalked).toBe(1);
    expect(state.talkMs).toBe(40_000);
  });
});

describe("face-down detector", () => {
  it("needs a steady face-down before it fires, and ignores a wobble", () => {
    const d = new FaceDownDetector();
    expect(d.push({ x: 0, y: 0, z: -9.7, t: 0 })).toBeNull();
    expect(d.push({ x: 0, y: 0, z: 2, t: 600 })).toBeNull(); // wobble resets
    expect(d.push({ x: 0, y: 0, z: -9.7, t: 700 })).toBeNull();
    expect(d.push({ x: 0.2, y: 0.1, z: -9.6, t: 1950 })).toBe("down");
    expect(d.push({ x: 0, y: 0, z: -9.7, t: 2500 })).toBeNull();
  });

  it("lifting reads as up after half a second; tilted is not face down", () => {
    const d = new FaceDownDetector();
    d.push({ x: 0, y: 0, z: -9.8, t: 0 });
    d.push({ x: 0, y: 0, z: -9.8, t: 1300 });
    expect(d.orientation).toBe("down");
    expect(d.push({ x: 0, y: 6, z: 7, t: 2000 })).toBeNull();
    expect(d.push({ x: 0, y: 6, z: 7, t: 2600 })).toBe("up");
    const tilted = new FaceDownDetector();
    tilted.push({ x: 6, y: 0, z: -8.5, t: 0 });
    expect(tilted.push({ x: 6, y: 0, z: -8.5, t: 2000 })).toBeNull();
  });
});

describe("haptic language", () => {
  it("has the four patterns of the plan, each distinct and short", () => {
    expect(Object.keys(HAPTICS).sort()).toEqual(["breakStart", "breatheIn", "dateEnd", "turnEnd"]);
    for (const name of Object.keys(HAPTICS) as (keyof typeof HAPTICS)[]) {
      expect(HAPTICS[name].timings.length).toBe(HAPTICS[name].amplitudes.length);
      expect(patternDuration(name)).toBeLessThanOrEqual(4000);
    }
    const ons = (name: keyof typeof HAPTICS) => HAPTICS[name].amplitudes.filter((a) => a > 0).length;
    expect(ons("turnEnd")).toBe(1);
    expect(ons("breakStart")).toBe(2);
    expect(ons("dateEnd")).toBe(3);
  });
});
