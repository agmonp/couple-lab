import { describe, expect, it } from "vitest";
import pipeline from "./transcription-pipeline.cjs";

const {
  aggregateRecognitionQuality,
  recognitionQuality,
  removeRepeatedPrefix,
  vadCoverage,
  vadSegmentsToDecodeRanges
} = pipeline;

describe("local transcription pipeline helpers", () => {
  it("pads and merges nearby VAD speech without exceeding the audio", () => {
    const sampleRate = 100;
    const ranges = vadSegmentsToDecodeRanges([
      { start: 100, sampleCount: 100 },
      { start: 220, sampleCount: 100 }
    ], 500, { sampleRate, paddingSeconds: 0.2, maxDecodeSeconds: 10 });

    expect(ranges).toEqual([{
      startSample: 80,
      endSample: 340,
      speechStartSample: 100,
      speechEndSample: 320
    }]);
  });

  it("computes speech coverage from the unpadded union", () => {
    expect(vadCoverage([
      { start: 0, sampleCount: 200 },
      { start: 150, sampleCount: 150 }
    ], 1000, 100)).toEqual({
      audioDurationSeconds: 10,
      speechSeconds: 3,
      silenceSeconds: 7,
      speechCoverage: 0.3
    });
  });

  it("turns token log probabilities into an explicitly named proxy", () => {
    expect(recognitionQuality({
      tokens: ["a", "b"],
      timestamps: [0, 0.5],
      ys_log_probs: [Math.log(0.8), Math.log(0.6)]
    })).toEqual({
      averageLogProbability: -0.367,
      confidenceProxy: 0.6928,
      confidenceLevel: "medium",
      tokenCount: 2,
      timestampCount: 2
    });
    expect(recognitionQuality({ text: "שלום" }).confidenceLevel).toBe("unknown");
  });

  it("aggregates quality by token count", () => {
    const aggregate = aggregateRecognitionQuality([
      { averageLogProbability: Math.log(0.8), tokenCount: 3 },
      { averageLogProbability: Math.log(0.4), tokenCount: 1 }
    ]);
    expect(aggregate.tokenCount).toBe(4);
    expect(aggregate.confidenceLevel).toBe("medium");
    expect(aggregate.confidenceProxy).toBeCloseTo(0.6727, 4);
  });

  it("removes only an exact normalized boundary repetition", () => {
    expect(removeRepeatedPrefix("אני מקשיב לך עכשיו", "לך עכשיו, וזה חשוב")).toBe("וזה חשוב");
    expect(removeRepeatedPrefix("אני מקשיב", "אני רוצה לענות")).toBe("אני רוצה לענות");
  });
});

describe("decode-window merging", () => {
  const sampleRate = 16000;
  const segment = (startSeconds, durationSeconds) => ({
    start: Math.round(startSeconds * sampleRate),
    sampleCount: Math.round(durationSeconds * sampleRate)
  });

  it("merges utterances separated by a within-turn breath into one decode window", () => {
    // Silero splits on 0.55s of silence, so a natural conversation produces
    // many short segments. Decoded separately, Whisper gets no context and
    // pays a full encoder pass per fragment.
    const ranges = vadSegmentsToDecodeRanges(
      [segment(1, 4), segment(6, 1.5), segment(8, 2), segment(11, 2.5)],
      14 * sampleRate,
      { sampleRate }
    );
    expect(ranges).toHaveLength(1);
    const seconds = (ranges[0].endSample - ranges[0].startSample) / sampleRate;
    expect(seconds).toBeGreaterThan(12);
  });

  it("keeps a real turn change in separate windows", () => {
    const ranges = vadSegmentsToDecodeRanges(
      [segment(1, 5), segment(8.5, 5)],
      15 * sampleRate,
      { sampleRate }
    );
    expect(ranges).toHaveLength(2);
  });

  it("never merges past the decode ceiling", () => {
    const many = Array.from({ length: 20 }, (_, index) => segment(index * 3, 2.5));
    const ranges = vadSegmentsToDecodeRanges(many, 70 * sampleRate, { sampleRate, maxDecodeSeconds: 28 });
    expect(ranges.length).toBeGreaterThan(1);
    for (const range of ranges) {
      expect((range.endSample - range.startSample) / sampleRate).toBeLessThanOrEqual(28.1);
    }
  });

  it("respects an explicit bridge setting", () => {
    const strict = vadSegmentsToDecodeRanges(
      [segment(1, 2), segment(4, 2)],
      8 * sampleRate,
      { sampleRate, maxBridgedGapSeconds: 0 }
    );
    expect(strict).toHaveLength(2);
  });
});
