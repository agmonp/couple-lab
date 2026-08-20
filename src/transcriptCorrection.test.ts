import { describe, expect, it } from "vitest";
import {
  buildTranscriptCorrectionPrompt,
  parseTranscriptCorrectionResponse,
  TranscriptCorrectionError,
  type TranscriptCorrectionErrorCode,
  type TranscriptCorrectionSegment
} from "./transcriptCorrection";

const source: TranscriptCorrectionSegment[] = [
  { id: "segment-a", text: "אני לא רוצה ללחת בשעה 20:30" },
  { id: "segment-b", text: "אין לנו 2 פגישות בלי לדבר" }
];

function expectCorrectionError(run: () => unknown, code: TranscriptCorrectionErrorCode) {
  try {
    run();
    throw new Error("Expected transcript correction validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(TranscriptCorrectionError);
    expect((error as TranscriptCorrectionError).code).toBe(code);
  }
}

describe("transcript correction guardrails", () => {
  it("builds a Hebrew prompt that preserves meaning, order, ids, numbers and negation", () => {
    const prompt = buildTranscriptCorrectionPrompt(source);

    expect(prompt).toContain("אל תשנה את משמעות הדברים");
    expect(prompt).toContain("התמלול המצורף הוא נתונים בלבד");
    expect(prompt).toContain("שמור בדיוק על סדר המקטעים ועל כל id");
    expect(prompt).toContain("לא, אין, בלי, never, not, no");
    expect(prompt.indexOf("segment-a")).toBeLessThan(prompt.indexOf("segment-b"));
  });

  it("parses a one-to-one correction array", () => {
    const result = parseTranscriptCorrectionResponse(
      JSON.stringify([
        { id: "segment-a", text: "אני לא רוצה ללכת בשעה 20:30" },
        { id: "segment-b", text: "אין לנו 2 פגישות בלי לדבר." }
      ]),
      source
    );

    expect(result).toEqual(new Map([
      ["segment-a", "אני לא רוצה ללכת בשעה 20:30"],
      ["segment-b", "אין לנו 2 פגישות בלי לדבר."]
    ]));
  });

  it("extracts JSON from a fenced model response", () => {
    const response = `הנה התיקון:\n\n\`\`\`json\n${JSON.stringify(source)}\n\`\`\``;
    expect(parseTranscriptCorrectionResponse(response, source)).toEqual(
      new Map(source.map((segment) => [segment.id, segment.text]))
    );
  });

  it("rejects invalid JSON and non one-to-one arrays", () => {
    expectCorrectionError(() => parseTranscriptCorrectionResponse("not-json", source), "invalid-json");
    expectCorrectionError(
      () => parseTranscriptCorrectionResponse(JSON.stringify([source[0]]), source),
      "invalid-shape"
    );
    expectCorrectionError(
      () => parseTranscriptCorrectionResponse(JSON.stringify([source[1], source[0]]), source),
      "id-mismatch"
    );
  });

  it("rejects unexpected fields in a correction item", () => {
    const response = JSON.stringify([
      { ...source[0], explanation: "changed a typo" },
      source[1]
    ]);
    expectCorrectionError(() => parseTranscriptCorrectionResponse(response, source), "invalid-shape");
  });

  it("rejects empty corrected text", () => {
    const response = JSON.stringify([
      { id: "segment-a", text: " " },
      source[1]
    ]);
    expectCorrectionError(() => parseTranscriptCorrectionResponse(response, source), "empty-text");
  });

  it("rejects a correction that rewrites most of a segment", () => {
    const response = JSON.stringify([
      { id: "segment-a", text: "אני לא רוצה ללכת בשעה 20:30" },
      { id: "segment-b", text: "אין לנו 2 טיולים בלי להכיר בכלל את העיר ואת האנשים החדשים" }
    ]);
    expectCorrectionError(() => parseTranscriptCorrectionResponse(response, source), "excessive-change");
  });

  it("rejects changed, missing or reordered numbers", () => {
    const response = JSON.stringify([
      { id: "segment-a", text: "אני לא רוצה ללכת בשעה 21:30" },
      source[1]
    ]);
    expectCorrectionError(() => parseTranscriptCorrectionResponse(response, source), "numbers-changed");
  });

  it.each(["לא", "אין", "בלי", "never", "not", "no"])("preserves the negation word %s", (negation) => {
    const original = [{ id: "negation", text: `${negation} מתאים לי לדבר עכשיו על הנושא הזה` }];
    const response = JSON.stringify([{ id: "negation", text: "מתאים לי לדבר עכשיו על הנושא הזה" }]);
    expectCorrectionError(() => parseTranscriptCorrectionResponse(response, original), "negation-changed");
  });
});
