import { describe, expect, it } from "vitest";
import { analyzeSession } from "./relationshipEngine";
import { defaultSignals } from "./data";
import type { LiveCue, TranscriptSegment, VisualObservation } from "./types";

function segment(text: string): TranscriptSegment {
  return {
    id: "segment-1",
    speaker: "A",
    target: "B",
    text,
    seconds: 0,
    endSeconds: 8,
    source: "manual",
    detectedLanguage: "he-IL",
    wordCount: text.split(/\s+/).length
  };
}

describe("analyzeSession data quality", () => {
  it("does not invent scores or strengths for an empty session", () => {
    const result = analyzeSession([], defaultSignals, [], "daily-check-in", []);
    expect(result.dataQuality?.status).toBe("insufficient");
    expect(result.metrics.connectionPracticeScore).toBe(0);
    expect(result.strengths).toEqual([]);
    expect(result.risks).toEqual([]);
  });

  it("keeps a very short note in insufficient-data state", () => {
    const result = analyzeSession([segment("אני כאן")], defaultSignals, [], "daily-check-in", []);
    expect(result.dataQuality?.status).toBe("insufficient");
    expect(result.metrics.connectionPracticeScore).toBe(0);
  });

  it("analyzes a sufficiently detailed Hebrew reflection", () => {
    const result = analyzeSession(
      [segment("אני שומעת אותך וזה הגיוני לי תודה שסיפרת מה אתה צריך ממני עכשיו")],
      defaultSignals,
      [],
      "daily-check-in",
      []
    );
    expect(result.dataQuality?.status).toBe("sufficient");
    expect(result.metrics.validationSignals).toBeGreaterThan(0);
    expect(result.summary).toContain("בשיחה הזו");
  });

  it("does not infer speaker balance from a whole-session transcript without diarization", () => {
    const unknownSpeaker = {
      ...segment("אני רוצה לספר מה עבר עלינו השבוע ולשמוע יחד מה היה חשוב לכל אחד מאיתנו בשיחה הזאת"),
      source: "speech" as const,
      speakerAttribution: "unknown" as const
    };
    const result = analyzeSession([unknownSpeaker], defaultSignals, [], "daily-check-in", []);

    expect(result.metrics.speakerAttributionReliable).toBe(false);
    expect(result.metrics.wordsA).toBe(0);
    expect(result.risks.some((risk) => risk.includes("זמן הדיבור"))).toBe(false);
  });

  it("treats attribution as reliable when most words have a known speaker", () => {
    const attributedA = {
      ...segment("אני רוצה לספר מה עבר עליי השבוע ולהסביר בפירוט מה היה חשוב לי בכל יום ויום"),
      id: "segment-a",
      source: "speech" as const,
      speakerAttribution: "automatic" as const
    };
    const attributedB = {
      ...segment("אני שומע אותך ורוצה להוסיף גם מה עבר עליי ומה הרגשתי במהלך הימים האלה יחד איתך"),
      id: "segment-b",
      speaker: "B" as const,
      target: "A" as const,
      source: "speech" as const,
      speakerAttribution: "automatic" as const
    };
    const shortUnknown = {
      ...segment("כן נכון"),
      id: "segment-c",
      source: "speech" as const,
      speakerAttribution: "unknown" as const
    };
    const result = analyzeSession([attributedA, attributedB, shortUnknown], defaultSignals, [], "daily-check-in", []);

    expect(result.metrics.speakerAttributionReliable).toBe(true);
    expect(result.metrics.wordsA).toBeGreaterThan(0);
    expect(result.metrics.wordsB).toBeGreaterThan(0);
  });

  it("keeps visual tension cues as context instead of declaring flooding or withdrawal", () => {
    const observations: VisualObservation[] = [0, 5, 10].map((seconds, index) => ({
      id: `visual-${index}`,
      seconds,
      label: index === 1 ? "closed-posture" : "brow-tension",
      subject: "A",
      score: 0.8,
      evidence: "geometric camera cue",
      provider: "mediapipe"
    }));
    const result = analyzeSession(
      [segment("אני רוצה להסביר מה חשוב לי ולשמוע גם מה חשוב לך כדי שנוכל להבין זה את זו")],
      defaultSignals,
      [],
      "daily-check-in",
      observations
    );

    expect(result.metrics.floodingRisk).toBeLessThan(58);
    expect(result.tags.some((tag) => tag.family === "flooding" || tag.label.toLowerCase().includes("withdrawal"))).toBe(false);
  });

  it("recommends a timed break only after an explicit overwhelm or pause cue", () => {
    const cues: LiveCue[] = [{ id: "pause-1", speaker: "A", tone: "pause", seconds: 8 }];
    const result = analyzeSession(
      [segment("אני מרגיש שאני צריך לעצור כדי שנוכל לחזור לשיחה הזאת בצורה טובה ומכבדת")],
      defaultSignals,
      cues,
      "conflict",
      []
    );

    expect(result.metrics.floodingRisk).toBeGreaterThan(58);
    expect(result.nextSteps.some((step) => step.includes("20 דקות"))).toBe(true);
  });
});
