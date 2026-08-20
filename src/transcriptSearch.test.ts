import { describe, expect, it } from "vitest";
import { highlightPieces, matchSegmentText, normalizeForSearch, searchTerms, searchTranscripts } from "./transcriptSearch";
import type { SessionRecord, TranscriptSegment } from "./types";

function segment(id: string, text: string, seconds: number, extra: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id,
    speaker: "A",
    target: "B",
    text,
    seconds,
    endSeconds: seconds + 8,
    source: "speech",
    speakerAttribution: "automatic",
    ...extra
  };
}

function session(id: string, startedAt: string, segments: TranscriptSegment[], media = true): SessionRecord {
  return {
    id,
    title: `שיחה ${id}`,
    type: "daily-check-in",
    startedAt,
    durationSeconds: 600,
    segments,
    cues: [],
    visualObservations: [],
    signals: {} as SessionRecord["signals"],
    analysis: { tags: [] } as unknown as SessionRecord["analysis"],
    ...(media
      ? {
          media: {
            storage: "indexeddb",
            key: `media-${id}`,
            mimeType: "video/webm",
            sizeBytes: 1024,
            savedAt: startedAt
          } as SessionRecord["media"]
        }
      : {})
  };
}

describe("transcript search", () => {
  it("folds niqqud and final letters so everyday spelling matches", () => {
    expect(normalizeForSearch("שָׁלוֹם")).toBe(normalizeForSearch("שלום"));
    expect(normalizeForSearch("ילדים")).toContain(normalizeForSearch("ילד"));
  });

  it("drops single characters and punctuation from the query", () => {
    expect(searchTerms("על החופשה!")).toEqual(["על", "החופשה"]);
    expect(searchTerms("א")).toEqual([]);
  });

  it("returns highlight ranges that map back to the original text", () => {
    const text = "דיברנו על החופשה שלנו";
    const match = matchSegmentText(text, ["חופשה"]);
    expect(match).not.toBeNull();
    const highlighted = highlightPieces(text, match!.ranges)
      .filter((piece) => piece.match)
      .map((piece) => piece.text);
    expect(highlighted).toEqual(["חופשה"]);
  });

  it("keeps highlight ranges correct when the text carries niqqud", () => {
    const text = "אמרנו שָׁלוֹם";
    const match = matchSegmentText(text, ["שלום"]);
    expect(match).not.toBeNull();
    const marked = highlightPieces(text, match!.ranges).filter((piece) => piece.match).map((p) => p.text).join("");
    expect(marked).toContain("ש");
    expect(text.slice(match!.ranges[0].start, match!.ranges[0].end)).toBe("שָׁלוֹם");
  });

  it("ranks a segment containing every term above one with a single term", () => {
    const sessions = [
      session("s1", "2026-08-01T10:00:00.000Z", [
        segment("a", "דיברנו על הכסף וגם על החופשה", 30),
        segment("b", "רק על הכסף", 90)
      ])
    ];
    const hits = searchTranscripts(sessions, "כסף חופשה");
    expect(hits[0].segmentId).toBe("a");
    expect(hits).toHaveLength(2);
  });

  it("returns the timestamp and media availability needed to jump into the recording", () => {
    const sessions = [session("s1", "2026-08-01T10:00:00.000Z", [segment("a", "על החופשה בקיץ", 42)])];
    const [hit] = searchTranscripts(sessions, "חופשה");
    expect(hit.seconds).toBe(42);
    expect(hit.hasMedia).toBe(true);
    expect(hit.sessionId).toBe("s1");
  });

  it("marks a segment whose speaker was never attributed", () => {
    const sessions = [
      session("s1", "2026-08-01T10:00:00.000Z", [
        segment("a", "על החופשה", 10, { speakerAttribution: "unknown" })
      ])
    ];
    expect(searchTranscripts(sessions, "חופשה")[0].speakerKnown).toBe(false);
  });

  it("returns nothing for an empty or too-short query", () => {
    const sessions = [session("s1", "2026-08-01T10:00:00.000Z", [segment("a", "טקסט כלשהו", 5)])];
    expect(searchTranscripts(sessions, "   ")).toEqual([]);
    expect(searchTranscripts(sessions, "א")).toEqual([]);
  });
});
