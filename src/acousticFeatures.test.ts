import { describe, expect, it } from "vitest";
import { addTranscriptRate, analyzeAcousticFeatures } from "./acousticFeatures";

const SAMPLE_RATE = 16000;

function tone(seconds: number, amplitude: number, frequency = 190) {
  return Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, index) =>
    amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE)
  );
}

function silence(seconds: number) {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE));
}

function join(...parts: Float32Array[]) {
  const result = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

describe("analyzeAcousticFeatures", () => {
  it("finds speech-like activity, a long pause and a relative level change", () => {
    const metrics = analyzeAcousticFeatures(
      join(silence(0.6), tone(2, 0.05), silence(1.6), tone(2, 0.2), silence(0.4)),
      SAMPLE_RATE
    );

    expect(metrics.durationSeconds).toBeCloseTo(6.6, 1);
    expect(metrics.speechIntervalCount).toBe(2);
    expect(metrics.speechSeconds).toBeGreaterThan(3.7);
    expect(metrics.longPauseCount).toBe(1);
    expect(metrics.longestPauseSeconds).toBeGreaterThan(1.4);
    expect(metrics.relativeLevelShiftCount).toBeGreaterThanOrEqual(1);
    expect(metrics.quality.status).toBe("usable");
  });

  it("marks silence as insufficient instead of inventing speech", () => {
    const metrics = analyzeAcousticFeatures(silence(3), SAMPLE_RATE);
    expect(metrics.speechSeconds).toBe(0);
    expect(metrics.speechIntervalCount).toBe(0);
    expect(metrics.quality.status).toBe("insufficient");
  });

  it("derives a transcript pace only when speech and words exist", () => {
    const metrics = analyzeAcousticFeatures(join(silence(0.5), tone(3, 0.1), silence(0.5)), SAMPLE_RATE);
    expect(addTranscriptRate(metrics, 12).estimatedWordsPerMinute).toBeGreaterThan(200);
    expect(addTranscriptRate(metrics, 0).estimatedWordsPerMinute).toBeUndefined();
  });
});
