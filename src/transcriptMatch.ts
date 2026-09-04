/**
 * Noise-tolerant matching of Gottman-informed patterns against a transcript.
 *
 * The pattern engine keys on exact Hebrew phrases. Local speech-to-text is
 * "close but wrong" often enough that an exact match silently misses the skill
 * or horseman that was actually spoken — a full miss, not a soft one. This
 * module adds a conservative fuzzy layer on top of the exact regex path.
 *
 * The design is deliberately cautious, because for this product a *false*
 * "contempt" tag is worse than a missed one:
 *
 *   - Short function words (עד 3 אותיות) must match exactly.
 *   - Longer words tolerate a tiny edit budget (1 edit for 4-6 chars, 2 for 7+),
 *     which is where a misheard vowel or swapped letter lives.
 *   - A phrase matches only when *every* token matches in one window.
 *   - Fuzzy matches are reported separately so callers can lower confidence and
 *     mark them as tentative rather than certain.
 *
 * All functions are pure and unit-tested in src/transcriptMatch.test.ts.
 */

import { normalizeForSearch } from "./transcriptSearch";

/** Tokenize to normalized Hebrew/Latin word tokens, folding niqqud and finals. */
export function normalizedTokens(text: string): string[] {
  return normalizeForSearch(text)
    .split(/[^\p{L}\p{N}']+/u)
    .map((token) => token.replace(/^['"]+|['"]+$/g, ""))
    .filter(Boolean);
}

/** Classic Levenshtein edit distance between two short strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** How many edits a single token may absorb, scaled by its length. */
export function tokenEditBudget(tokenLength: number): number {
  if (tokenLength <= 3) return 0;
  if (tokenLength <= 6) return 1;
  return 2;
}

function tokenMatches(patternToken: string, spokenToken: string): boolean {
  const budget = tokenEditBudget(patternToken.length);
  if (budget === 0) return patternToken === spokenToken;
  // A big length gap can never be a mishearing; reject before the O(n*m) work.
  if (Math.abs(patternToken.length - spokenToken.length) > budget) return false;
  return levenshtein(patternToken, spokenToken) <= budget;
}

/**
 * True when the token sequence of `phrase` appears in `spokenTokens` as a
 * contiguous window where every token matches within its edit budget.
 */
export function fuzzyPhraseMatch(spokenTokens: string[], phrase: string): boolean {
  const phraseTokens = normalizedTokens(phrase);
  if (phraseTokens.length === 0) return false;
  if (phraseTokens.length > spokenTokens.length) return false;

  for (let start = 0; start <= spokenTokens.length - phraseTokens.length; start += 1) {
    let allMatch = true;
    for (let offset = 0; offset < phraseTokens.length; offset += 1) {
      if (!tokenMatches(phraseTokens[offset], spokenTokens[start + offset])) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  return false;
}

/** True when any of the phrases fuzzily matches the spoken text. */
export function fuzzyMatchesAny(text: string, phrases: readonly string[]): boolean {
  if (phrases.length === 0) return false;
  const spokenTokens = normalizedTokens(text);
  if (spokenTokens.length === 0) return false;
  return phrases.some((phrase) => fuzzyPhraseMatch(spokenTokens, phrase));
}
