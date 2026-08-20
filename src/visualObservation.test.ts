import { describe, expect, it } from "vitest";
import {
  headOrientationObservations,
  headOrientationProxy,
  movementObservation,
  normalizedPoseMotion,
  qualityObservation,
  visualCoverage,
  type VisualPoint
} from "./visualObservation";

function pose(offset = 0): VisualPoint[] {
  const points = Array.from({ length: 25 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  points[11] = { x: 0.4 + offset, y: 0.4, visibility: 1 };
  points[12] = { x: 0.6 + offset, y: 0.4, visibility: 1 };
  [13, 14, 15, 16, 23, 24].forEach((index) => {
    points[index] = { x: 0.5 + offset, y: 0.55 + index * 0.002, visibility: 1 };
  });
  return points;
}

describe("visual observation helpers", () => {
  it("reports coverage quality without treating missing people as behavior", () => {
    expect(visualCoverage(2, 2)).toMatchObject({ score: 1, status: "good" });
    expect(visualCoverage(1, 0)).toMatchObject({ score: 0.325, status: "insufficient" });
    expect(qualityObservation(4, 1200, 0, 0)).toMatchObject({
      label: "capture-quality",
      score: 0,
      metadata: { faceCount: 0, poseCount: 0, coverageStatus: "insufficient" }
    });
  });

  it("normalizes pose motion by shoulder width", () => {
    expect(normalizedPoseMotion(pose(), pose())).toBeCloseTo(0);
    expect(normalizedPoseMotion(pose(), pose(0.05))).toBeCloseTo(0.25);
    expect(movementObservation(3, "A", 0.1)).toBeNull();
    expect(movementObservation(3, "A", 0.25)).toMatchObject({ label: "body-movement", subject: "A" });
  });

  it("describes head geometry and changes without assigning an emotion", () => {
    const landmarks = Array.from({ length: 264 }, () => ({ x: 0.5, y: 0.5 }));
    landmarks[33] = { x: 0.4, y: 0.5 };
    landmarks[263] = { x: 0.6, y: 0.5 };
    landmarks[1] = { x: 0.55, y: 0.5 };
    expect(headOrientationProxy(landmarks)).toBeCloseTo(0.25);
    expect(headOrientationObservations(8, "B", 0.25, 0)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "head-orientation-offset", subject: "B" }),
        expect.objectContaining({ label: "head-orientation-change", subject: "B" })
      ])
    );
  });

  it("returns insufficient geometry when the eyes cannot be measured", () => {
    expect(headOrientationProxy([])).toBeNull();
    expect(normalizedPoseMotion(undefined, pose())).toBeNull();
  });
});
