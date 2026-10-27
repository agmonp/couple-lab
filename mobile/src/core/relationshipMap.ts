import { decks, domains } from "@shared/data";
import type { AssessmentDomain, PartnerId, StructuredSessionKind } from "@shared/types";
import type { AppState } from "./model";

/**
 * "מפת הקשר": each partner rates the ten domains of src/data.ts (1–10), alone
 * and in private. The two maps open together, like the daily answers, and only
 * once both filled theirs. What comes back is a starting point for a talk, not
 * a diagnosis: the three domains that call for practice, and where the two of
 * you see things differently. Never a total, never who rated what lower.
 *
 * A map is filled once a month at most (`round` = "YYYY-MM").
 */

export const MAP_DOMAINS: AssessmentDomain[] = domains;
/** Two ratings this far apart mean "you see this differently". */
export const SEE_DIFFERENTLY_GAP = 3;

export type MapScores = Record<string, number>;

export interface MapRound {
  round: string;
  /** This phone's own, still closed. */
  locked: Partial<Record<PartnerId, MapScores>>;
  ready: Partial<Record<PartnerId, true>>;
  consent: Partial<Record<PartnerId, true>>;
  revealed: Partial<Record<PartnerId, MapScores>>;
  /** When the map opened for both. */
  openedAt?: string;
}

export function mapRound(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function emptyRound(round: string): MapRound {
  return { round, locked: {}, ready: {}, consent: {}, revealed: {} };
}

export function mapDone(r: MapRound | undefined, partner: PartnerId) {
  return !!r && (r.locked[partner] !== undefined || !!r.ready[partner] || r.revealed[partner] !== undefined);
}

export function mapOpen(r: MapRound | undefined) {
  return !!r && r.revealed.A !== undefined && r.revealed.B !== undefined;
}

export function complete(scores: MapScores | undefined) {
  return !!scores && MAP_DOMAINS.every((d) => Number.isFinite(scores[d.key]));
}

/**
 * The round to work on now: one somebody already started and that has not
 * opened yet (even if the month turned), otherwise this month's.
 */
export function activeRound(state: AppState, now = new Date()): MapRound {
  const started = Object.values(state.maps)
    .filter((r) => !mapOpen(r))
    .sort((a, b) => (a.round < b.round ? 1 : -1))[0];
  return started ?? state.maps[mapRound(now)] ?? emptyRound(mapRound(now));
}

/** The latest round that opened for both, if any. */
export function latestOpenMap(state: AppState): MapRound | undefined {
  return Object.values(state.maps)
    .filter(mapOpen)
    .sort((a, b) => (a.round < b.round ? 1 : -1))[0];
}

export interface Focus {
  domain: AssessmentDomain;
  /** The two see this one differently (gap ≥ SEE_DIFFERENTLY_GAP). */
  differently: boolean;
}

/**
 * The three domains to practise: lowest shared average first, a wider gap
 * breaking ties (as the desktop app). Same order on both phones.
 */
export function focusDomains(a: MapScores, b: MapScores, count = 3): Focus[] {
  return MAP_DOMAINS.map((domain) => {
    const x = a[domain.key] ?? 0;
    const y = b[domain.key] ?? 0;
    return { domain, average: (x + y) / 2, gap: Math.abs(x - y) };
  })
    .sort((p, q) => p.average - q.average || q.gap - p.gap)
    .slice(0, count)
    .map(({ domain, gap }) => ({ domain, differently: gap >= SEE_DIFFERENTLY_GAP }));
}

/** Domains outside the focus list that the two rated far apart. */
export function seenDifferently(a: MapScores, b: MapScores, exclude: string[] = []) {
  return MAP_DOMAINS.filter((d) => !exclude.includes(d.key) && Math.abs((a[d.key] ?? 0) - (b[d.key] ?? 0)) >= SEE_DIFFERENTLY_GAP);
}

export type Practice =
  | { kind: "deck"; deckId: string }
  | { kind: "structured"; session: StructuredSessionKind }
  | { kind: "jar" }
  /** Today's question: a small daily turning toward each other. */
  | { kind: "daily" };

/** Where each domain is practised in the app, deepest-fitting first. */
const PRACTICE: Record<string, Practice[]> = {
  friendship: [{ kind: "deck", deckId: "love-maps" }, { kind: "deck", deckId: "open-ended" }],
  fondness: [{ kind: "deck", deckId: "fondness" }, { kind: "deck", deckId: "appreciation" }, { kind: "jar" }],
  turning: [{ kind: "deck", deckId: "turn-toward" }, { kind: "deck", deckId: "rituals" }, { kind: "daily" }],
  safety: [{ kind: "deck", deckId: "express-empathy" }, { kind: "deck", deckId: "great-listening" }, { kind: "structured", session: "stress-reducing" }],
  conflict: [{ kind: "deck", deckId: "i-feel" }, { kind: "deck", deckId: "express-needs" }, { kind: "structured", session: "aftermath" }],
  repair: [{ kind: "deck", deckId: "repair" }, { kind: "structured", session: "aftermath" }],
  intimacy: [{ kind: "deck", deckId: "desire" }, { kind: "deck", deckId: "open-ended" }],
  meaning: [{ kind: "deck", deckId: "shared-meaning" }, { kind: "deck", deckId: "rituals" }, { kind: "deck", deckId: "open-ended" }],
  flooding: [{ kind: "structured", session: "stress-reducing" }],
  teamwork: [{ kind: "deck", deckId: "date-opportunity" }, { kind: "structured", session: "stress-reducing" }]
};

/** The first practice for this domain that is open to the couple now. */
export function practiceFor(domainKey: string, openDeckIds: string[]): Practice | undefined {
  return (PRACTICE[domainKey] ?? []).find((p) => p.kind !== "deck" || (openDeckIds.includes(p.deckId) && decks.some((d) => d.id === p.deckId)));
}
