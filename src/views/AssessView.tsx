import { ClipboardCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Progress } from "../components/primitives";
import { domains } from "../data";
import { partnerName } from "../lib/partners";
import { AssessmentState, CoupleProfile, PartnerId } from "../types";

export function AssessView({
  profile,
  assessment,
  setAssessment
}: {
  profile: CoupleProfile;
  assessment: AssessmentState;
  setAssessment: (assessment: AssessmentState) => void;
}) {
  const [partner, setPartner] = useState<PartnerId>("A");
  const focusDomains = useMemo(() => {
    return domains
      .map((domain) => ({
        ...domain,
        average: ((assessment.A[domain.key] ?? 0) + (assessment.B[domain.key] ?? 0)) / 2,
        gap: Math.abs((assessment.A[domain.key] ?? 0) - (assessment.B[domain.key] ?? 0))
      }))
      .sort((a, b) => a.average - b.average || b.gap - a.gap)
      .slice(0, 3);
  }, [assessment]);

  const updateScore = (domainKey: string, value: number) => {
    setAssessment({
      ...assessment,
      [partner]: {
        ...assessment[partner],
        [domainKey]: value
      },
      updatedAt: new Date().toISOString()
    });
  };

  return (
    <section className="stack">
      <div className="segmented">
        {(["A", "B"] as PartnerId[]).map((id) => (
          <button className={partner === id ? "active" : ""} key={id} onClick={() => setPartner(id)}>
            {partnerName(profile, id)}
          </button>
        ))}
      </div>

      <div className="assessment-grid">
        <div className="panel assessment-panel">
          {domains.map((domain) => (
            <label className="slider-row" key={domain.key}>
              <span>
                <strong>{domain.label}</strong>
                <small>{domain.description}</small>
              </span>
              <input
                type="range"
                min="1"
                max="10"
                value={assessment[partner][domain.key] ?? 6}
                onChange={(event) => updateScore(domain.key, Number(event.target.value))}
              />
              <b>{assessment[partner][domain.key] ?? 6}</b>
            </label>
          ))}
        </div>

        <aside className="panel">
          <div className="panel-heading">
            <h2>Focus plan</h2>
            <ClipboardCheck size={18} />
          </div>
          <div className="focus-list">
            {focusDomains.map((domain) => (
              <article key={domain.key}>
                <strong>{domain.label}</strong>
                <Progress label="Couple average" value={Math.round(domain.average * 10)} />
                <p>{domain.practice}</p>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
