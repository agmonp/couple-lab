import type { SessionRecord, TranscriptSegment } from "./types";

/**
 * Search across saved conversations.
 *
 * Everything is already on the device, so "what did we say about the holiday"
 * is a local text match over stored transcript segments. The result carries a
 * timestamp, so the couple can jump to the moment in the recording and watch it
 * rather than argue about who said what.
 *
 * Matching is deliberately literal: normalized substring and whole-word
 * matching only. Nothing is inferred, reworded, or ranked by a model.
 */

export interface TranscriptSearchHit {
  sessionId: string;
  sessionTitle: string;
  startedAt: string;
  segmentId: string;
  speaker: TranscriptSegment["speaker"];
  speakerKnown: boolean;
  seconds: number;
  text: string;
  /** Character ranges inside `text` that matched, for highlighting. */
  ranges: { start: number; end: number }[];
  score: number;
  hasMedia: boolean;
}

/**
 * Folds Hebrew niqqud and final letters so "שלום" matches "שָׁלוֹם" and a query
 * for "ילד" also reaches "ילדים". Latin text is lowercased.
 */
export function normalizeForSearch(value: string) {
  return value
    .normalize("NFKD")
    // Combining marks: niqqud, teamim, and Latin diacritics.
    .replace(/[̀-֑ͯ-ׇ]/g, "")
    .replace(/׳/g, "'")
    .replace(/״/g, '"')
    // Final forms fold to their base letter.
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ")
    .toLocaleLowerCase("he");
}

export function searchTerms(query: string) {
  return normalizeForSearch(query)
    .split(/[^\p{L}\p{N}']+/u)
    .map((term) => term.replace(/^['"]+|['"]+$/g, ""))
    // Two characters is the shortest useful Hebrew root fragment.
    .filter((term) => term.length >= 2);
}

/**
 * Builds a normalized copy of `text` plus an index mapping each normalized
 * character back to its original offset, so highlight ranges stay correct even
 * though normalization can change string length.
 */
function normalizedWithIndex(text: string) {
  let normalized = "";
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const piece = normalizeForSearch(text[index]);
    for (let step = 0; step < piece.length; step += 1) {
      normalized += piece[step];
      offsets.push(index);
    }
  }
  return { normalized, offsets };
}

function mergeRanges(ranges: { start: number; end: number }[]) {
  const sorted = [...ranges].sort((first, second) => first.start - second.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

interface SegmentMatch {
  ranges: { start: number; end: number }[];
  score: number;
}

export function matchSegmentText(text: string, terms: string[]): SegmentMatch | null {
  // Normalize defensively: a caller may pass raw words, and an un-folded final
  // letter ("שלום" vs the folded "שלומ") would silently never match.
  // Normalization is idempotent, so pre-normalized terms are unaffected.
  const normalizedTerms = terms.map((term) => normalizeForSearch(term)).filter(Boolean);
  if (!normalizedTerms.length) return null;
  const { normalized, offsets } = normalizedWithIndex(text);
  if (!normalized) return null;

  const ranges: { start: number; end: number }[] = [];
  let matchedTerms = 0;
  let score = 0;

  for (const term of normalizedTerms) {
    let found = false;
    let cursor = normalized.indexOf(term);
    while (cursor !== -1) {
      found = true;
      const start = offsets[cursor];
      const lastIndex = Math.min(cursor + term.length - 1, offsets.length - 1);
      ranges.push({ start, end: offsets[lastIndex] + 1 });
      // A match on a word boundary is a stronger signal than one inside a word.
      const atWordStart = cursor === 0 || !/[\p{L}\p{N}]/u.test(normalized[cursor - 1]);
      score += atWordStart ? 2 : 1;
      cursor = normalized.indexOf(term, cursor + term.length);
    }
    if (found) matchedTerms += 1;
  }

  if (!matchedTerms) return null;
  // Segments containing every term rank above segments with only some.
  const coverage = matchedTerms / normalizedTerms.length;
  return { ranges: mergeRanges(ranges), score: score * coverage * coverage };
}

export interface SearchTranscriptsOptions {
  limit?: number;
}

export function searchTranscripts(
  sessions: SessionRecord[],
  query: string,
  { limit = 40 }: SearchTranscriptsOptions = {}
): TranscriptSearchHit[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];

  const hits: TranscriptSearchHit[] = [];
  for (const session of sessions) {
    for (const segment of session.segments ?? []) {
      const match = matchSegmentText(segment.text, terms);
      if (!match) continue;
      hits.push({
        sessionId: session.id,
        sessionTitle: session.title,
        startedAt: session.startedAt,
        segmentId: segment.id,
        speaker: segment.speaker,
        speakerKnown: segment.speakerAttribution !== "unknown",
        seconds: segment.seconds,
        text: segment.text,
        ranges: match.ranges,
        score: match.score,
        hasMedia: Boolean(session.media)
      });
    }
  }

  return hits
    .sort(
      (first, second) =>
        second.score - first.score ||
        // Recent conversations first when relevance ties.
        new Date(second.startedAt).getTime() - new Date(first.startedAt).getTime() ||
        first.seconds - second.seconds
    )
    .slice(0, limit);
}

/** Splits `text` into alternating plain/highlighted pieces for rendering. */
export function highlightPieces(text: string, ranges: { start: number; end: number }[]) {
  const pieces: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) pieces.push({ text: text.slice(cursor, range.start), match: false });
    pieces.push({ text: text.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), match: false });
  return pieces.filter((piece) => piece.text.length > 0);
}
