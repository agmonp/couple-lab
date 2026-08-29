import { describe, expect, it } from "vitest";
import { analyzeSession } from "./relationshipEngine";
import { defaultSignals } from "./data";
import type { LiveCue, TranscriptSegment, VisualObservation, VocalObservation } from "./types";

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

function vocal(label: VocalObservation["label"], seconds = 2): VocalObservation {
  return {
    id: `vocal-${label}-${seconds}`,
    seconds,
    label,
    subject: "A",
    score: 0.6,
    evidence: "בדיקה",
    provider: "local-prosody-v1"
  };
}

const richSegment = () =>
  segment("אני שומעת אותך וזה הגיוני לי תודה שסיפרת מה אתה צריך ממני עכשיו כדי שנרגיש קרובים");

describe("vocal observations in the analysis", () => {
  it("adds vocal cues to the timeline as descriptive nonverbal tags", () => {
    const result = analyzeSession(
      [richSegment()],
      defaultSignals,
      [],
      "daily-check-in",
      [],
      [vocal("raised-voice"), vocal("warm-engaged", 4)]
    );
    const vocalTags = result.tags.filter((tag) => tag.source === "vocal");
    expect(vocalTags.length).toBe(2);
    expect(vocalTags.every((tag) => tag.family === "nonverbal")).toBe(true);
  });

  it("counts vocal stress cues toward the descriptive nonverbal-stress metric", () => {
    const withVocal = analyzeSession(
      [richSegment()],
      defaultSignals,
      [],
      "daily-check-in",
      [],
      [vocal("raised-voice"), vocal("tense-voice", 4)]
    );
    const withoutVocal = analyzeSession([richSegment()], defaultSignals, [], "daily-check-in", [], []);
    expect(withVocal.metrics.nonverbalStressSignals).toBe(withoutVocal.metrics.nonverbalStressSignals + 2);
  });

  it("does not let a warm vocal tone inflate the connection score (a cue is not proof)", () => {
    const withWarmVoice = analyzeSession(
      [richSegment()],
      defaultSignals,
      [],
      "daily-check-in",
      [],
      [vocal("warm-engaged"), vocal("warm-engaged", 4)]
    );
    const baseline = analyzeSession([richSegment()], defaultSignals, [], "daily-check-in", [], []);
    expect(withWarmVoice.metrics.positiveSignals).toBe(baseline.metrics.positiveSignals);
    expect(withWarmVoice.metrics.connectionPracticeScore).toBe(baseline.metrics.connectionPracticeScore);
  });

  it("never raises flooding from vocal cues alone (product boundary)", () => {
    const result = analyzeSession(
      [richSegment()],
      defaultSignals,
      [],
      "daily-check-in",
      [],
      [vocal("raised-voice"), vocal("tense-voice", 4), vocal("long-pause", 6)]
    );
    expect(result.metrics.floodingRisk).toBeLessThan(58);
    expect(result.metrics.fourHorsemenSignals).toBe(0);
  });

  it("does not treat vocal cues as sufficient evidence on their own", () => {
    const result = analyzeSession([], defaultSignals, [], "daily-check-in", [], [vocal("raised-voice")]);
    expect(result.dataQuality?.status).toBe("insufficient");
  });
});
