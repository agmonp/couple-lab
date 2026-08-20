import { describe, expect, it } from "vitest";
import {
  appendCalibrationSample,
  calibrationMessage,
  evaluateCalibrationSample,
  readCalibrationState,
  summarizeCalibration
} from "./transcriptionCalibration";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value)
  };
}

describe("transcription calibration", () => {
  it("scores a perfect read as good with all words recognized", () => {
    const expected = "שמי דנה ואני מתרגלת הקשבה סקרנות ושיחה רגועה";
    const evaluation = evaluateCalibrationSample(expected, expected);
    expect(evaluation.level).toBe("good");
    expect(evaluation.wer).toBe(0);
    expect(evaluation.recognizedWords).toBe(evaluation.expectedWords);
    expect(calibrationMessage(evaluation)).toContain("אפשר לסמוך");
  });

  it("scores a badly garbled read as poor and suggests a remedy", () => {
    const evaluation = evaluateCalibrationSample(
      "כשאני רוצה שיקשיבו לי עוזר לי לדבר בקצב רגוע ולהסביר מה חשוב לי",
      "שלום שלום בית עץ"
    );
    expect(evaluation.level).toBe("poor");
    expect(evaluation.wer).toBeGreaterThan(0.45);
    expect(calibrationMessage(evaluation)).toContain("לדבר לאט");
  });

  it("ignores punctuation differences when scoring", () => {
    const evaluation = evaluateCalibrationSample(
      "שמי דנה, ואני משתתפת כדי לתרגל הקשבה!",
      "שמי דנה ואני משתתפת כדי לתרגל הקשבה"
    );
    expect(evaluation.wer).toBe(0);
  });

  it("appends samples, caps history and summarizes the average", () => {
    const storage = memoryStorage();
    appendCalibrationSample(
      { partnerId: "A", wer: 0.1, cer: 0.05, expectedWords: 10, recognizedWords: 9, level: "good", capturedAt: "t1", modelId: "m1" },
      storage
    );
    const state = appendCalibrationSample(
      { partnerId: "B", wer: 0.3, cer: 0.2, expectedWords: 10, recognizedWords: 7, level: "fair", capturedAt: "t2", modelId: "m2" },
      storage
    );
    expect(state.samples).toHaveLength(2);
    const summary = summarizeCalibration(readCalibrationState(storage));
    expect(summary.sampleCount).toBe(2);
    expect(summary.averageWer).toBe(0.2);
    expect(summary.level).toBe("good");
    expect(summary.latestModelId).toBe("m2");
  });

  it("returns an empty state for corrupted storage", () => {
    const storage = memoryStorage({ "couple-lab-transcription-calibration": "{broken" });
    expect(readCalibrationState(storage).samples).toEqual([]);
  });
});
