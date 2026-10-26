import { describe, expect, it } from "vitest";
import engine from "./whispercpp-engine.cjs";

const { joinSplitWords, toEngineSegment, tokensToWords, wavFromFloat32 } = engine;

const token = (word, start, end, probability = 0.9) => ({ word, start, end, probability });

describe("whisper.cpp engine adapter", () => {
  it("merges Hebrew tokens into words, a leading space opening each word", () => {
    const words = tokensToWords(
      [token(" מ", 0.7, 0.7), token("רק", 0.7, 0.8), token("לי", 0.8, 0.9, 0.5), token(" ה", 1.0, 1.1), token("ש", 1.1, 1.2), token(".", 1.2, 1.3)],
      (value) => value
    );
    expect(words.map((word) => word[2])).toEqual(["מרקלי", "הש."]);
    expect(words[0][0]).toBe(0.7);
    expect(words[0][1]).toBe(0.9);
    expect(words[0][3]).toBeCloseTo((0.9 + 0.9 + 0.5) / 3, 3);
  });

  it("skips special tokens", () => {
    expect(tokensToWords([token("[_BEG_]", 0, 0), token(" שלום", 0, 1)], (value) => value).map((word) => word[2])).toEqual(["שלום"]);
  });

  it("does not cut a word that whisper.cpp split across two segments", () => {
    const joined = joinSplitWords([
      { text: " הטילה מצור על גר", start: 0, end: 4.5, words: [token(" על", 4.1, 4.3), token(" ג", 4.38, 4.5), token("ר", 4.5, 4.56)] },
      { text: "מניה.", start: 4.56, end: 5.3, words: [token("מנ", 4.56, 4.9), token("יה", 4.93, 5.2), token(".", 5.24, 5.3)] }
    ]);
    expect(joined).toHaveLength(1);
    expect(joined[0].text.trim().endsWith("גרמניה.")).toBe(true);
    expect(tokensToWords(joined[0].words, (value) => value).map((word) => word[2])).toEqual(["על", "גרמניה."]);
  });

  it("shifts times by the window offset and keeps the quality fields", () => {
    const segment = toEngineSegment(
      { text: " שלום", start: 0.5, end: 1, avg_logprob: -0.2, no_speech_prob: 0.01, tokens: [1, 2], words: [token(" שלום", 0.5, 1)] },
      10
    );
    expect(segment).toMatchObject({ text: "שלום", start: 10.5, end: 11, avgLogprob: -0.2, noSpeechProb: 0.01, tokenCount: 2 });
    expect(segment.words[0].slice(0, 3)).toEqual([10.5, 11, "שלום"]);
  });

  it("writes a 16 kHz mono 16-bit WAV", () => {
    const wav = wavFromFloat32(new Float32Array([0, 1, -1, 2]));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.length).toBe(44 + 8);
    expect(wav.readInt16LE(46)).toBe(32767);
    expect(wav.readInt16LE(50)).toBe(32767);
  });
});
