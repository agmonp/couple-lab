import { Eye } from "lucide-react";
import { formatDuration, formatTime } from "../lib/format";
import { partnerName } from "../lib/partners";
import { CoupleProfile, NonverbalMetrics, VisualObservation } from "../types";
import { MiniMetric } from "./primitives";

export function NonverbalPanel({
  profile,
  metrics,
  observations,
  calibrationText
}: {
  profile: CoupleProfile;
  metrics: NonverbalMetrics;
  observations: VisualObservation[];
  calibrationText: string;
}) {
  const recent = observations.slice(-8).reverse();

  return (
    <div className="panel nonverbal-panel">
      <div className="panel-heading">
        <h2>Nonverbal analysis</h2>
        <Eye size={18} />
      </div>
      <p className="muted">{calibrationText}. Gaze metrics are probabilistic camera cues, not certainty.</p>
      <div className="nonverbal-grid">
        <MiniMetric label="Shared frame" value={metrics.sharedFrameSeconds} raw />
        <MiniMetric label="Mutual attention" value={metrics.mutualAttentionSeconds} raw />
        <MiniMetric label={`${partnerName(profile, "A")} gaze`} value={metrics.partnerGazeSecondsA} raw />
        <MiniMetric label={`${partnerName(profile, "B")} gaze`} value={metrics.partnerGazeSecondsB} raw />
      </div>
      <div className="nonverbal-summary">
        <span>
          {partnerName(profile, "A")} looked away: <b>{formatDuration(metrics.lookAwaySecondsA)}</b>
        </span>
        <span>
          {partnerName(profile, "B")} looked away: <b>{formatDuration(metrics.lookAwaySecondsB)}</b>
        </span>
        <span>
          Warmth cues: <b>{formatDuration(metrics.warmExpressionSeconds)}</b>
        </span>
        <span>
          Tension cues: <b>{formatDuration(metrics.tensionSeconds)}</b>
        </span>
        <span>
          Engagement cues: <b>{formatDuration(metrics.engagementSeconds ?? 0)}</b>
        </span>
        <span>
          Withdrawal cues: <b>{formatDuration(metrics.withdrawalSeconds ?? 0)}</b>
        </span>
      </div>
      <div className="visual-feed">
        {recent.length === 0 && <span>No nonverbal cues sampled yet.</span>}
        {recent.map((observation) => (
          <article key={observation.id}>
            <strong>{observation.label.replace(/-/g, " ")}</strong>
            <span>
              {observation.subject ? `${partnerName(profile, observation.subject)} - ` : ""}
              {formatTime(observation.seconds)} - {Math.round(observation.score * 100)}%
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}
