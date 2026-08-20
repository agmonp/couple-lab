import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  emptyEnrollmentState,
  enrollmentSummary,
  validateEnrollmentState
} = require("../electron/biometric-validation.cjs") as {
  emptyEnrollmentState: () => { schemaVersion: 1; partners: Record<string, unknown> };
  enrollmentSummary: (state: ReturnType<typeof validateEnrollmentState>) => {
    schemaVersion: 1;
    partners: Record<string, { faceTemplateCount: number; voiceTemplateCount: number }>;
  };
  validateEnrollmentState: (value: unknown) => {
    schemaVersion: 1;
    partners: Record<string, { faceTemplates: unknown[]; voiceTemplates: unknown[] }>;
  };
};

const capturedAt = "2026-08-11T12:00:00.000Z";

describe("desktop biometric enrollment validation", () => {
  it("normalizes valid local face and voice templates", () => {
    const state = validateEnrollmentState({
      schemaVersion: 99,
      partners: {
        A: {
          displayName: " תמר ",
          faceTemplates: [{ modelId: "face-v1", vector: [0.1, 0.2], capturedAt, quality: 0.9 }],
          voiceTemplates: [{ modelId: "voice-v1", vector: [0.3, 0.4], capturedAt }],
          updatedAt: capturedAt
        }
      }
    });

    expect(state.schemaVersion).toBe(1);
    expect(state.partners.A.faceTemplates).toHaveLength(1);
    expect(enrollmentSummary(state).partners.A).toMatchObject({
      faceTemplateCount: 1,
      voiceTemplateCount: 1
    });
  });

  it("rejects invalid vector values", () => {
    expect(() =>
      validateEnrollmentState({
        partners: {
          B: {
            faceTemplates: [{ modelId: "face-v1", vector: [Number.NaN], capturedAt }]
          }
        }
      })
    ).toThrow("invalid-biometric-vector-value");
  });

  it("starts with an empty versioned state", () => {
    expect(emptyEnrollmentState()).toEqual({ schemaVersion: 1, partners: {} });
  });
});
