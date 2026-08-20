import type { LiveCue, TranscriptSegment, VisualObservation } from "./types";

export type PracticePhase =
  | "setup"
  | "requesting-permission"
  | "recording"
  | "finalizing"
  | "saving"
  | "analyzing"
  | "ready"
  | "error";

const allowedTransitions: Record<PracticePhase, PracticePhase[]> = {
  setup: ["requesting-permission", "saving", "error"],
  "requesting-permission": ["recording", "setup", "error"],
  recording: ["finalizing", "error"],
  finalizing: ["saving", "error"],
  saving: ["analyzing", "error"],
  analyzing: ["ready", "error"],
  ready: ["setup"],
  error: ["setup", "saving"]
};

export function canTransitionPractice(from: PracticePhase, to: PracticePhase) {
  return allowedTransitions[from].includes(to);
}

export interface SessionEvidenceInput {
  segments: TranscriptSegment[];
  cues: LiveCue[];
  observations: VisualObservation[];
}

export function sessionEvidenceSummary({ segments, cues, observations }: SessionEvidenceInput) {
  const behavioralObservations = observations.filter((observation) => observation.label !== "capture-quality");
  const words = segments.reduce(
    (sum, segment) => sum + (segment.wordCount ?? segment.text.trim().split(/\s+/).filter(Boolean).length),
    0
  );
  const corroboratingSignals = cues.length + Math.min(3, behavioralObservations.length);
  const sufficient = words >= 12 || (words >= 6 && corroboratingSignals >= 1);

  return {
    words,
    cues: cues.length,
    observations: behavioralObservations.length,
    evidenceCount: words + cues.length + behavioralObservations.length,
    sufficient,
    reasons: sufficient
      ? []
      : [
          words === 0 ? "לא נקלט תמלול" : "נקלט מעט מדי דיבור",
          cues.length === 0 && behavioralObservations.length === 0 ? "אין סימונים נוספים שתומכים בניתוח" : ""
        ].filter(Boolean)
  };
}
