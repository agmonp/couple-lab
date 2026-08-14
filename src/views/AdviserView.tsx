import { BookOpenCheck, HeartHandshake, Sparkles } from "lucide-react";
import { domains } from "../data";
import { hasSafetyConcern } from "../lib/safety";
import { View } from "../navigation";
import { AssessmentState, CoupleProfile, SafetyState, SessionRecord } from "../types";

export function AdviserView({
  profile,
  assessment,
  sessions,
  safety,
  setView
}: {
  profile: CoupleProfile;
  assessment: AssessmentState;
  sessions: SessionRecord[];
  safety: SafetyState;
  setView: (view: View) => void;
}) {
  const latest = sessions[0];
  const safetyFlag = hasSafetyConcern(safety);
  const domainRows = domains
    .map((domain) => ({
      ...domain,
      score: Math.round((((assessment.A[domain.key] ?? 0) + (assessment.B[domain.key] ?? 0)) / 2) * 10)
    }))
    .sort((a, b) => a.score - b.score);
  const focus = domainRows[0];
  const risks = latest?.analysis.hits.filter((hit) => hit.family === "risk").map((hit) => hit.label) ?? [];
  const hasRepair = Boolean(latest?.analysis.metrics.repairSignals);
  const floodingHigh = (latest?.analysis.metrics.floodingRisk ?? 0) > 55;
  const todaySkill = safetyFlag
    ? {
        title: "Pause couples conflict practice",
        body: "A safety flag is active. Use individual support and do not run conflict exercises inside the app right now.",
        action: "Open safety"
      }
    : floodingHigh
      ? {
          title: "Practice a flooding reset",
          body: "Your last session showed high overwhelm cues. Train a pause-and-return ritual before another hard topic.",
          action: "Try the reset"
        }
      : risks.includes("Contempt risk")
        ? {
            title: "Rebuild respect first",
            body: "Possible contempt-risk language appeared. Start with fondness and admiration before problem solving.",
            action: "Use admiration"
          }
        : !hasRepair && latest
          ? {
              title: "Add one repair attempt",
              body: "No repair was detected in the last session. Choose a phrase both partners will recognize.",
              action: "Practice repair"
            }
          : {
              title: `Build ${focus?.label ?? "connection"} today`,
              body: focus?.practice ?? "Complete one short check-in and save it to generate guidance.",
              action: latest ? "Start skill practice" : "Create first session"
            };

  const modules = [
    {
      title: "Four Horsemen radar",
      purpose: "Recognize criticism, contempt, defensiveness, and stonewalling before they take over.",
      detect: ["You always / you never", "mocking or superiority", "counterattack or excuse", "shutdown or long withdrawal"],
      doInstead: ["Gentle startup", "Name appreciation", "Own one small part", "Take a timed self-soothing break"]
    },
    {
      title: "Flooding reset",
      purpose: "Protect problem solving when the nervous system is overloaded.",
      detect: ["racing heart", "tight chest", "urge to escape", "can't think clearly", "voice or posture shifts"],
      doInstead: ["Pause for 20 minutes", "self-soothe without rehearsing the fight", "return with one caring sentence"]
    },
    {
      title: "Emotional Bank Account",
      purpose: "Create positive reserves you can draw on during stress.",
      detect: ["missed bids", "low appreciation", "assuming bad intent", "less benefit of the doubt"],
      doInstead: ["turn toward small bids", "make 5 deposits today", "notice one invisible effort", "repair a withdrawal"]
    },
    {
      title: "Fondness & Admiration",
      purpose: "Renew respect, care, romance, and goodwill.",
      detect: ["low warmth", "few compliments", "seeing only problems", "romance feels logistical"],
      doInstead: ["specific compliment", "catch partner doing something right", "share one proud memory", "thank effort out loud"]
    },
    {
      title: "Six conflict skills",
      purpose: "Move from stuck conflict to workable conversation.",
      detect: ["topic keeps looping", "both argue positions", "no clear request", "repair fails"],
      doInstead: [
        "soft startup",
        "state one need",
        "listen and summarize",
        "accept influence",
        "repair early",
        "make one specific agreement"
      ]
    },
    {
      title: "Gridlock to dreams",
      purpose: "Find the value, fear, identity, or dream underneath a stuck issue.",
      detect: ["same fight returns", "issue feels symbolic", "compromise feels like betrayal"],
      doInstead: ["ask what this means", "name the dream underneath", "separate flexible from sacred", "protect dignity first"]
    }
  ];

  return (
    <section className="stack">
      <div className="advisor-hero panel">
        <div>
          <p className="eyebrow">Personalized guidance today</p>
          <h2>{todaySkill.title}</h2>
          <p>{todaySkill.body}</p>
        </div>
        <button className="primary" onClick={() => setView(latest ? "practice" : "assess")}>
          <Sparkles size={17} />
          {todaySkill.action}
        </button>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-heading">
            <h2>Current relationship strengths</h2>
            <HeartHandshake size={18} />
          </div>
          <ul className="plain-list">
            {(latest?.analysis.strengths ?? [
              "Complete one Practice Studio session to discover strengths.",
              `${profile.partnerAName} and ${profile.partnerBName} already have a saved couple profile.`,
              "The app is ready to track repair, warmth, and attention over time."
            ]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Today's 10-minute practice</h2>
            <BookOpenCheck size={18} />
          </div>
          <ol className="ordered-list">
            <li>One partner uses a gentle startup: I feel, about, I need.</li>
            <li>The other summarizes before responding.</li>
            <li>Both make one Emotional Bank Account deposit.</li>
            <li>End with one repair phrase you will use next time.</li>
          </ol>
        </div>
      </div>

      <div className="advisor-grid">
        {modules.map((module) => (
          <article className="advisor-card" key={module.title}>
            <div>
              <h2>{module.title}</h2>
              <p>{module.purpose}</p>
            </div>
            <div>
              <strong>Recognize</strong>
              <div className="tag-cloud compact">
                {module.detect.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
            <div>
              <strong>Do instead</strong>
              <ul className="plain-list">
                {module.doInstead.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
