import { describe, expect, it } from "vitest";
import {
  CloudReflectionError,
  buildCloudReflectionPrompt,
  parseCloudReflection
} from "./cloudReflection";

describe("buildCloudReflectionPrompt", () => {
  it("includes the transcript, speaker names, and the non-verdict rules", () => {
    const prompt = buildCloudReflectionPrompt({
      transcript: "דנה: אני מרגישה שלא הקשיבו לי",
      partnerAName: "דנה",
      partnerBName: "יואב"
    });
    expect(prompt).toContain("דנה");
    expect(prompt).toContain("יואב");
    expect(prompt).toContain("אני מרגישה שלא הקשיבו לי");
    expect(prompt).toContain("לא כאבחון");
  });
});

describe("parseCloudReflection", () => {
  it("parses a clean JSON reflection", () => {
    const result = parseCloudReflection(
      JSON.stringify({
        summary: "השיחה כללה ניסיון הקשבה",
        strengths: ["הקשבה", "  "],
        risks: ["הפרעה אפשרית"],
        nextSteps: ["לשקף משפט אחד", "לקחת נשימה", "להודות על מאמץ", "צעד רביעי שיושמט"]
      })
    );
    expect(result.summary).toBe("השיחה כללה ניסיון הקשבה");
    expect(result.strengths).toEqual(["הקשבה"]);
    expect(result.risks).toEqual(["הפרעה אפשרית"]);
    expect(result.nextSteps).toHaveLength(3); // capped at 3
  });

  it("tolerates chatty text around the JSON object", () => {
    const result = parseCloudReflection('בטח! הנה:\n{"summary":"סיכום","strengths":[],"risks":[],"nextSteps":[]}\nבהצלחה');
    expect(result.summary).toBe("סיכום");
    expect(result.strengths).toEqual([]);
  });

  it("rejects a response with no JSON object", () => {
    expect(() => parseCloudReflection("אין כאן JSON")).toThrow(CloudReflectionError);
  });

  it("rejects a response missing a summary", () => {
    expect(() => parseCloudReflection(JSON.stringify({ strengths: [] }))).toThrow(CloudReflectionError);
  });

  it("rejects an empty response", () => {
    expect(() => parseCloudReflection("   ")).toThrow(CloudReflectionError);
  });
});
