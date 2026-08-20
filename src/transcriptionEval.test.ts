import { describe, expect, it } from "vitest";
import { transcriptionAccuracy } from "./transcriptionEval";

describe("transcription accuracy", () => {
  it("returns zero WER and CER for equivalent text", () => {
    const result = transcriptionAccuracy("שלום, מה שלומך?", "שלום מה שלומך");
    expect(result.wer).toBe(0);
    expect(result.cer).toBe(0);
  });

  it("counts a substituted Hebrew word", () => {
    const result = transcriptionAccuracy("אני מקשיבה לך עכשיו", "אני מקשיב לך עכשיו");
    expect(result.wordErrors).toBe(1);
    expect(result.wer).toBe(0.25);
  });
});

