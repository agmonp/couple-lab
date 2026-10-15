import { describe, expect, it } from "vitest";
import pipeline from "./transcription-pipeline.cjs";

const {
  aggregateRecognitionQuality,
  isHallucination,
  keepWhisperSegment,
  recognitionQuality,
  removeRepeatedPrefix,
  uncoveredGaps,
  vadCoverage,
  vadSegmentsToDecodeRanges,
  vadSegmentsToWordWindows,
  vadView,
  whisperWindowsToSegments
} = pipeline;

const whisperSegment = (words, extra = {}) => ({
  text: words.map((word) => word[2]).join(" "),
  avgLogprob: -0.2,
  noSpeechProb: 0.01,
  tokenCount: words.length + 2,
  words,
  ...extra
});

describe("lessons ported from Shema ASR 2.0", () => {
  it("raises quiet audio for the VAD only, capped at 30 dB", () => {
    const quiet = new Float32Array([0.001, -0.002, 0.0005]);
    const view = vadView(quiet);
    expect(view[1]).toBeCloseTo(-0.002 * 10 ** 1.5, 6);
    expect(quiet[1]).toBe(Math.fround(-0.002));
    const loud = vadView(new Float32Array([0.1, -0.25]));
    expect(loud[1]).toBeCloseTo(-0.5, 6);
    const silence = new Float32Array(4);
    expect(vadView(silence)).toBe(silence);
  });

  it("joins close speech, pads 0.5 s and splits long stretches into overlapping 20 s windows", () => {
    const sampleRate = 100;
    const windows = vadSegmentsToWordWindows([
      { start: 100, sampleCount: 100 },   // 1-2 s
      { start: 250, sampleCount: 100 },   // 2.5-3.5 s, gap 0.5 s -> joined
      { start: 1000, sampleCount: 4500 }  // 10-55 s -> three pieces
    ], 6000, { sampleRate });
    expect(windows[0]).toMatchObject({ startSample: 50, endSample: 400, ownStartSeconds: 0, ownEndSeconds: 6.75 });
    expect(windows.slice(1).map((window) => [window.speechStartSample, window.speechEndSample]))
      .toEqual([[1000, 3000], [2800, 4800], [4600, 5500]]);
    // The overlap is owned half by each piece, so no word is stored twice.
    expect(windows[1].ownEndSeconds).toBe(29);
    expect(windows[2].ownStartSeconds).toBe(29);
    expect(windows[3].ownEndSeconds).toBe(60);
  });

  it("finds the silent stretches for the second, locally normalised VAD pass", () => {
    expect(uncoveredGaps([
      { start: 200, sampleCount: 100 },
      { start: 250, sampleCount: 100 },
      { start: 400, sampleCount: 100 }
    ], 1000, 100)).toEqual([
      { startSample: 0, endSample: 200 },
      { startSample: 500, endSample: 1000 }
    ]);
    expect(uncoveredGaps([], 50, 100)).toEqual([]);
  });

  it("drops the subtitle-credit hallucinations and low-confidence segments", () => {
    expect(isHallucination("תודה רבה.")).toBe(true);
    expect(isHallucination("Thanks for watching!")).toBe(true);
    expect(isHallucination("תודה רבה שבאת")).toBe(false);
    expect(keepWhisperSegment(whisperSegment([[0, 1, "שלום"]]))).toBe(true);
    expect(keepWhisperSegment(whisperSegment([[0, 1, "שלום"]], { noSpeechProb: 0.7 }))).toBe(false);
    expect(keepWhisperSegment(whisperSegment([[0, 1, "שלום"]], { avgLogprob: -1.5 }))).toBe(false);
  });

  it("keeps each word once across overlapping windows", () => {
    const windows = [
      { ownStartSeconds: 0, ownEndSeconds: 29 },
      { ownStartSeconds: 29, ownEndSeconds: 60 }
    ];
    const decoded = [
      { segments: [whisperSegment([[27, 27.8, "אני"], [28.6, 29.2, "חושבת"], [29.3, 29.9, "שכן"]])] },
      { segments: [whisperSegment([[28.62, 29.18, "חושבת"], [29.3, 29.9, "שכן"], [30, 30.5, "לגמרי"]])] }
    ];
    const lines = whisperWindowsToSegments(windows, decoded);
    expect(lines.map((line) => line.text).join(" ")).toBe("אני חושבת שכן לגמרי");
    expect(lines[0]).toMatchObject({ startSeconds: 27, endSeconds: 29.2 });
    expect(lines[0].quality.confidenceLevel).toBe("high");
  });
});

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
