import { Lock, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import {
  defaultAssessment,
  defaultProfile,
  defaultSafety,
  defaultSignals,
  domains
} from "./data";
import { BrandLogo } from "./illustrations";
import { hasSafetyConcern } from "./lib/safety";
import { storageKeys, useLocalState } from "./lib/storage";
import { average } from "./lib/utils";
import { navItems, pageTitle, View } from "./navigation";
import {
  AssessmentState,
  BodySignals,
  CoupleProfile,
  SafetyState,
  SessionRecord
} from "./types";
import { AdviserView } from "./views/AdviserView";
import { AssessView } from "./views/AssessView";
import { Dashboard } from "./views/Dashboard";
import { ExportSafetyView } from "./views/ExportSafetyView";
import { InsightsView } from "./views/InsightsView";
import { PracticeStudio } from "./views/PracticeStudio";
import { ReportView } from "./views/ReportView";

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [profile, setProfile] = useLocalState<CoupleProfile>(storageKeys.profile, defaultProfile);
  const [assessment, setAssessment] = useLocalState<AssessmentState>(storageKeys.assessment, defaultAssessment);
  const [sessions, setSessions] = useLocalState<SessionRecord[]>(storageKeys.sessions, []);
  const [signals, setSignals] = useLocalState<BodySignals>(storageKeys.signals, defaultSignals);
  const [safety, setSafety] = useLocalState<SafetyState>(storageKeys.safety, defaultSafety);
  const [deckStats, setDeckStats] = useLocalState<Record<string, number>>(storageKeys.deckStats, {});

  const safetyFlag = hasSafetyConcern(safety);

  const scores = useMemo(() => {
    const valuesA = domains.map((domain) => assessment.A[domain.key] ?? 0);
    const valuesB = domains.map((domain) => assessment.B[domain.key] ?? 0);
    return {
      A: Math.round(average(valuesA) * 10),
      B: Math.round(average(valuesB) * 10),
      couple: Math.round(average([...valuesA, ...valuesB]) * 10)
    };
  }, [assessment]);

  const latestSession = sessions[0];

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <div className="brand-mark">
            <BrandLogo size={30} />
          </div>
          <div>
            <strong>Couple Lab</strong>
            <span>Connection Practice</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                className={`nav-item ${view === item.view ? "active" : ""}`}
                onClick={() => setView(item.view)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="privacy-panel">
          <Lock size={18} />
          <div>
            <strong>Local-first</strong>
            <span>Profiles, scores, transcripts, and exports stay in this browser storage.</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Private couples practice lab</p>
            <h1>{pageTitle(view)}</h1>
          </div>
          <div className={`safety-pill ${safetyFlag ? "alert" : ""}`}>
            <ShieldCheck size={16} />
            {safetyFlag ? "Safety review needed" : "Practice mode"}
          </div>
        </header>

        {view === "dashboard" && (
          <Dashboard
            profile={profile}
            setProfile={setProfile}
            scores={scores}
            latestSession={latestSession}
            assessmentUpdated={Boolean(assessment.updatedAt)}
            setView={setView}
            switchCouple={() => {
              if (!window.confirm("Start a new couple profile on this computer? Current local sessions will be cleared.")) {
                return;
              }
              setProfile({ ...defaultProfile, createdAt: new Date().toISOString() });
              setAssessment(defaultAssessment);
              setSessions([]);
              setSignals(defaultSignals);
              setSafety(defaultSafety);
              setDeckStats({});
            }}
          />
        )}
        {view === "assess" && (
          <AssessView profile={profile} assessment={assessment} setAssessment={setAssessment} />
        )}
        {view === "practice" && (
          <PracticeStudio
            profile={profile}
            setProfile={setProfile}
            signals={signals}
            setSessions={setSessions}
            safetyFlag={safetyFlag}
            deckStats={deckStats}
            setDeckStats={setDeckStats}
          />
        )}
        {view === "insights" && <InsightsView sessions={sessions} profile={profile} />}
        {view === "adviser" && (
          <AdviserView profile={profile} assessment={assessment} sessions={sessions} safety={safety} setView={setView} />
        )}
        {view === "report" && (
          <ReportView profile={profile} assessment={assessment} sessions={sessions} safety={safety} />
        )}
        {view === "export" && (
            <ExportSafetyView
              profile={profile}
              assessment={assessment}
            sessions={sessions}
            safety={safety}
            setSafety={setSafety}
            clearAll={() => {
              if (window.confirm("Delete local Couple Lab data from this browser?")) {
                Object.values(storageKeys).forEach((key) => localStorage.removeItem(key));
                window.location.reload();
              }
            }}
          />
        )}
      </main>
    </div>
  );
}

