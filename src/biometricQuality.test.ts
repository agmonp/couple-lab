import { describe, expect, it } from "vitest";
import { cosineSimilarity, inspectAudioQuality, matchPartnerVector, modalitySeparation, resampleAudio } from "./biometricQuality";
import type { BiometricTemplate, PartnerBiometricEnrollment, PartnerId } from "./types";

function template(vector: number[]): BiometricTemplate {
  return { modelId: "test", vector, capturedAt: "2026-08-11T10:00:00.000Z", quality: 0.9 };
}

function partner(partnerId: PartnerId, vectors: number[][]): PartnerBiometricEnrollment {
  return {
    partnerId,
    displayName: partnerId,
    faceTemplates: vectors.map(template),
    voiceTemplates: vectors.map(template),
    updatedAt: "2026-08-11T10:00:00.000Z"
  };
}

describe("biometric enrollment quality", () => {
  it("resamples PCM and accepts an active unclipped sample", () => {
    const inputRate = 48000;
    const input = Float32Array.from({ length: inputRate * 8 }, (_, index) => Math.sin(index * 0.07) * 0.12);
    const output = resampleAudio(input, inputRate, 16000);
    const quality = inspectAudioQuality(output, 16000);

    expect(output).toHaveLength(16000 * 8);
    expect(quality.acceptable).toBe(true);
    expect(quality.durationSeconds).toBeCloseTo(8, 3);
    expect(quality.clippingRatio).toBe(0);
  });

  it("rejects silence", () => {
    const quality = inspectAudioQuality(new Float32Array(16000 * 8), 16000);
    expect(quality.acceptable).toBe(false);
    expect(quality.activeRatio).toBe(0);
  });

  it("reports separation only when within-person similarity beats cross-person similarity", () => {
    const first = partner("A", [[1, 0], [0.995, 0.1]]);
    const second = partner("B", [[0, 1], [0.1, 0.995]]);
    const report = modalitySeparation(first, second, "voiceTemplates");

    expect(report.status).toBe("usable");
    expect(report.margin).not.toBeNull();
    expect(report.margin!).toBeGreaterThan(0.8);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("flags indistinguishable samples as weak", () => {
    const first = partner("A", [[1, 0], [1, 0]]);
    const second = partner("B", [[1, 0], [1, 0]]);
    expect(modalitySeparation(first, second, "voiceTemplates").status).toBe("weak");
  });

  it("matches a live vector only when one enrolled partner is clearly closer", () => {
    const first = partner("A", [[1, 0], [0.995, 0.1]]);
    const second = partner("B", [[0, 1], [0.1, 0.995]]);

    const match = matchPartnerVector([0.99, 0.05], first, second, "voiceTemplates");
    expect(match.status).toBe("matched");
    expect(match.partnerId).toBe("A");
  });

  it("returns unknown when enrolled vectors cannot be separated", () => {
    const first = partner("A", [[1, 0], [1, 0]]);
    const second = partner("B", [[1, 0], [1, 0]]);

    expect(matchPartnerVector([1, 0], first, second, "faceTemplates").partnerId).toBeNull();
  });
});
