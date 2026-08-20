import type { PartnerId, VisualObservation } from "./types";

export interface VisualPoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface VisualCoverage {
  score: number;
  status: "good" | "partial" | "insufficient";
  faceCount: number;
  poseCount: number;
}

const MOTION_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24] as const;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function distance(first: VisualPoint, second: VisualPoint) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function visualCoverage(faceCount: number, poseCount: number): VisualCoverage {
  const normalizedFaces = clamp(faceCount / 2);
  const normalizedPoses = clamp(poseCount / 2);
  const score = normalizedFaces * 0.65 + normalizedPoses * 0.35;

  return {
    score,
    status: score >= 0.8 ? "good" : score >= 0.35 ? "partial" : "insufficient",
    faceCount: Math.max(0, faceCount),
    poseCount: Math.max(0, poseCount)
  };
}

export function headOrientationProxy(landmarks: VisualPoint[]) {
  const nose = landmarks[1];
  const firstEye = landmarks[33];
  const secondEye = landmarks[263];
  if (!nose || !firstEye || !secondEye) return null;
  const eyeDistance = distance(firstEye, secondEye);
  if (!Number.isFinite(eyeDistance) || eyeDistance < 0.025) return null;
  const eyeCenterX = (firstEye.x + secondEye.x) / 2;
  return (nose.x - eyeCenterX) / eyeDistance;
}

export function normalizedPoseMotion(previous: VisualPoint[] | undefined, current: VisualPoint[]) {
  if (!previous?.length || current.length < 25 || previous.length < 25) return null;
  const leftShoulder = current[11];
  const rightShoulder = current[12];
  if (!leftShoulder || !rightShoulder) return null;
  const shoulderSpan = distance(leftShoulder, rightShoulder);
  if (!Number.isFinite(shoulderSpan) || shoulderSpan < 0.035) return null;

  const displacements = MOTION_LANDMARKS.flatMap((index) => {
    const before = previous[index];
    const after = current[index];
    if (!before || !after || (before.visibility ?? 1) < 0.45 || (after.visibility ?? 1) < 0.45) return [];
    return [distance(before, after) / shoulderSpan];
  });
  if (displacements.length < 4) return null;
  return displacements.reduce((sum, value) => sum + value, 0) / displacements.length;
}

export function qualityObservation(
  seconds: number,
  sampleIntervalMs: number,
  faceCount: number,
  poseCount: number
): VisualObservation {
  const coverage = visualCoverage(faceCount, poseCount);
  return {
    id: `visual-quality-${seconds}-${faceCount}-${poseCount}`,
    seconds,
    label: "capture-quality",
    score: coverage.score,
    evidence: `${faceCount} faces and ${poseCount} body poses were available for this sample`,
    provider: "derived",
    metadata: {
      sampleIntervalMs,
      faceCount,
      poseCount,
      coverageStatus: coverage.status
    }
  };
}

export function movementObservation(
  seconds: number,
  subject: PartnerId,
  motion: number
): VisualObservation | null {
  if (!Number.isFinite(motion) || motion < 0.14) return null;
  return {
    id: `visual-body-motion-${subject}-${seconds}`,
    seconds,
    label: "body-movement",
    subject,
    score: clamp(motion / 0.55, 0.35, 0.88),
    evidence: "Body landmarks changed position relative to shoulder width",
    provider: "derived",
    metadata: { normalizedMotion: Number(motion.toFixed(3)) }
  };
}

export function headOrientationObservations(
  seconds: number,
  subject: PartnerId,
  current: number | null,
  previous: number | undefined
): VisualObservation[] {
  if (current === null || !Number.isFinite(current)) return [];
  const observations: VisualObservation[] = [];
  const magnitude = Math.abs(current);
  if (magnitude >= 0.18) {
    observations.push({
      id: `visual-head-offset-${subject}-${seconds}`,
      seconds,
      label: "head-orientation-offset",
      subject,
      score: clamp(magnitude / 0.65, 0.35, 0.82),
      evidence: "The nose position shifted relative to the eye line",
      provider: "derived",
      metadata: { normalizedHeadOffset: Number(current.toFixed(3)) }
    });
  }
  if (previous !== undefined) {
    const change = Math.abs(current - previous);
    if (change >= 0.2) {
      observations.push({
        id: `visual-head-change-${subject}-${seconds}`,
        seconds,
        label: "head-orientation-change",
        subject,
        score: clamp(change / 0.75, 0.35, 0.82),
        evidence: "Head orientation changed between sampled moments",
        provider: "derived",
        metadata: { normalizedHeadChange: Number(change.toFixed(3)) }
      });
    }
  }
  return observations;
}
