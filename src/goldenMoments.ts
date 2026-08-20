import type { InteractionTag, LiveCue, SessionRecord } from "./types";

/**
 * Golden moments.
 *
 * The analysis engine already timestamps the warm parts of a conversation:
 * validation, curiosity, emotional-bank deposits, accepted repair attempts, and
 * whatever the couple marked live as warmth or humor. Those timestamps plus the
 * recording that is already stored on the device are everything needed to hand
 * the couple a short reel of their own best moments.
 *
 * This module only *selects* moments. Playback seeks inside the existing
 * recording, so nothing is re-encoded, no new model runs, and no media is
 * copied or created.
 *
 * Deliberate limits: only positive families are eligible, camera cues are
 * geometry rather than emotion so they rank below anything spoken and are
 * described observationally, and a session with no positive evidence returns
 * an empty list rather than a padded one.
 */

export const GOLDEN_MOMENT_LEAD_SECONDS = 4;
export const GOLDEN_MOMENT_TAIL_SECONDS = 6;
const MIN_CLIP_SECONDS = 6;
const MAX_CLIP_SECONDS = 22;
/** Two picks must start at least this far apart to count as different moments. */
const MIN_SEPARATION_SECONDS = 12;

export interface GoldenMoment {
  id: string;
  /** Clip window inside the stored recording. */
  startSeconds: number;
  endSeconds: number;
  /** Where the moment itself sits, for the playhead marker. */
  anchorSeconds: number;
  title: string;
  /** The couple's own words, when the moment came from the transcript. */
  quote?: string;
  source: "transcript" | "manual-cue" | "visual";
  /** A camera cue sat next to this spoken moment and supports it. */
  corroboratedByCamera?: boolean;
  weight: number;
}

/** Labels the engine produces that are worth replaying, with a human title. */
const TAG_TITLES: Record<string, string> = {
  "תיקוף והקשבה": "רגע של הקשבה",
  "הפקדה בחשבון הרגשי": "משהו טוב שנאמר",
  "היענות לפנייה לקרבה": "רגע של קרבה",
  סקרנות: "רגע של סקרנות",
  "ניסיון תיקון": "רגע של תיקון",
  "ניסיון התיקון התקבל": "תיקון שהתקבל",
  "לקיחת אחריות": "רגע של אחריות",
  "פתיחה רכה": "פתיחה רכה",
  "רמז לתשוקה או חיות": "רגע של חיות"
};

/** How much each label is worth when ranking. Repair outranks everything. */
const TAG_WEIGHTS: Record<string, number> = {
  "ניסיון התיקון התקבל": 5,
  "היענות לפנייה לקרבה": 4,
  "הפקדה בחשבון הרגשי": 4,
  "תיקוף והקשבה": 3.5,
  "ניסיון תיקון": 3,
  "לקיחת אחריות": 3,
  סקרנות: 2.5,
  "פתיחה רכה": 2.5,
  "רמז לתשוקה או חיות": 2
};

/**
 * Camera cues that may carry a warm moment. These are geometry, not emotion,
 * so they are weighted well below anything spoken and are described in plain
 * observational language ("you were both smiling"), never as a feeling.
 */
const VISUAL_TITLES: Record<string, string> = {
  "רמז אפשרי לחום": "רגע חם במצלמה",
  "קשב הדדי אפשרי": "רגע שהסתכלתם זה על זו",
  "מבט אפשרי לעבר בן או בת הזוג": "רגע של מבט אחד לשני",
  "רצף אפשרי של חום": "כמה רגעים חמים ברצף"
};

const VISUAL_WEIGHTS: Record<string, number> = {
  "רצף אפשרי של חום": 2.2,
  "רמז אפשרי לחום": 1.8,
  "קשב הדדי אפשרי": 1.6,
  "מבט אפשרי לעבר בן או בת הזוג": 1.4
};

/** A camera cue this close to a spoken moment is treated as corroborating it. */
const CORROBORATION_WINDOW_SECONDS = 4;
const CORROBORATION_BOOST = 1.3;

const CUE_TITLES: Partial<Record<LiveCue["tone"], string>> = {
  warmth: "רגע של חום",
  humor: "רגע שצחקתם",
  softening: "רגע של התרככות",
  repair: "רגע של תיקון"
};

const CUE_WEIGHTS: Partial<Record<LiveCue["tone"], number>> = {
  humor: 4.5,
  warmth: 4,
  softening: 3.5,
  repair: 3
};

function clipWindow(anchorSeconds: number, durationSeconds: number) {
  const safeDuration = durationSeconds > 0 ? durationSeconds : anchorSeconds + GOLDEN_MOMENT_TAIL_SECONDS;
  const start = Math.max(0, anchorSeconds - GOLDEN_MOMENT_LEAD_SECONDS);
  const end = Math.min(safeDuration, Math.max(start + MIN_CLIP_SECONDS, anchorSeconds + GOLDEN_MOMENT_TAIL_SECONDS));
  return {
    startSeconds: Math.round(start * 10) / 10,
    endSeconds: Math.round(Math.min(end, start + MAX_CLIP_SECONDS) * 10) / 10
  };
}

function trimQuote(text: string, maxLength = 120) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function candidatesFromVisualTags(tags: InteractionTag[], durationSeconds: number): GoldenMoment[] {
  return tags
    .filter((tag) => tag.source === "visual")
    .filter((tag) => VISUAL_WEIGHTS[tag.label] !== undefined)
    .map((tag) => ({
      id: `golden-visual-${tag.id}`,
      ...clipWindow(tag.seconds, durationSeconds),
      anchorSeconds: tag.seconds,
      title: VISUAL_TITLES[tag.label] ?? tag.label,
      source: "visual" as const,
      weight: VISUAL_WEIGHTS[tag.label] * (0.6 + 0.4 * Math.min(1, Math.max(0, tag.confidence)))
    }));
}

function candidatesFromTags(tags: InteractionTag[], durationSeconds: number): GoldenMoment[] {
  return tags
    .filter((tag) => tag.source === "transcript" || tag.source === "manual-cue")
    .filter((tag) => TAG_WEIGHTS[tag.label] !== undefined)
    .map((tag) => ({
      id: `golden-${tag.id}`,
      ...clipWindow(tag.seconds, durationSeconds),
      anchorSeconds: tag.seconds,
      title: TAG_TITLES[tag.label] ?? tag.label,
      quote: tag.evidence ? trimQuote(tag.evidence) : undefined,
      source: tag.source === "manual-cue" ? ("manual-cue" as const) : ("transcript" as const),
      weight: TAG_WEIGHTS[tag.label] * (0.6 + 0.4 * Math.min(1, Math.max(0, tag.confidence)))
    }));
}

function candidatesFromCues(cues: LiveCue[], durationSeconds: number): GoldenMoment[] {
  return cues
    .filter((cue) => CUE_WEIGHTS[cue.tone] !== undefined)
    .map((cue) => ({
      id: `golden-cue-${cue.id}`,
      ...clipWindow(cue.seconds, durationSeconds),
      anchorSeconds: cue.seconds,
      title: CUE_TITLES[cue.tone] ?? "רגע טוב",
      source: "manual-cue" as const,
      // A cue is a deliberate human mark, so it is trusted without a confidence factor.
      weight: CUE_WEIGHTS[cue.tone] ?? 3
    }));
}

export interface SelectGoldenMomentsInput {
  tags: InteractionTag[];
  cues: LiveCue[];
  durationSeconds: number;
  limit?: number;
}

export function selectGoldenMoments({
  tags,
  cues,
  durationSeconds,
  limit = 3
}: SelectGoldenMomentsInput): GoldenMoment[] {
  const spoken = [...candidatesFromCues(cues, durationSeconds), ...candidatesFromTags(tags, durationSeconds)];
  const visual = candidatesFromVisualTags(tags, durationSeconds);

  // A camera cue next to something that was actually said is the strongest
  // case: it corroborates a spoken moment rather than standing alone. Boost the
  // spoken moment instead of adding a second clip of the same few seconds.
  const corroborated = spoken.map((moment) => {
    const nearbyVisual = visual.some(
      (cue) => Math.abs(cue.anchorSeconds - moment.anchorSeconds) <= CORROBORATION_WINDOW_SECONDS
    );
    return nearbyVisual
      ? { ...moment, weight: moment.weight * CORROBORATION_BOOST, corroboratedByCamera: true }
      : moment;
  });

  const candidates = [...corroborated, ...visual]
    .filter((moment) => Number.isFinite(moment.anchorSeconds) && moment.anchorSeconds >= 0)
    .sort((first, second) => second.weight - first.weight || first.anchorSeconds - second.anchorSeconds);

  const chosen: GoldenMoment[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= limit) break;
    const tooClose = chosen.some(
      (picked) => Math.abs(picked.anchorSeconds - candidate.anchorSeconds) < MIN_SEPARATION_SECONDS
    );
    if (tooClose) continue;
    chosen.push(candidate);
  }

  // Present them in the order they happened, so the reel replays the conversation.
  return chosen.sort((first, second) => first.anchorSeconds - second.anchorSeconds);
}

export function goldenMomentsForSession(session: SessionRecord, limit = 3): GoldenMoment[] {
  return selectGoldenMoments({
    tags: session.analysis?.tags ?? [],
    cues: session.cues ?? [],
    durationSeconds: session.durationSeconds ?? 0,
    limit
  });
}
