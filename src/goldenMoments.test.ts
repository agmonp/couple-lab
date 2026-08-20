import { describe, expect, it } from "vitest";
import { selectGoldenMoments } from "./goldenMoments";
import type { InteractionTag, LiveCue } from "./types";

function tag(label: string, seconds: number, extra: Partial<InteractionTag> = {}): InteractionTag {
  return {
    id: `tag-${label}-${seconds}`,
    label,
    family: "strength",
    source: "transcript",
    seconds,
    evidence: "אני שומע אותך וזה נשמע לי חשוב",
    confidence: 0.8,
    ...extra
  };
}

describe("golden moments", () => {
  it("returns nothing when the session has no positive evidence", () => {
    const moments = selectGoldenMoments({
      tags: [tag("חשש לניסוח מזלזל", 30, { family: "four-horsemen" })],
      cues: [],
      durationSeconds: 300
    });
    expect(moments).toEqual([]);
  });

  it("picks the strongest positive moments and orders them chronologically", () => {
    const moments = selectGoldenMoments({
      tags: [
        tag("סקרנות", 200),
        tag("ניסיון התיקון התקבל", 40),
        tag("הפקדה בחשבון הרגשי", 120)
      ],
      cues: [],
      durationSeconds: 300
    });
    expect(moments).toHaveLength(3);
    expect(moments.map((moment) => moment.anchorSeconds)).toEqual([40, 120, 200]);
    expect(moments[0].title).toBe("תיקון שהתקבל");
  });

  it("keeps clips inside the recording and gives them a usable length", () => {
    const [moment] = selectGoldenMoments({
      tags: [tag("תיקוף והקשבה", 1)],
      cues: [],
      durationSeconds: 60
    });
    expect(moment.startSeconds).toBe(0);
    expect(moment.endSeconds).toBeGreaterThanOrEqual(6);
    expect(moment.endSeconds).toBeLessThanOrEqual(60);
  });

  it("does not return two clips of the same moment", () => {
    const moments = selectGoldenMoments({
      tags: [tag("תיקוף והקשבה", 100), tag("הפקדה בחשבון הרגשי", 103), tag("סקרנות", 104)],
      cues: [],
      durationSeconds: 300
    });
    expect(moments).toHaveLength(1);
  });

  it("ranks a humour cue the couple marked above a routine transcript tag", () => {
    const cues: LiveCue[] = [{ id: "cue-1", speaker: "A", tone: "humor", seconds: 150 }];
    const moments = selectGoldenMoments({
      tags: [tag("סקרנות", 20)],
      cues,
      durationSeconds: 300,
      limit: 1
    });
    expect(moments).toHaveLength(1);
    expect(moments[0].title).toBe("רגע שצחקתם");
    expect(moments[0].source).toBe("manual-cue");
  });

  it("ignores camera-only observations as a source of golden moments", () => {
    const moments = selectGoldenMoments({
      tags: [tag("חום אפשרי", 50, { source: "visual", family: "nonverbal" })],
      cues: [],
      durationSeconds: 300
    });
    expect(moments).toEqual([]);
  });

  it("carries the couple's own words as the quote", () => {
    const [moment] = selectGoldenMoments({
      tags: [tag("תיקוף והקשבה", 80, { evidence: "תודה שסיפרת לי, זה עזר לי להבין" })],
      cues: [],
      durationSeconds: 300
    });
    expect(moment.quote).toBe("תודה שסיפרת לי, זה עזר לי להבין");
  });
});

describe("golden moments — camera cues", () => {
  function visualTag(label: string, seconds: number): InteractionTag {
    return {
      id: `visual-${label}-${seconds}`,
      label,
      family: "nonverbal",
      source: "visual",
      seconds,
      evidence: label,
      confidence: 0.8
    };
  }

  it("can surface a warm camera moment when nothing positive was transcribed", () => {
    const moments = selectGoldenMoments({
      tags: [visualTag("רמז אפשרי לחום", 60)],
      cues: [],
      durationSeconds: 300
    });
    expect(moments).toHaveLength(1);
    expect(moments[0].source).toBe("visual");
    expect(moments[0].title).toBe("רגע חם במצלמה");
    // Observational, never a claim about feeling.
    expect(moments[0].title).not.toContain("שמח");
  });

  it("still ignores camera cues that are not warm", () => {
    const moments = selectGoldenMoments({
      tags: [visualTag("רמז אפשרי למתח בפנים", 60), visualTag("תנוחה סגורה אפשרית", 90)],
      cues: [],
      durationSeconds: 300
    });
    expect(moments).toEqual([]);
  });

  it("ranks a spoken moment above a camera-only moment", () => {
    const moments = selectGoldenMoments({
      tags: [visualTag("רמז אפשרי לחום", 200), tag("סקרנות", 40)],
      cues: [],
      durationSeconds: 300,
      limit: 2
    });
    expect(moments.find((moment) => moment.anchorSeconds === 40)!.source).toBe("transcript");
    const bySpoken = [...moments].sort((a, b) => b.weight - a.weight)[0];
    expect(bySpoken.source).toBe("transcript");
  });

  it("boosts a spoken moment that the camera corroborates instead of duplicating it", () => {
    const withCamera = selectGoldenMoments({
      tags: [tag("סקרנות", 100), visualTag("רמז אפשרי לחום", 102)],
      cues: [],
      durationSeconds: 300
    });
    const withoutCamera = selectGoldenMoments({
      tags: [tag("סקרנות", 100)],
      cues: [],
      durationSeconds: 300
    });
    expect(withCamera).toHaveLength(1);
    expect(withCamera[0].corroboratedByCamera).toBe(true);
    expect(withCamera[0].weight).toBeGreaterThan(withoutCamera[0].weight);
  });
});
