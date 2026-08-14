import {
  Activity,
  BookOpenCheck,
  Camera,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Sparkles,
  Video
} from "lucide-react";
import { useState } from "react";
import { Progress } from "../components/primitives";
import { CoupleHero } from "../illustrations";
import { View } from "../navigation";
import { CoupleProfile, SessionRecord } from "../types";

export function Dashboard({
  profile,
  setProfile,
  scores,
  latestSession,
  assessmentUpdated,
  setView,
  switchCouple
}: {
  profile: CoupleProfile;
  setProfile: (profile: CoupleProfile) => void;
  scores: { A: number; B: number; couple: number };
  latestSession?: SessionRecord;
  assessmentUpdated: boolean;
  setView: (view: View) => void;
  switchCouple: () => void;
}) {
  const [editingCouple, setEditingCouple] = useState(false);
  const nextAction = !assessmentUpdated && !latestSession
    ? {
        title: "Start with the couple assessment",
        body: "Map friendship, safety, intimacy, repair, and shared meaning before the first practice session.",
        view: "assess" as View,
        button: "Begin assessment",
        icon: ClipboardCheck
      }
    : !latestSession
      ? {
          title: "Start the first guided practice",
          body: "Choose a prompt, turn on the camera, talk for 10 minutes, then save the session.",
          view: "practice" as View,
          button: "Open Practice Studio",
          icon: Video
        }
      : {
          title: "Get today's relationship guidance",
          body: "Turn the latest session into one practical skill: repair, soft startup, flooding reset, or appreciation.",
          view: "adviser" as View,
          button: "Open Adviser",
          icon: Sparkles
        };
  const NextIcon = nextAction.icon;
  const processSteps = [
    { label: "Couple", done: Boolean(profile.partnerAName && profile.partnerBName), view: "dashboard" as View },
    { label: "Assess", done: assessmentUpdated, view: "assess" as View },
    { label: "Practice", done: Boolean(latestSession), view: "practice" as View },
    { label: "Insights", done: Boolean(latestSession), view: "insights" as View },
    { label: "Adviser", done: Boolean(latestSession), view: "adviser" as View },
    { label: "Report", done: Boolean(latestSession), view: "report" as View }
  ];
  const phaseTiles = [
    { label: "Assess", value: `${scores.couple}%`, view: "assess" as View, icon: ClipboardCheck },
    { label: "Practice", value: "Decks + camera", view: "practice" as View, icon: Sparkles },
    { label: "Reflect", value: latestSession ? `${latestSession.analysis.metrics.connectionPracticeScore}%` : "No session", view: "insights" as View, icon: Activity },
    { label: "Adviser", value: latestSession ? "Today" : "After session", view: "adviser" as View, icon: Sparkles },
    { label: "Report", value: latestSession ? "Ready" : "No data", view: "report" as View, icon: FileText }
  ];

  return (
    <section className="stack">
      <div className="welcome-hero panel">
        <div>
          <span className="eyebrow">Couple Lab</span>
          <h2 className="welcome-title">A calm place to practice connection.</h2>
          <p>
            Pick a conversation deck, press record when you're ready, and let the studio surface the
            warmth, repair attempts, and bids you can build on — together.
          </p>
        </div>
        <CoupleHero className="welcome-hero-art" />
      </div>
      <div className="workbench">
        <div className="profile-form couple-card">
          <div className="couple-card-header wide">
            <div>
              <span className="eyebrow">Saved couple</span>
              <strong>
                {profile.partnerAName || "Partner A"} + {profile.partnerBName || "Partner B"}
              </strong>
              <p>{profile.relationshipGoal}</p>
            </div>
            <div className="prompt-actions">
              <button className="secondary" onClick={() => setEditingCouple((value) => !value)}>
                {editingCouple ? "Done" : "Edit"}
              </button>
              <button className="secondary" onClick={switchCouple}>
                Switch couple
              </button>
            </div>
          </div>

          {editingCouple && (
            <>
              <label>
                Partner A
                <input
                  value={profile.partnerAName}
                  onChange={(event) => setProfile({ ...profile, partnerAName: event.target.value })}
                />
              </label>
              <label>
                Partner B
                <input
                  value={profile.partnerBName}
                  onChange={(event) => setProfile({ ...profile, partnerBName: event.target.value })}
                />
              </label>
              <label className="wide">
                Relationship focus
                <input
                  value={profile.relationshipGoal}
                  onChange={(event) => setProfile({ ...profile, relationshipGoal: event.target.value })}
                />
              </label>
            </>
          )}

          <div className="wide implied-consent">
            <Camera size={18} />
            Practice Studio starts camera, microphone, transcript, and visual analysis after the browser's first permission approval.
          </div>
        </div>

        <div className="score-panel">
          <span className="score-label">Practice readiness</span>
          <strong>{scores.couple}%</strong>
          <div className="dual-bars">
            <Progress label={profile.partnerAName || "A"} value={scores.A} />
            <Progress label={profile.partnerBName || "B"} value={scores.B} />
          </div>
        </div>
      </div>

      <div className="tile-grid four">
        {phaseTiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <button className="metric-tile" key={tile.label} onClick={() => setView(tile.view)}>
              <Icon size={20} />
              <span>{tile.label}</span>
              <strong>{tile.value}</strong>
              <ChevronRight size={18} />
            </button>
          );
        })}
      </div>

      <div className="process-panel panel">
        <div className="process-map">
          {processSteps.map((step, index) => (
            <button
              key={step.label}
              className={`process-step ${step.done ? "done" : ""} ${step.view === nextAction.view ? "current" : ""}`}
              onClick={() => setView(step.view)}
            >
              <span>{index + 1}</span>
              {step.label}
            </button>
          ))}
        </div>
        <div className="next-action">
          <NextIcon size={22} />
          <div>
            <strong>{nextAction.title}</strong>
            <p>{nextAction.body}</p>
          </div>
          <button className="primary" onClick={() => setView(nextAction.view)}>
            {nextAction.button}
          </button>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-heading">
            <h2>Weekly practice rhythm</h2>
            <BookOpenCheck size={18} />
          </div>
          <div className="checklist">
            {["Two short check-ins", "One guided conversation", "One appreciation ritual", "One playful or intimate prompt"].map(
              (item, index) => (
                <label className="practice-item" key={item}>
                  <input type="checkbox" defaultChecked={index === 0 && Boolean(latestSession)} />
                  <span>{item}</span>
                </label>
              )
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Latest reflection</h2>
            <Activity size={18} />
          </div>
          {latestSession ? (
            <div className="latest">
              <strong>{latestSession.title}</strong>
              <p>{latestSession.analysis.summary}</p>
              <button className="text-button" onClick={() => setView("insights")}>
                Review insights <ChevronRight size={16} />
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <p>No session saved yet.</p>
              <button className="primary" onClick={() => setView("practice")}>
                <Video size={17} />
                Open studio
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
