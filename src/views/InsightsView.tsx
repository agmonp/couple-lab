import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { InsightList, MiniMetric } from "../components/primitives";
import { TaggedTimeline } from "../components/TaggedTimeline";
import { EmptyArt } from "../illustrations";
import { formatTime } from "../lib/format";
import { partnerName } from "../lib/partners";
import { average } from "../lib/utils";
import { CoupleProfile, SessionRecord } from "../types";

export function InsightsView({ sessions, profile }: { sessions: SessionRecord[]; profile: CoupleProfile }) {
  const [selectedId, setSelectedId] = useState<string | undefined>(sessions[0]?.id);
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  const trend = sessions.length
    ? Math.round(average(sessions.map((session) => session.analysis.metrics.connectionPracticeScore)))
    : 0;

  useEffect(() => {
    if (!selectedId && sessions[0]) setSelectedId(sessions[0].id);
  }, [selectedId, sessions]);

  if (!sessions.length) {
    return (
      <div className="empty-large">
        <EmptyArt size={104} />
        <h2>No insights yet</h2>
        <p>Saved lab sessions will appear here with evidence-linked strengths, risks, and next steps.</p>
      </div>
    );
  }

  return (
    <section className="insights-grid">
      <aside className="session-list">
        <div className="trend-card">
          <span>Average practice score</span>
          <strong>{trend}%</strong>
        </div>
        {sessions.map((session) => (
          <button
            className={`session-button ${selected?.id === session.id ? "active" : ""}`}
            key={session.id}
            onClick={() => setSelectedId(session.id)}
          >
            <strong>{session.title}</strong>
            <span>{formatTime(session.durationSeconds)} - {session.analysis.metrics.connectionPracticeScore}%</span>
          </button>
        ))}
      </aside>

      {selected && (
        <div className="stack">
          <div className="panel">
            <div className="panel-heading">
              <h2>{selected.title}</h2>
              <span className="score-chip">{selected.analysis.metrics.connectionPracticeScore}%</span>
            </div>
            <p>{selected.analysis.summary}</p>
            <div className="metric-row wide">
              <MiniMetric label={`${partnerName(profile, "A")} words`} value={selected.analysis.metrics.wordsA} raw />
              <MiniMetric label={`${partnerName(profile, "B")} words`} value={selected.analysis.metrics.wordsB} raw />
              <MiniMetric label="Repairs" value={selected.analysis.metrics.repairSignals} raw />
              <MiniMetric label="Horsemen" value={selected.analysis.metrics.fourHorsemenSignals ?? 0} raw invert />
            </div>
            <div className="metric-row wide">
              <MiniMetric label="Warmth" value={selected.analysis.metrics.emotionalState?.warmth ?? 0} />
              <MiniMetric label="Engagement" value={selected.analysis.metrics.emotionalState?.engagement ?? 0} />
              <MiniMetric label="Tension" value={selected.analysis.metrics.emotionalState?.tension ?? 0} invert />
              <MiniMetric label="Withdrawal" value={selected.analysis.metrics.emotionalState?.withdrawal ?? 0} invert />
            </div>
          </div>

          <div className="two-col">
            <InsightList title="Strengths" items={selected.analysis.strengths} />
            <InsightList title="Risks" items={selected.analysis.risks} />
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Evidence-linked moments</h2>
              <ShieldCheck size={18} />
            </div>
            <div className="hit-list">
              {selected.analysis.hits.map((hit) => (
                <article key={hit.id} className={`hit ${hit.family}`}>
                  <span>{hit.label} - {Math.round(hit.confidence * 100)}%</span>
                  <p>{hit.evidence}</p>
                  <small>{hit.suggestion}</small>
                </article>
              ))}
            </div>
          </div>

          <div className="panel">
            <TaggedTimeline profile={profile} tags={(selected.analysis.tags ?? []).slice(0, 24)} title="Tagged interaction timeline" />
          </div>

          <div className="panel script-panel">
            <h2>Next practice script</h2>
            <p>{selected.analysis.suggestedScript}</p>
          </div>
        </div>
      )}
    </section>
  );
}
