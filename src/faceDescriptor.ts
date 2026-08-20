import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export const FACE_DESCRIPTOR_MODEL_ID = "mediapipe-face-geometry-v1";

// Stable eye, brow, nose and outer-face points. Mouth points are intentionally
// omitted so expression changes have less influence on identity calibration.
const LANDMARK_INDICES = [
  10, 21, 33, 46, 52, 55, 65, 70, 107, 133, 143, 145, 153, 159, 168, 173,
  189, 193, 197, 209, 234, 244, 263, 276, 282, 285, 295, 300, 336, 362, 372,
  374, 380, 386, 389, 413, 417, 421, 429, 454, 464, 1, 2, 4, 5, 6, 19, 94,
  98, 195, 327
] as const;

function average(points: NormalizedLandmark[]) {
  return points.reduce(
    (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
    { x: 0, y: 0 }
  );
}

function l2Normalize(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude < 1e-8) throw new Error("face-descriptor-degenerate");
  return values.map((value) => value / magnitude);
}

export function createFaceDescriptor(landmarks: NormalizedLandmark[]) {
  if (landmarks.length < 468) throw new Error("face-landmarks-incomplete");
  const rightEye = average([landmarks[33], landmarks[133]]);
  const leftEye = average([landmarks[362], landmarks[263]]);
  const origin = {
    x: (rightEye.x + leftEye.x) / 2,
    y: (rightEye.y + leftEye.y) / 2
  };
  const dx = leftEye.x - rightEye.x;
  const dy = leftEye.y - rightEye.y;
  const eyeDistance = Math.hypot(dx, dy);
  if (!Number.isFinite(eyeDistance) || eyeDistance < 0.035) throw new Error("face-too-small");
  const cosine = dx / eyeDistance;
  const sine = dy / eyeDistance;
  const descriptor: number[] = [];

  for (const index of LANDMARK_INDICES) {
    const point = landmarks[index];
    const centeredX = point.x - origin.x;
    const centeredY = point.y - origin.y;
    descriptor.push(
      (centeredX * cosine + centeredY * sine) / eyeDistance,
      (-centeredX * sine + centeredY * cosine) / eyeDistance,
      (point.z ?? 0) / eyeDistance
    );
  }
  return l2Normalize(descriptor);
}

export function faceCaptureQuality(landmarks: NormalizedLandmark[]) {
  if (landmarks.length < 468) return 0;
  const xs = landmarks.slice(0, 468).map((point) => point.x);
  const ys = landmarks.slice(0, 468).map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const centerY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const sizeScore = Math.min(1, Math.min(width / 0.28, height / 0.34));
  const centerDistance = Math.hypot(centerX - 0.5, centerY - 0.5);
  const centerScore = Math.max(0, 1 - centerDistance / 0.42);
  return Math.max(0, Math.min(1, sizeScore * 0.65 + centerScore * 0.35));
}
