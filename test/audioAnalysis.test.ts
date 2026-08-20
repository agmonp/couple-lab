import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  SpeakerBaseline,
  computeRms,
  detectPitchHz,
  interpretVocalState,
  rmsToDb,
  summarizeFrames,
  type VocalFrame
} from "../src/audioAnalysis.ts";

const SAMPLE_RATE = 44100;

/** A pure sine wave at a known frequency, for pitch-detection checks. */
function sine(freqHz: number, amplitude = 0.5, length = 2048): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE);
  }
  return out;
}

function frames(spec: Array<Partial<VocalFrame>>): VocalFrame[] {
  return spec.map((frame) => ({ rms: frame.rms ?? 0, pitchHz: frame.pitchHz ?? null }));
}

describe("computeRms", () => {
  test("is zero for silence", () => {
    assert.equal(computeRms(new Float32Array(1024)), 0);
  });

  test("orders louder above quieter", () => {
    assert.ok(computeRms(sine(150, 0.8)) > computeRms(sine(150, 0.2)));
  });

  test("matches the known RMS of a sine (amplitude / sqrt 2)", () => {
    const rms = computeRms(sine(150, 1));
    assert.ok(Math.abs(rms - 1 / Math.SQRT2) < 0.02);
  });
});

describe("rmsToDb", () => {
  test("is finite for pure silence", () => {
    assert.ok(Number.isFinite(rmsToDb(0)));
  });

  test("rises with loudness", () => {
    assert.ok(rmsToDb(0.5) > rmsToDb(0.05));
  });
});

describe("detectPitchHz", () => {
  test("recovers a low male-range pitch", () => {
    const pitch = detectPitchHz(sine(120), SAMPLE_RATE);
    assert.ok(pitch !== null && Math.abs(pitch - 120) < 6, `got ${pitch}`);
  });

  test("recovers a higher pitch", () => {
    const pitch = detectPitchHz(sine(240), SAMPLE_RATE);
    assert.ok(pitch !== null && Math.abs(pitch - 240) < 10, `got ${pitch}`);
  });

  test("returns null for silence", () => {
    assert.equal(detectPitchHz(new Float32Array(2048), SAMPLE_RATE), null);
  });

  test("rejects pitch outside the speech band", () => {
    // 2 kHz is well above the voiced range and must not be reported as F0.
    assert.equal(detectPitchHz(sine(2000), SAMPLE_RATE), null);
  });
});

describe("summarizeFrames", () => {
  test("reports full silence", () => {
    const metrics = summarizeFrames(frames([{ rms: 0 }, { rms: 0 }]));
    assert.equal(metrics.silentFraction, 1);
    assert.equal(metrics.meanPitchHz, null);
  });

  test("computes energy and pitch stats over voiced frames", () => {
    const metrics = summarizeFrames(
      frames([
        { rms: 0.2, pitchHz: 150 },
        { rms: 0.4, pitchHz: 170 },
        { rms: 0 }
      ])
    );
    assert.equal(metrics.frameCount, 3);
    assert.ok(Math.abs(metrics.silentFraction - 1 / 3) < 1e-9);
    assert.ok(Math.abs(metrics.meanEnergy - 0.3) < 1e-9);
    assert.equal(metrics.peakEnergy, 0.4);
    assert.equal(metrics.meanPitchHz, 160);
    assert.ok((metrics.pitchVariabilityHz ?? 0) > 0);
  });
});

function baselineFrom(rms: number, pitch: number): SpeakerBaseline {
  const baseline = new SpeakerBaseline();
  for (let i = 0; i < 40; i += 1) baseline.observe({ rms, pitchHz: pitch });
  return baseline;
}

describe("interpretVocalState", () => {
  test("flags a mostly-silent window as a long pause and nothing else", () => {
    const metrics = summarizeFrames(frames(Array(10).fill({ rms: 0 })));
    const out = interpretVocalState(metrics, baselineFrom(0.2, 150), "A");
    assert.equal(out.length, 1);
    assert.equal(out[0].label, "long-pause");
  });

  test("stays quiet until the speaker baseline is established", () => {
    const metrics = summarizeFrames(frames([{ rms: 0.9, pitchHz: 300 }]));
    const out = interpretVocalState(metrics, new SpeakerBaseline(), "A");
    assert.equal(out.length, 0);
  });

  test("detects a raised voice against a quiet baseline", () => {
    const metrics = summarizeFrames(frames(Array(10).fill({ rms: 0.5, pitchHz: 160 })));
    const out = interpretVocalState(metrics, baselineFrom(0.2, 155), "B");
    assert.ok(out.some((o) => o.label === "raised-voice"), JSON.stringify(out));
    assert.equal(out[0].subject, "B");
  });

  test("detects a tense voice from a pitch lift with modest extra energy", () => {
    const metrics = summarizeFrames(frames(Array(10).fill({ rms: 0.26, pitchHz: 210 })));
    const out = interpretVocalState(metrics, baselineFrom(0.2, 150), "A");
    assert.ok(out.some((o) => o.label === "tense-voice"), JSON.stringify(out));
  });

  test("detects flat / withdrawn delivery: quiet, monotone, gappy", () => {
    const spec = [
      ...Array(5).fill({ rms: 0.1, pitchHz: 150 }),
      ...Array(5).fill({ rms: 0 })
    ];
    const out = interpretVocalState(summarizeFrames(frames(spec)), baselineFrom(0.25, 150), "A");
    assert.ok(out.some((o) => o.label === "flat-withdrawn"), JSON.stringify(out));
  });

  test("detects warm / engaged delivery: lively pitch at easy volume", () => {
    const spec = [
      { rms: 0.2, pitchHz: 140 },
      { rms: 0.22, pitchHz: 190 },
      { rms: 0.2, pitchHz: 160 },
      { rms: 0.23, pitchHz: 210 },
      { rms: 0.2, pitchHz: 150 }
    ];
    const out = interpretVocalState(summarizeFrames(frames(spec)), baselineFrom(0.2, 170), "A");
    assert.ok(out.some((o) => o.label === "warm-engaged"), JSON.stringify(out));
  });

  test("an ordinary, level sentence produces no observation", () => {
    const metrics = summarizeFrames(frames(Array(10).fill({ rms: 0.2, pitchHz: 155 })));
    const out = interpretVocalState(metrics, baselineFrom(0.2, 150), "A");
    assert.equal(out.length, 0, JSON.stringify(out));
  });
});
