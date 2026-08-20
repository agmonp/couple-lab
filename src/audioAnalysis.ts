/**
 * Vocal (prosody) analysis from the microphone, alongside the transcript.
 *
 * The words tell you *what* was said; the voice tells you *how*. Two partners can
 * say "fine" in ways that mean opposite things. This module reads the "how"
 * directly from the audio signal — no transcript, no cloud, no heavy model.
 *
 * It extracts four established prosodic cues with plain Web Audio API maths:
 *
 *   - Energy (RMS)         → loudness; a sustained spike over the speaker's own
 *                            baseline is a raised voice / shouting.
 *   - Pitch (F0)           → fundamental frequency via autocorrelation; a lift
 *                            over baseline tracks tension and escalation.
 *   - Pitch variability    → a flat, monotone line reads as withdrawal/shutdown;
 *                            lively variation reads as engagement.
 *   - Silence fraction     → long gaps mark pauses, hesitation, or stonewalling.
 *
 * Everything here is deliberately dependency-free and light: a few array passes
 * per frame, a handful of times a second. It is calibrated *relative to each
 * speaker*, because absolute microphone levels are meaningless across setups.
 *
 * The pure functions are unit-tested in test/audioAnalysis.test.ts. The
 * `VocalAnalyser` class at the bottom is the thin Web Audio wrapper.
 */

import type { PartnerId } from "./types";

/** Voiced speech F0 lives roughly here; outside this band is noise or artefact. */
export const MIN_PITCH_HZ = 75;
export const MAX_PITCH_HZ = 400;

/** Below this RMS a frame is treated as silence rather than speech. */
export const SILENCE_RMS = 0.01;

/** Root-mean-square amplitude of a frame: the loudness signal. */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/** Convert an RMS amplitude (0-1) to decibels, floored so silence is finite. */
export function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

/**
 * Fundamental frequency (F0) of a frame by autocorrelation, or null when the
 * frame is unvoiced (silence, a consonant, or noise).
 *
 * Autocorrelation is the classic, cheap pitch estimator: a voiced sound repeats
 * every 1/F0 seconds, so the signal correlates most strongly with itself at that
 * lag. It is robust enough for conversational speech and costs one nested pass
 * over a short frame.
 */
export function detectPitchHz(samples: Float32Array, sampleRate: number): number | null {
  const rms = computeRms(samples);
  if (rms < SILENCE_RMS) return null;

  const minLag = Math.floor(sampleRate / MAX_PITCH_HZ);
  const maxLag = Math.floor(sampleRate / MIN_PITCH_HZ);
  if (maxLag >= samples.length) return null;

  let bestLag = -1;
  let bestCorrelation = 0;
  let lastCorrelation = 1;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    for (let i = 0; i < samples.length - lag; i += 1) {
      correlation += samples[i] * samples[i + lag];
    }
    correlation /= samples.length - lag;

    // Take the first strong peak (rising then falling) rather than the global
    // max, which avoids locking onto a multiple of the true period.
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
    if (correlation < lastCorrelation && bestLag !== -1 && bestCorrelation > 0.5 * rms * rms) {
      break;
    }
    lastCorrelation = correlation;
  }

  if (bestLag <= 0) return null;
  // A real voiced frame correlates with itself well above background.
  if (bestCorrelation < 0.3 * rms * rms) return null;

  const pitch = sampleRate / bestLag;
  if (pitch < MIN_PITCH_HZ || pitch > MAX_PITCH_HZ) return null;
  return pitch;
}

export interface VocalFrame {
  rms: number;
  pitchHz: number | null;
}

export interface VocalMetrics {
  /** Frames considered in this window. */
  frameCount: number;
  /** Share of frames that were silence (0-1). */
  silentFraction: number;
  /** Mean energy of the voiced frames. */
  meanEnergy: number;
  /** Loudest voiced frame in the window. */
  peakEnergy: number;
  /** Mean F0 across voiced frames, or null when nothing was voiced. */
  meanPitchHz: number | null;
  /** Standard deviation of F0 — the "liveliness" of the voice. */
  pitchVariabilityHz: number | null;
}

/** The interesting vocal states, mapped to the app's interaction families. */
export type VocalStateLabel =
  | "raised-voice"
  | "tense-voice"
  | "flat-withdrawn"
  | "warm-engaged"
  | "long-pause";

export interface VocalObservationLite {
  label: VocalStateLabel;
  subject?: PartnerId;
  /** 0-1. */
  score: number;
  evidence: string;
}

/**
 * A rolling baseline of one speaker's own voice.
 *
 * Loudness and pitch only mean something relative to how this person normally
 * sounds, so every judgement is made against their running mean rather than an
 * absolute threshold that a microphone's gain would invalidate.
 */
export class SpeakerBaseline {
  private energySamples: number[] = [];
  private pitchSamples: number[] = [];
  private readonly limit = 400;

  observe(frame: VocalFrame) {
    if (frame.rms >= SILENCE_RMS) {
      this.energySamples.push(frame.rms);
      if (this.energySamples.length > this.limit) this.energySamples.shift();
    }
    if (frame.pitchHz !== null) {
      this.pitchSamples.push(frame.pitchHz);
      if (this.pitchSamples.length > this.limit) this.pitchSamples.shift();
    }
  }

  get ready() {
    return this.energySamples.length >= 20;
  }

  get meanEnergy() {
    return mean(this.energySamples);
  }

  get meanPitch() {
    return this.pitchSamples.length ? mean(this.pitchSamples) : null;
  }
}

export function summarizeFrames(frames: VocalFrame[]): VocalMetrics {
  const voiced = frames.filter((frame) => frame.rms >= SILENCE_RMS);
  const pitches = frames
    .map((frame) => frame.pitchHz)
    .filter((pitch): pitch is number => pitch !== null);

  const energies = voiced.map((frame) => frame.rms);

  return {
    frameCount: frames.length,
    silentFraction: frames.length ? 1 - voiced.length / frames.length : 1,
    meanEnergy: energies.length ? mean(energies) : 0,
    peakEnergy: energies.length ? Math.max(...energies) : 0,
    meanPitchHz: pitches.length ? mean(pitches) : null,
    pitchVariabilityHz: pitches.length ? stdDev(pitches) : null
  };
}

/**
 * Turn a window of metrics into at most a couple of vocal observations, judged
 * against the speaker's baseline. Conservative on purpose: silence, a quiet
 * moment, or an ordinary sentence produces nothing.
 */
export function interpretVocalState(
  metrics: VocalMetrics,
  baseline: SpeakerBaseline,
  subject?: PartnerId
): VocalObservationLite[] {
  const out: VocalObservationLite[] = [];
  if (metrics.frameCount === 0) return out;

  // A window that is almost entirely silent is a pause, nothing more.
  if (metrics.silentFraction > 0.85) {
    out.push({
      label: "long-pause",
      subject,
      score: clamp01(metrics.silentFraction),
      evidence: `${Math.round(metrics.silentFraction * 100)}% of this window was silence`
    });
    return out;
  }

  if (!baseline.ready) return out;

  const baseEnergy = baseline.meanEnergy || metrics.meanEnergy || 1e-6;
  const basePitch = baseline.meanPitch;
  const energyRatio = metrics.peakEnergy / baseEnergy;
  const meanEnergyRatio = metrics.meanEnergy / baseEnergy;

  // Raised voice: sustained loudness well above this speaker's norm.
  if (meanEnergyRatio > 1.6 && energyRatio > 1.9) {
    out.push({
      label: "raised-voice",
      subject,
      score: clamp01(0.45 + (meanEnergyRatio - 1.6) * 0.5),
      evidence: `Voice ${Math.round(meanEnergyRatio * 100 - 100)}% louder than usual`
    });
  }

  // Tense voice: pitch lifted over baseline together with above-average energy —
  // the signature of escalation, distinct from simply talking louder.
  if (basePitch && metrics.meanPitchHz && metrics.meanPitchHz > basePitch * 1.15 && meanEnergyRatio > 1.2) {
    out.push({
      label: "tense-voice",
      subject,
      score: clamp01(0.4 + (metrics.meanPitchHz / basePitch - 1.15) * 1.2),
      evidence: `Pitch raised to ${Math.round(metrics.meanPitchHz)} Hz, above the usual ${Math.round(basePitch)} Hz`
    });
  }

  // Flat / withdrawn: quiet and monotone at once.
  if (
    metrics.pitchVariabilityHz !== null &&
    metrics.pitchVariabilityHz < 12 &&
    meanEnergyRatio < 0.8 &&
    metrics.silentFraction > 0.4
  ) {
    out.push({
      label: "flat-withdrawn",
      subject,
      score: clamp01(0.4 + (0.8 - meanEnergyRatio)),
      evidence: "Quiet, monotone delivery with long gaps"
    });
  }

  // Warm / engaged: lively pitch at a comfortable energy, no strain.
  if (
    out.length === 0 &&
    metrics.pitchVariabilityHz !== null &&
    metrics.pitchVariabilityHz > 25 &&
    meanEnergyRatio > 0.8 &&
    meanEnergyRatio < 1.5
  ) {
    out.push({
      label: "warm-engaged",
      subject,
      score: clamp01(0.4 + (metrics.pitchVariabilityHz - 25) / 60),
      evidence: "Expressive, varied tone at an easy volume"
    });
  }

  return out;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export interface VocalAnalyserOptions {
  /** How often to read a frame from the microphone, in ms. */
  frameIntervalMs?: number;
  /** How long a window to summarise before reporting, in ms. */
  windowMs?: number;
  onObservations: (observations: VocalObservationLite[], metrics: VocalMetrics) => void;
  /** Which partner is currently speaking, resolved at report time. */
  activeSpeaker: () => PartnerId | undefined;
}

/**
 * Thin Web Audio wrapper: taps an existing MediaStream, samples frames on a
 * timer, and reports vocal observations once per window. Keeps a separate
 * baseline per partner so each is judged against their own voice.
 *
 * Not unit-tested (it needs a real AudioContext); the logic it leans on is.
 */
export class VocalAnalyser {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  // Explicit ArrayBuffer backing: getFloatTimeDomainData rejects a SharedArrayBuffer-backed view.
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private timer = 0;

  private frames: VocalFrame[] = [];
  private windowStart = 0;
  private readonly frameIntervalMs: number;
  private readonly windowMs: number;
  private readonly baselines: Record<PartnerId, SpeakerBaseline> = {
    A: new SpeakerBaseline(),
    B: new SpeakerBaseline()
  };

  constructor(private options: VocalAnalyserOptions) {
    this.frameIntervalMs = options.frameIntervalMs ?? 100;
    this.windowMs = options.windowMs ?? 3000;
  }

  start(stream: MediaStream) {
    this.stop();
    const AudioCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    this.ctx = new AudioCtor();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * Float32Array.BYTES_PER_ELEMENT));
    this.source.connect(this.analyser);

    this.windowStart = performance.now();
    this.timer = window.setInterval(() => this.tick(), this.frameIntervalMs);
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.frames = [];
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close();
    }
    this.ctx = null;
  }

  private tick() {
    if (!this.analyser || !this.buffer || !this.ctx) return;
    this.analyser.getFloatTimeDomainData(this.buffer);

    const rms = computeRms(this.buffer);
    const pitchHz = detectPitchHz(this.buffer, this.ctx.sampleRate);
    const frame: VocalFrame = { rms, pitchHz };
    this.frames.push(frame);

    const speaker = this.options.activeSpeaker();
    if (speaker) this.baselines[speaker].observe(frame);

    if (performance.now() - this.windowStart >= this.windowMs) {
      const metrics = summarizeFrames(this.frames);
      const baseline = speaker ? this.baselines[speaker] : new SpeakerBaseline();
      const observations = interpretVocalState(metrics, baseline, speaker);
      this.options.onObservations(observations, metrics);
      this.frames = [];
      this.windowStart = performance.now();
    }
  }
}
