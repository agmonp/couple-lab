import { describe, expect, it } from "vitest";
import { canTransitionPractice, sessionEvidenceSummary } from "./sessionFlow";

describe("practice flow", () => {
  it("allows only declared state transitions", () => {
    expect(canTransitionPractice("setup", "requesting-permission")).toBe(true);
    expect(canTransitionPractice("recording", "ready")).toBe(false);
    expect(canTransitionPractice("saving", "analyzing")).toBe(true);
  });

  it("rejects an empty evidence set", () => {
    expect(sessionEvidenceSummary({ segments: [], cues: [], observations: [] }).sufficient).toBe(false);
  });

  it("does not treat camera coverage samples as behavioral evidence", () => {
    const result = sessionEvidenceSummary({
      segments: [{ id: "segment", speaker: "A", text: "אחד שתיים שלוש ארבע חמש שש", seconds: 0, source: "manual" }],
      cues: [],
      observations: [{ id: "quality", seconds: 0, label: "capture-quality", score: 1, evidence: "two faces visible" }]
    });

    expect(result).toMatchObject({ sufficient: false, observations: 0, evidenceCount: 6 });
  });
});
