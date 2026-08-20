import { describe, expect, it } from "vitest";
import { incompleteBiometricPartners, isPartnerBiometricReady } from "./biometricReadiness";
import type { BiometricEnrollmentState, PartnerBiometricSummary } from "./types";

const capturedAt = "2026-08-13T12:00:00.000Z";

function summary(faceTemplateCount: number, voiceTemplateCount: number): PartnerBiometricSummary {
  return { displayName: "תמר", faceTemplateCount, voiceTemplateCount, updatedAt: capturedAt };
}

describe("biometric readiness", () => {
  it("requires both face and voice samples", () => {
    expect(isPartnerBiometricReady(summary(4, 2))).toBe(true);
    expect(isPartnerBiometricReady(summary(4, 0))).toBe(false);
    expect(isPartnerBiometricReady(summary(0, 2))).toBe(false);
    expect(isPartnerBiometricReady(undefined)).toBe(false);
  });

  it("returns only partners whose identity is incomplete", () => {
    const state: BiometricEnrollmentState = {
      schemaVersion: 1,
      partners: {
        A: {
          partnerId: "A",
          displayName: "אגמון",
          faceTemplates: [{ modelId: "face", vector: [0.1], capturedAt }],
          voiceTemplates: [{ modelId: "voice", vector: [0.2], capturedAt }],
          updatedAt: capturedAt
        },
        B: {
          partnerId: "B",
          displayName: "תמר",
          faceTemplates: [{ modelId: "face", vector: [0.3], capturedAt }],
          voiceTemplates: [],
          updatedAt: capturedAt
        }
      }
    };

    expect(incompleteBiometricPartners(state)).toEqual(["B"]);
  });
});
