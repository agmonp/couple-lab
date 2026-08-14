import { Download, FileDown, Lock, ShieldCheck, Trash2 } from "lucide-react";
import { hasSafetyConcern, safetyItems } from "../lib/safety";
import { downloadBlob } from "../lib/storage";
import { AssessmentState, CoupleProfile, SafetyState, SessionRecord } from "../types";

export function ExportSafetyView({
  profile,
  assessment,
  sessions,
  safety,
  setSafety,
  clearAll
}: {
  profile: CoupleProfile;
  assessment: AssessmentState;
  sessions: SessionRecord[];
  safety: SafetyState;
  setSafety: (safety: SafetyState) => void;
  clearAll: () => void;
}) {
  const safetyFlag = hasSafetyConcern(safety);

  const exportJson = () => {
    downloadBlob(
      `couple-lab-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ profile, assessment, sessions, safety }, null, 2)
    );
  };

  const exportSummary = () => {
    const latest = sessions[0];
    const content = [
      "Couple Lab Therapist Summary",
      `Generated: ${new Date().toLocaleString()}`,
      `Partners: ${profile.partnerAName} and ${profile.partnerBName}`,
      `Focus: ${profile.relationshipGoal}`,
      "",
      "Safety",
      safetyFlag ? "Safety checklist has at least one active concern." : "No safety checklist concern selected.",
      "",
      "Recent Session",
      latest ? latest.title : "No saved sessions.",
      latest ? latest.analysis.summary : "",
      "",
      "Strengths",
      ...(latest?.analysis.strengths ?? ["No saved session strengths yet."]),
      "",
      "Risks",
      ...(latest?.analysis.risks ?? ["No saved session risks yet."]),
      "",
      "Next Steps",
      ...(latest?.analysis.nextSteps ?? ["Complete one guided lab session."])
    ].join("\n");
    downloadBlob(`couple-lab-summary-${new Date().toISOString().slice(0, 10)}.txt`, content, "text/plain");
  };

  return (
    <section className="stack">
      <div className={`safety-review ${safetyFlag ? "alert" : ""}`}>
        <ShieldCheck size={22} />
        <div>
          <strong>{safetyFlag ? "Use individual safety support before couples practice." : "Safety checklist clear."}</strong>
          <p>
            Couples practice is not appropriate when fear, coercion, threats, or active crisis are present.
          </p>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-heading">
            <h2>Local data</h2>
            <Lock size={18} />
          </div>
          <ul className="plain-list">
            <li>Browser permission controls camera and microphone access.</li>
            <li>Conversation text, visual observations, and session insights stay in this local app storage.</li>
            <li>Export is manual: JSON for raw data and text summary for later report work.</li>
          </ul>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Safety checklist</h2>
            <ShieldCheck size={18} />
          </div>
          {safetyItems.map((item) => (
            <label className="check-row" key={item.key}>
              <input
                type="checkbox"
                checked={Boolean(safety[item.key])}
                onChange={(event) => setSafety({ ...safety, [item.key]: event.target.checked, checkedAt: new Date().toISOString() })}
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>

      <div className="panel export-panel">
        <div className="panel-heading">
          <h2>Data</h2>
          <FileDown size={18} />
        </div>
        <div className="export-actions">
          <button className="primary" onClick={exportJson}>
            <Download size={17} />
            Export JSON
          </button>
          <button className="secondary" onClick={exportSummary}>
            <FileDown size={17} />
            Therapist summary
          </button>
          <button className="danger" onClick={clearAll}>
            <Trash2 size={17} />
            Delete local data
          </button>
        </div>
      </div>
    </section>
  );
}
