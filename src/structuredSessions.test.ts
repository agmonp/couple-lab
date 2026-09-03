import { describe, expect, it } from "vitest";
import type { BodySignals, SafetyState, StructuredFlowRecord } from "./types";
import {
  AFTERMATH_DECK_ID,
  AFTERMATH_STEPS,
  FEELINGS_PALETTE,
  LISTENER_RULES,
  STRESS_REDUCING_DECK_ID,
  STRESS_REDUCING_STEPS,
  buildStructuredTags,
  evaluateAftermathGate,
  isStructuredDeck,
  structuredKindForDeck,
  structuredStepsForKind,
  summarizeStressChange
} from "./structuredSessions";

const calmSignals: BodySignals = { A: { stress: 3, relaxed: 7 }, B: { stress: 2, relaxed: 8 } };
const safeState: SafetyState = {
  fearOrCoercion: false,
  violenceOrThreats: false,
  pressuredToParticipate: false,
  seriousDepressionOrAddiction: false
};
const nameFor = (partner: "A" | "B") => (partner === "A" ? "דנה" : "יואב");

describe("deck ↔ kind mapping", () => {
  it("maps the two structured deck ids", () => {
    expect(structuredKindForDeck(AFTERMATH_DECK_ID)).toBe("aftermath");
    expect(structuredKindForDeck(STRESS_REDUCING_DECK_ID)).toBe("stress-reducing");
    expect(isStructuredDeck(AFTERMATH_DECK_ID)).toBe(true);
  });

  it("returns null for ordinary or missing decks", () => {
    expect(structuredKindForDeck("love-maps")).toBeNull();
    expect(structuredKindForDeck(undefined)).toBeNull();
    expect(isStructuredDeck("repair")).toBe(false);
  });
});

describe("blueprints", () => {
  it("aftermath has five sequential steps starting with self-report feelings", () => {
    expect(structuredStepsForKind("aftermath")).toHaveLength(5);
    expect(AFTERMATH_STEPS[0].key).toBe("feelings");
    expect(AFTERMATH_STEPS.map((step) => step.key)).toEqual([
      "feelings",
      "realities",
      "triggers",
      "ownership",
      "plan"
    ]);
    expect(FEELINGS_PALETTE.length).toBeGreaterThanOrEqual(8);
  });

  it("stress-reducing has two symmetric turns and five listener rules", () => {
    expect(structuredStepsForKind("stress-reducing")).toHaveLength(2);
    expect(STRESS_REDUCING_STEPS.every((step) => step.turnModel === "listener-support")).toBe(true);
    expect(LISTENER_RULES).toHaveLength(5);
  });
});

describe("evaluateAftermathGate", () => {
  it("allows a calm, safe couple", () => {
    const result = evaluateAftermathGate({ signals: calmSignals, safety: safeState });
    expect(result.allowed).toBe(true);
    expect(result.blockingReason).toBeUndefined();
    expect(result.cautionReason).toBeUndefined();
  });

  it("hard-blocks on any safety flag", () => {
    (
      ["fearOrCoercion", "violenceOrThreats", "pressuredToParticipate", "seriousDepressionOrAddiction"] as const
    ).forEach((flag) => {
      const result = evaluateAftermathGate({ signals: calmSignals, safety: { ...safeState, [flag]: true } });
      expect(result.allowed).toBe(false);
      expect(result.blockingReason).toBeTruthy();
    });
  });

  it("allows but cautions when either partner's stress is still high", () => {
    const result = evaluateAftermathGate({
      signals: { A: { stress: 3, relaxed: 7 }, B: { stress: 8, relaxed: 2 } },
      safety: safeState
    });
    expect(result.allowed).toBe(true);
    expect(result.cautionReason).toContain("לחץ");
  });
});

describe("buildStructuredTags", () => {
  it("produces one conversation-structure tag per step with rounded seconds and step metadata", () => {
    const flow: StructuredFlowRecord = {
      kind: "aftermath",
      steps: [
        { key: "feelings", title: "רגשות — מה הרגשתי", startSeconds: 0.4, endSeconds: 30.6 },
        { key: "realities", title: "המציאות של כל אחד", startSeconds: 30.6, speaker: "B" }
      ]
    };
    const tags = buildStructuredTags(flow);
    expect(tags).toHaveLength(2);
    expect(tags.every((tag) => tag.family === "conversation-structure" && tag.source === "derived")).toBe(true);
    expect(tags[0].seconds).toBe(0);
    expect(tags[0].endSeconds).toBe(31);
    expect(tags[0].metadata?.step).toBe("feelings");
    expect(tags[0].metadata?.kind).toBe("aftermath");
    expect(tags[1].speaker).toBe("B");
    expect(tags[1].endSeconds).toBeUndefined();
    expect(tags[0].confidence).toBe(1);
  });
});

describe("summarizeStressChange", () => {
  it("describes the per-partner change factually", () => {
    const line = summarizeStressChange({ A: 7, B: 6 }, { A: 4, B: 6 }, nameFor);
    expect(line).toContain("דנה");
    expect(line).toContain("מ-7 ל-4");
    expect(line).toContain("יואב");
    expect(line).toContain("נשאר דומה");
  });

  it("returns null when there is nothing to compare", () => {
    expect(summarizeStressChange(undefined, { A: 4 }, nameFor)).toBeNull();
    expect(summarizeStressChange({ A: 7 }, {}, nameFor)).toBeNull();
  });
});
