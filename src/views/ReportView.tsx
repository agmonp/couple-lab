import {
  Activity,
  Camera,
  Download,
  Eye,
  FileDown,
  FileText,
  HeartHandshake,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useState } from "react";
import { InsightList, MiniMetric } from "../components/primitives";
import { TaggedTimeline } from "../components/TaggedTimeline";
import { domains, evidenceNotes } from "../data";
import { EmptyArt } from "../illustrations";
import { formatDuration } from "../lib/format";
import { sessionNonverbalMetrics, sumNonverbalMetrics } from "../lib/nonverbal";
import { partnerName } from "../lib/partners";
import { hasSafetyConcern } from "../lib/safety";
import { downloadBlob, useLocalState } from "../lib/storage";
import { average } from "../lib/utils";
import { AssessmentState, CoupleProfile, SafetyState, SessionRecord } from "../types";

export function ReportView({
  profile,
  assessment,
  sessions,
  safety
}: {
  profile: CoupleProfile;
  assessment: AssessmentState;
  sessions: SessionRecord[];
  safety: SafetyState;
}) {
  const [feedback, setFeedback] = useLocalState<Record<string, string>>("couple-lab-report-feedback", {});
  const [coachModel, setCoachModel] = useLocalState("couple-lab-ollama-model", "gemma3:4b");
  const [coachDraft, setCoachDraft] = useState("");
  const [coachStatus, setCoachStatus] = useState("Ready");
  const latest = sessions[0];
  const safetyFlag = hasSafetyConcern(safety);
  const domainRows = domains
    .map((domain) => {
      const a = assessment.A[domain.key] ?? 0;
      const b = assessment.B[domain.key] ?? 0;
      return {
        ...domain,
        score: Math.round(((a + b) / 2) * 10),
        gap: Math.abs(a - b)
      };
    })
    .sort((a, b) => a.score - b.score || b.gap - a.gap);
  const allHits = sessions.flatMap((session) => session.analysis.hits);
  const allTags = sessions.flatMap((session) => session.analysis.tags ?? []);
  const hitCounts = allHits.reduce<Record<string, number>>((acc, hit) => {
    acc[hit.label] = (acc[hit.label] ?? 0) + 1;
    return acc;
  }, {});
  const topPatterns = Object.entries(hitCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const reportScore = sessions.length
    ? Math.round(average(sessions.map((session) => session.analysis.metrics.connectionPracticeScore)))
    : Math.round(average(domainRows.map((row) => row.score)));
  const totalRepairs = sessions.reduce((sum, session) => sum + session.analysis.metrics.repairSignals, 0);
  const totalRisks = sessions.reduce((sum, session) => sum + session.analysis.metrics.riskSignals, 0);
  const visualCount = sessions.reduce((sum, session) => sum + (session.visualObservations?.length ?? 0), 0);
  const reportNonverbal = sumNonverbalMetrics(sessions.map(sessionNonverbalMetrics));
  const focusRows = domainRows.slice(0, 3);
  const exercises = [
    ...(latest?.analysis.nextSteps ?? []),
    ...focusRows.map((domain) => domain.practice)
  ].slice(0, 5);

  const reportText = [
    "CoupleLab Coaching Report",
    `Generated: ${new Date().toLocaleString()}`,
    `Couple: ${profile.partnerAName} + ${profile.partnerBName}`,
    `Focus: ${profile.relationshipGoal}`,
    `Practice score: ${reportScore}%`,
    `Saved sessions: ${sessions.length}`,
    `Repair signals: ${totalRepairs}`,
    `Risk signals: ${totalRisks}`,
    `Tagged moments: ${allTags.length}`,
    latest?.analysis.metrics.emotionalState
      ? `Latest emotional state: warmth ${latest.analysis.metrics.emotionalState.warmth}%, engagement ${latest.analysis.metrics.emotionalState.engagement}%, tension ${latest.analysis.metrics.emotionalState.tension}%, withdrawal ${latest.analysis.metrics.emotionalState.withdrawal}%`
      : "Latest emotional state: no saved session yet",
    `Visual observations: ${visualCount}`,
    `Shared frame: ${formatDuration(reportNonverbal.sharedFrameSeconds)}`,
    `Mutual attention: ${formatDuration(reportNonverbal.mutualAttentionSeconds)}`,
    `Possible engagement: ${formatDuration(reportNonverbal.engagementSeconds)}`,
    `Possible withdrawal: ${formatDuration(reportNonverbal.withdrawalSeconds)}`,
    "",
    "Safety",
    safetyFlag ? "Safety checklist has an active concern. Use individual/professional support before couples practice." : "Safety checklist clear.",
    "",
    "Top focus areas",
    ...focusRows.map((row) => `${row.label}: ${row.score}% - ${row.practice}`),
    "",
    "Strengths",
    ...(latest?.analysis.strengths ?? ["Complete a Practice Studio session to generate strengths."]),
    "",
    "Risks",
    ...(latest?.analysis.risks ?? ["Complete a Practice Studio session to generate risk patterns."]),
    "",
    "Exercises",
    ...exercises,
    "",
    "Accuracy stance",
    ...evidenceNotes
  ].join("\n");

  const runLocalCoach = async () => {
    setCoachStatus("Asking local Ollama coach...");
    setCoachDraft("");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: coachModel,
          stream: false,
          options: { temperature: 0.3, num_predict: 240 },
          prompt: [
            "You are a warm, non-clinical couples communication coach.",
            "Do not diagnose, predict divorce, assign blame, or claim certainty.",
            "Using the report below, write 3 concise strengths, 3 practice priorities, and one 10-minute exercise.",
            "Keep it gentle, specific, and actionable.",
            "",
            reportText
          ].join("\n")
        })
      });
      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }
      const data = (await response.json()) as { response?: string };
      setCoachDraft(data.response?.trim() || "Ollama returned an empty response.");
      setCoachStatus("Local coach ready");
    } catch (error) {
      setCoachStatus(
        error instanceof DOMException && error.name === "AbortError"
          ? "Local coach timed out. Try llama3.2:3b or make sure Ollama is warm."
          : error instanceof Error
            ? error.message
            : "Local coach unavailable"
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  return (
    <section className="stack report-print">
      <div className="report-hero panel">
        <div>
          <p className="eyebrow">Post-conversation coaching report</p>
          <h2>
            {profile.partnerAName} + {profile.partnerBName}
          </h2>
          <p>{profile.relationshipGoal}</p>
        </div>
        <div className="report-score">
          <span>Practice score</span>
          <strong>{reportScore}%</strong>
        </div>
      </div>

      <div className="tile-grid four">
        <div className="metric-tile static">
          <FileText size={20} />
          <span>Sessions</span>
          <strong>{sessions.length}</strong>
        </div>
        <div className="metric-tile static">
          <HeartHandshake size={20} />
          <span>Repairs</span>
          <strong>{totalRepairs}</strong>
        </div>
        <div className="metric-tile static">
          <Activity size={20} />
          <span>Risks</span>
          <strong>{totalRisks}</strong>
        </div>
        <div className="metric-tile static">
          <Camera size={20} />
          <span>Visual cues</span>
          <strong>{visualCount}</strong>
        </div>
      </div>

      <div className="two-col">
        <div className={`panel safety-review ${safetyFlag ? "alert" : ""}`}>
          <ShieldCheck size={22} />
          <div>
            <strong>{safetyFlag ? "Safety review needed" : "Safety checklist clear"}</strong>
            <p>
              {safetyFlag
                ? "Do not use conflict exercises when fear, coercion, threats, or crisis are active."
                : "The app can stay in practice mode. It still does not replace therapy."}
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Report actions</h2>
            <Download size={18} />
          </div>
          <div className="export-actions">
            <button className="primary" onClick={() => window.print()}>
              <FileDown size={17} />
              Print / Save PDF
            </button>
            <button className="secondary" onClick={() => downloadBlob("couplelab-report.txt", reportText, "text/plain")}>
              <Download size={17} />
              Download text
            </button>
          </div>
        </div>
      </div>

      <div className="panel local-coach">
        <div className="panel-heading">
          <h2>Local coach</h2>
          <Sparkles size={18} />
        </div>
        <div className="coach-controls">
          <label>
            Ollama model
            <select value={coachModel} onChange={(event) => setCoachModel(event.target.value)}>
              {["gemma3:4b", "gemma4:latest", "llama3.2:3b", "mistral:latest", "mistral-ctx16k:latest"].map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={runLocalCoach}>
            <Sparkles size={17} />
            Generate coaching note
          </button>
          <span className="muted">{coachStatus}</span>
        </div>
        {coachDraft && <div className="coach-draft">{coachDraft}</div>}
      </div>

      <div className="two-col">
        <InsightList title="Top focus areas" items={focusRows.map((row) => `${row.label}: ${row.practice}`)} />
        <InsightList title="Recommended exercises" items={exercises.length ? exercises : ["Complete one Practice Studio session."]} />
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>Nonverbal summary</h2>
          <Eye size={18} />
        </div>
        <div className="nonverbal-grid">
          <MiniMetric label="Shared frame" value={reportNonverbal.sharedFrameSeconds} raw />
          <MiniMetric label="Mutual attention" value={reportNonverbal.mutualAttentionSeconds} raw />
          <MiniMetric label={`${partnerName(profile, "A")} gaze`} value={reportNonverbal.partnerGazeSecondsA} raw />
          <MiniMetric label={`${partnerName(profile, "B")} gaze`} value={reportNonverbal.partnerGazeSecondsB} raw />
          <MiniMetric label="Engagement" value={reportNonverbal.engagementSeconds} raw />
          <MiniMetric label="Withdrawal" value={reportNonverbal.withdrawalSeconds} raw invert />
        </div>
        <p className="muted">
          These are camera-based cues for review. They are useful for noticing patterns, not for proving emotions.
        </p>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>Communication patterns</h2>
          <Activity size={18} />
        </div>
        <div className="tag-cloud">
          {topPatterns.length === 0 && <span>No patterns yet</span>}
          {topPatterns.map(([label, count]) => (
            <span key={label}>
              {label}: {count}
            </span>
          ))}
        </div>
      </div>

      {latest ? (
        <div className="panel">
          <div className="panel-heading">
            <h2>Latest session</h2>
            <span className="score-chip">{latest.analysis.metrics.connectionPracticeScore}%</span>
          </div>
          <p>{latest.analysis.summary}</p>
          <div className="two-col">
            <InsightList title="Strengths" items={latest.analysis.strengths} />
            <InsightList title="Risks" items={latest.analysis.risks} />
          </div>
          <div className="hit-list report-hits">
            {latest.analysis.hits.slice(0, 8).map((hit) => (
              <article key={hit.id} className={`hit ${hit.family}`}>
                <span>
                  {hit.label} - {Math.round(hit.confidence * 100)}%
                </span>
                <p>{hit.evidence}</p>
                <small>{hit.suggestion}</small>
              </article>
            ))}
          </div>
          <TaggedTimeline profile={profile} tags={(latest.analysis.tags ?? []).slice(0, 12)} title="Tagged moments" />
          <div className="accuracy-box">
            <strong>Did this analysis feel accurate?</strong>
            <div className="export-actions">
              {["Accurate", "Partly accurate", "Needs correction"].map((choice) => (
                <button
                  key={choice}
                  className={feedback[latest.id] === choice ? "primary" : "secondary"}
                  onClick={() => setFeedback({ ...feedback, [latest.id]: choice })}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-large">
          <EmptyArt size={104} />
          <h2>No report data yet</h2>
          <p>Complete and save one Practice Studio conversation to generate a coaching report.</p>
        </div>
      )}
    </section>
  );
}
