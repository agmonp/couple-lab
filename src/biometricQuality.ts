import type { BiometricTemplate, PartnerBiometricEnrollment } from "./types";

export interface AudioQualityResult {
  durationSeconds: number;
  rms: number;
  activeRatio: number;
  clippingRatio: number;
  score: number;
  acceptable: boolean;
}

export function resampleAudio(input: Float32Array, inputRate: number, outputRate = 16000) {
  if (inputRate <= 0 || outputRate <= 0 || input.length === 0) return new Float32Array();
  if (inputRate === outputRate) return new Float32Array(input);
  const outputLength = Math.max(1, Math.round((input.length * outputRate) / inputRate));
  const result = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const before = Math.min(input.length - 1, Math.floor(sourcePosition));
    const after = Math.min(input.length - 1, before + 1);
    const mix = sourcePosition - before;
    result[index] = input[before] * (1 - mix) + input[after] * mix;
  }
  return result;
}

export function inspectAudioQuality(samples: Float32Array, sampleRate: number): AudioQualityResult {
  const durationSeconds = sampleRate > 0 ? samples.length / sampleRate : 0;
  let energy = 0;
  let clipped = 0;
  for (const sample of samples) {
    energy += sample * sample;
    if (Math.abs(sample) >= 0.98) clipped += 1;
  }
  const rms = samples.length ? Math.sqrt(energy / samples.length) : 0;
  const frameSize = Math.max(1, Math.round(sampleRate * 0.025));
  let activeFrames = 0;
  let frames = 0;
  for (let start = 0; start < samples.length; start += frameSize) {
    let frameEnergy = 0;
    const end = Math.min(samples.length, start + frameSize);
    for (let index = start; index < end; index += 1) frameEnergy += samples[index] * samples[index];
    const frameRms = Math.sqrt(frameEnergy / Math.max(1, end - start));
    if (frameRms >= 0.012) activeFrames += 1;
    frames += 1;
  }
  const activeRatio = frames ? activeFrames / frames : 0;
  const clippingRatio = samples.length ? clipped / samples.length : 0;
  const loudnessScore = Math.max(0, Math.min(1, (rms - 0.008) / 0.055));
  const activityScore = Math.max(0, Math.min(1, activeRatio / 0.55));
  const clippingScore = Math.max(0, 1 - clippingRatio / 0.02);
  const durationScore = Math.max(0, Math.min(1, durationSeconds / 7));
  const score = loudnessScore * 0.3 + activityScore * 0.35 + clippingScore * 0.15 + durationScore * 0.2;
  return {
    durationSeconds,
    rms,
    activeRatio,
    clippingRatio,
    score,
    acceptable: durationSeconds >= 6 && rms >= 0.01 && activeRatio >= 0.25 && clippingRatio <= 0.03
  };
}

export function cosineSimilarity(first: number[], second: number[]) {
  if (!first.length || first.length !== second.length) return -1;
  let dot = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;
  for (let index = 0; index < first.length; index += 1) {
    dot += first[index] * second[index];
    firstMagnitude += first[index] * first[index];
    secondMagnitude += second[index] * second[index];
  }
  const denominator = Math.sqrt(firstMagnitude * secondMagnitude);
  return denominator > 0 ? dot / denominator : -1;
}

function templateMatchScore(vector: number[], templates: BiometricTemplate[]) {
  const scores = templates
    .map((template) => cosineSimilarity(vector, template.vector))
    .filter(Number.isFinite)
    .sort((first, second) => second - first)
    .slice(0, 2);
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : -1;
}

export interface PartnerVectorMatch {
  partnerId: "A" | "B" | null;
  scoreA: number;
  scoreB: number;
  margin: number;
  status: "matched" | "unknown";
}

export function matchPartnerVector(
  vector: number[],
  first: PartnerBiometricEnrollment | undefined,
  second: PartnerBiometricEnrollment | undefined,
  modality: "faceTemplates" | "voiceTemplates"
): PartnerVectorMatch {
  const scoreA = first ? templateMatchScore(vector, first[modality]) : -1;
  const scoreB = second ? templateMatchScore(vector, second[modality]) : -1;
  const partnerId = scoreA >= scoreB ? "A" : "B";
  const bestScore = Math.max(scoreA, scoreB);
  const margin = Math.abs(scoreA - scoreB);
  const minimumScore = modality === "voiceTemplates" ? 0.35 : 0.72;
  const minimumMargin = modality === "voiceTemplates" ? 0.06 : 0.003;
  const matched = scoreA > -1 && scoreB > -1 && bestScore >= minimumScore && margin >= minimumMargin;

  return {
    partnerId: matched ? partnerId : null,
    scoreA,
    scoreB,
    margin,
    status: matched ? "matched" : "unknown"
  };
}

function pairSimilarities(templates: BiometricTemplate[]) {
  const values: number[] = [];
  for (let first = 0; first < templates.length; first += 1) {
    for (let second = first + 1; second < templates.length; second += 1) {
      values.push(cosineSimilarity(templates[first].vector, templates[second].vector));
    }
  }
  return values;
}

function crossSimilarities(first: BiometricTemplate[], second: BiometricTemplate[]) {
  return first.flatMap((left) => second.map((right) => cosineSimilarity(left.vector, right.vector)));
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export interface ModalitySeparation {
  withinA: number | null;
  withinB: number | null;
  cross: number | null;
  margin: number | null;
  status: "pending" | "usable" | "weak";
}

export function modalitySeparation(
  first: PartnerBiometricEnrollment | undefined,
  second: PartnerBiometricEnrollment | undefined,
  modality: "faceTemplates" | "voiceTemplates"
): ModalitySeparation {
  if (!first || !second) return { withinA: null, withinB: null, cross: null, margin: null, status: "pending" };
  const withinA = mean(pairSimilarities(first[modality]));
  const withinB = mean(pairSimilarities(second[modality]));
  const cross = mean(crossSimilarities(first[modality], second[modality]));
  if (withinA === null || withinB === null || cross === null) {
    return { withinA, withinB, cross, margin: null, status: "pending" };
  }
  const margin = Math.min(withinA, withinB) - cross;
  const minimumMargin = modality === "voiceTemplates" ? 0.08 : 0.004;
  return { withinA, withinB, cross, margin, status: margin >= minimumMargin ? "usable" : "weak" };
}
