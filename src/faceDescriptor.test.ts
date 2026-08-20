import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./biometricQuality";
import { createFaceDescriptor, faceCaptureQuality } from "./faceDescriptor";

function face(): NormalizedLandmark[] {
  const points = Array.from({ length: 478 }, (_, index) => {
    const angle = (index / 478) * Math.PI * 2;
    return { x: 0.5 + Math.cos(angle) * 0.16, y: 0.5 + Math.sin(angle) * 0.21, z: Math.sin(angle * 2) * 0.015, visibility: 1 };
  });
  points[33] = { x: 0.39, y: 0.45, z: 0, visibility: 1 };
  points[133] = { x: 0.45, y: 0.45, z: 0, visibility: 1 };
  points[362] = { x: 0.55, y: 0.45, z: 0, visibility: 1 };
  points[263] = { x: 0.61, y: 0.45, z: 0, visibility: 1 };
  return points;
}

function transform(points: NormalizedLandmark[], scale: number, radians: number): NormalizedLandmark[] {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return points.map((point) => {
    const x = point.x - 0.5;
    const y = point.y - 0.5;
    return {
      x: 0.52 + scale * (x * cosine - y * sine),
      y: 0.48 + scale * (x * sine + y * cosine),
      z: (point.z ?? 0) * scale,
      visibility: 1
    };
  });
}

describe("face geometry descriptor", () => {
  it("is stable under translation, scale and in-plane rotation", () => {
    const original = createFaceDescriptor(face());
    const moved = createFaceDescriptor(transform(face(), 1.3, 0.12));
    expect(cosineSimilarity(original, moved)).toBeGreaterThan(0.9999);
  });

  it("requires a visible face of useful size", () => {
    expect(faceCaptureQuality(face())).toBeGreaterThan(0.7);
    expect(() => createFaceDescriptor(transform(face(), 0.1, 0))).toThrow("face-too-small");
  });
});
