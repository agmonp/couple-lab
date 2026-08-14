import { NonverbalMetrics, PartnerId, SessionRecord, VisualObservation } from "../types";

/** The camera is sampled on a fixed interval, so cue counts convert to seconds. */
export const VISUAL_SAMPLE_SECONDS = 1.2;

export function visualSeconds(count: number) {
  return Math.round(count * VISUAL_SAMPLE_SECONDS);
}

/**
 * Explicit rather than derived: adding a field to NonverbalMetrics should fail the
 * build here, and every aggregation below picks the new field up automatically.
 */
export function emptyNonverbalMetrics(): NonverbalMetrics {
  return {
    sampleCount: 0,
    sharedFrameSeconds: 0,
    mutualAttentionSeconds: 0,
    partnerGazeSecondsA: 0,
    partnerGazeSecondsB: 0,
    lookAwaySecondsA: 0,
    lookAwaySecondsB: 0,
    warmExpressionSeconds: 0,
    tensionSeconds: 0,
    engagementSeconds: 0,
    withdrawalSeconds: 0
  };
}

export function computeNonverbalMetrics(observations: VisualObservation[]): NonverbalMetrics {
  const count = (label: VisualObservation["label"], subject?: PartnerId) =>
    observations.filter((observation) => observation.label === label && (!subject || observation.subject === subject)).length;

  return {
    sampleCount: new Set(observations.map((observation) => Math.round(observation.seconds))).size,
    sharedFrameSeconds: visualSeconds(count("shared-frame")),
    mutualAttentionSeconds: visualSeconds(count("mutual-attention")),
    partnerGazeSecondsA: visualSeconds(count("partner-gaze", "A")),
    partnerGazeSecondsB: visualSeconds(count("partner-gaze", "B")),
    lookAwaySecondsA: visualSeconds(count("looking-away", "A")),
    lookAwaySecondsB: visualSeconds(count("looking-away", "B")),
    warmExpressionSeconds: visualSeconds(count("warm-expression")),
    tensionSeconds: visualSeconds(
      count("brow-tension") + count("mouth-tension") + count("closed-posture") + count("leaning-away") + count("head-turned-away")
    ),
    engagementSeconds: visualSeconds(count("possible-engagement") + count("mutual-attention") + count("partner-gaze")),
    withdrawalSeconds: visualSeconds(count("possible-withdrawal") + count("leaning-away") + count("head-turned-away"))
  };
}

/** Sessions saved before nonverbalMetrics existed still carry their raw observations. */
export function sessionNonverbalMetrics(session: SessionRecord): NonverbalMetrics {
  return session.nonverbalMetrics ?? computeNonverbalMetrics(session.visualObservations ?? []);
}

export function sumNonverbalMetrics(entries: NonverbalMetrics[]): NonverbalMetrics {
  const total = emptyNonverbalMetrics();
  const keys = Object.keys(total) as (keyof NonverbalMetrics)[];

  for (const entry of entries) {
    for (const key of keys) {
      total[key] += entry[key] ?? 0;
    }
  }

  return total;
}
