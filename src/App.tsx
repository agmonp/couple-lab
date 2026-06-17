import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker
} from "@mediapipe/tasks-vision";
import {
  Activity,
  BookOpenCheck,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  Download,
  Eye,
  FileDown,
  FileText,
  HeartHandshake,
  Lock,
  Mic,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Video
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeSession } from "./relationshipEngine";
import {
  decks,
  defaultAssessment,
  defaultProfile,
  defaultSafety,
  defaultSignals,
  domains,
  evidenceNotes
} from "./data";
import { BrandLogo, CoupleHero, CameraEmptyArt, EmptyArt } from "./illustrations";
import {
  AssessmentState,
  BodySignals,
  CoupleProfile,
  Deck,
  InteractionTag,
  LiveCue,
  NonverbalMetrics,
  PartnerId,
  SafetyState,
  SessionRecord,
  SessionType,
  SpeechRecognitionLike,
  TranscriptSegment,
  VisualObservation
} from "./types";

type View = "dashboard" | "assess" | "practice" | "insights" | "adviser" | "report" | "export";
type SpeechLanguage = "he-IL" | "en-US";

const storageKeys = {
  profile: "couple-lab-profile",
  assessment: "couple-lab-assessment",
  sessions: "couple-lab-sessions",
  signals: "couple-lab-signals",
  safety: "couple-lab-safety",
  deckStats: "couple-lab-deck-stats"
};

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}

function useLocalState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function partnerName(profile: CoupleProfile, partner: PartnerId) {
  return partner === "A" ? profile.partnerAName || "Partner A" : profile.partnerBName || "Partner B";
}

function slotName(slot: "left" | "right") {
  return slot === "left" ? "left side of the frame" : "right side of the frame";
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function otherPartner(partner: PartnerId): PartnerId {
  return partner === "A" ? "B" : "A";
}

function spokenWordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function estimateSpeechDuration(text: string) {
  return clamp(Math.ceil(spokenWordCount(text) / 2.4), 2, 18);
}

const VISUAL_SAMPLE_SECONDS = 1.2;

function visualSeconds(count: number) {
  return Math.round(count * VISUAL_SAMPLE_SECONDS);
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function detectScriptLanguage(text: string): SpeechLanguage | null {
  const hebrewCount = (text.match(/[\u0590-\u05FF]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;

  if (hebrewCount >= 2 && hebrewCount >= latinCount) return "he-IL";
  if (latinCount >= 4 && latinCount > hebrewCount) return "en-US";
  return null;
}

function hasHebrewText(text: string) {
  return /[\u0590-\u05FF]/.test(text);
}

function chooseInitialSpeechLanguage(profile: CoupleProfile, segments: TranscriptSegment[]): SpeechLanguage {
  const recentTranscript = segments
    .slice(-6)
    .map((segment) => segment.text)
    .join(" ");
  const detected = detectScriptLanguage(recentTranscript);

  if (detected) return detected;
  if (hasHebrewText(`${profile.partnerAName} ${profile.partnerBName}`)) return "he-IL";
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("he")) return "he-IL";
  return "en-US";
}

function computeNonverbalMetrics(observations: VisualObservation[]): NonverbalMetrics {
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

function downloadBlob(filename: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const sessionTypes: { id: SessionType; label: string }[] = [
  { id: "daily-check-in", label: "Daily check-in" },
  { id: "conflict", label: "Conflict" },
  { id: "repair", label: "Repair" },
  { id: "intimacy", label: "Intimacy" },
  { id: "shared-meaning", label: "Shared meaning" }
];

const transcriptLanguages: { id: "auto" | SpeechLanguage; label: string }[] = [
  { id: "auto", label: "Auto Hebrew / English" },
  { id: "he-IL", label: "Hebrew" },
  { id: "en-US", label: "English" }
];

const localEngineChecks = [
  {
    id: "mediapipe",
    label: "MediaPipe",
    detail: "Browser face/body",
    url: ""
  },
  {
    id: "whisper",
    label: "Whisper",
    detail: "Local transcript",
    url: "http://127.0.0.1:11435/health"
  },
  {
    id: "openface",
    label: "OpenFace",
    detail: "AU/gaze/emotion",
    url: "http://127.0.0.1:11436/health"
  },
  {
    id: "opensmile",
    label: "openSMILE",
    detail: "Voice stress",
    url: "http://127.0.0.1:11437/health"
  }
];

const cueOptions: { tone: LiveCue["tone"]; label: string }[] = [
  { tone: "warmth", label: "Warmth" },
  { tone: "repair", label: "Repair" },
  { tone: "humor", label: "Humor" },
  { tone: "softening", label: "Softening" },
  { tone: "look-away", label: "Look away" },
  { tone: "overwhelm", label: "Overwhelm" },
  { tone: "pause", label: "Pause" }
];

const navItems: { view: View; label: string; icon: typeof HeartHandshake }[] = [
  { view: "dashboard", label: "Dashboard", icon: HeartHandshake },
  { view: "assess", label: "Assess", icon: ClipboardCheck },
  { view: "practice", label: "Practice", icon: Video },
  { view: "insights", label: "Insights", icon: Activity },
  { view: "adviser", label: "Adviser", icon: Sparkles },
  { view: "report", label: "Report", icon: FileText },
  { view: "export", label: "Export", icon: ShieldCheck }
];

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [profile, setProfile] = useLocalState<CoupleProfile>(storageKeys.profile, defaultProfile);
  const [assessment, setAssessment] = useLocalState<AssessmentState>(storageKeys.assessment, defaultAssessment);
  const [sessions, setSessions] = useLocalState<SessionRecord[]>(storageKeys.sessions, []);
  const [signals, setSignals] = useLocalState<BodySignals>(storageKeys.signals, defaultSignals);
  const [safety, setSafety] = useLocalState<SafetyState>(storageKeys.safety, defaultSafety);
  const [deckStats, setDeckStats] = useLocalState<Record<string, number>>(storageKeys.deckStats, {});

  const safetyFlag = Object.values({
    fearOrCoercion: safety.fearOrCoercion,
    violenceOrThreats: safety.violenceOrThreats,
    pressuredToParticipate: safety.pressuredToParticipate,
    seriousDepressionOrAddiction: safety.seriousDepressionOrAddiction
  }).some(Boolean);

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
              localStorage.removeItem(storageKeys.assessment);
              localStorage.removeItem(storageKeys.sessions);
              localStorage.removeItem(storageKeys.safety);
              localStorage.removeItem(storageKeys.deckStats);
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

function pageTitle(view: View) {
  const titles: Record<View, string> = {
    dashboard: "Relationship dashboard",
    assess: "Couple assessment",
    practice: "Practice Studio",
    insights: "Session insights",
    adviser: "Relationship Adviser",
    report: "Couple report",
    export: "Export & safety"
  };
  return titles[view];
}

function Dashboard({
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

function ReportView({
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
  const safetyFlag =
    safety.fearOrCoercion ||
    safety.violenceOrThreats ||
    safety.pressuredToParticipate ||
    safety.seriousDepressionOrAddiction;
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
  const reportNonverbal = sessions.reduce<NonverbalMetrics>(
    (acc, session) => {
      const metrics = session.nonverbalMetrics ?? computeNonverbalMetrics(session.visualObservations ?? []);
      return {
        sampleCount: acc.sampleCount + metrics.sampleCount,
        sharedFrameSeconds: acc.sharedFrameSeconds + metrics.sharedFrameSeconds,
        mutualAttentionSeconds: acc.mutualAttentionSeconds + metrics.mutualAttentionSeconds,
        partnerGazeSecondsA: acc.partnerGazeSecondsA + metrics.partnerGazeSecondsA,
        partnerGazeSecondsB: acc.partnerGazeSecondsB + metrics.partnerGazeSecondsB,
        lookAwaySecondsA: acc.lookAwaySecondsA + metrics.lookAwaySecondsA,
        lookAwaySecondsB: acc.lookAwaySecondsB + metrics.lookAwaySecondsB,
        warmExpressionSeconds: acc.warmExpressionSeconds + metrics.warmExpressionSeconds,
        tensionSeconds: acc.tensionSeconds + metrics.tensionSeconds,
        engagementSeconds: acc.engagementSeconds + (metrics.engagementSeconds ?? 0),
        withdrawalSeconds: acc.withdrawalSeconds + (metrics.withdrawalSeconds ?? 0)
      };
    },
    {
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
    }
  );
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

function AssessView({
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

function DecksView({
  deckStats,
  setDeckStats,
  profile
}: {
  deckStats: Record<string, number>;
  setDeckStats: (stats: Record<string, number>) => void;
  profile: CoupleProfile;
}) {
  const [activeDeck, setActiveDeck] = useState<Deck>(decks[0]);
  const [cardIndex, setCardIndex] = useState(0);

  const draw = (deck = activeDeck) => {
    const next = Math.floor(Math.random() * deck.cards.length);
    setCardIndex(next === cardIndex ? (next + 1) % deck.cards.length : next);
  };

  return (
    <section className="deck-layout">
      <div className="deck-list">
        {decks.map((deck) => (
          <button
            key={deck.id}
            className={`deck-button ${activeDeck.id === deck.id ? "active" : ""}`}
            onClick={() => {
              setActiveDeck(deck);
              setCardIndex(0);
            }}
          >
            <span>{deck.lens}</span>
            <strong>{deck.title}</strong>
            <small>{deckStats[deck.id] ?? 0} practiced</small>
          </button>
        ))}
      </div>

      <div className="prompt-stage">
        <div className="prompt-meta">
          <span>{activeDeck.lens}</span>
          <strong>{activeDeck.title}</strong>
          <p>{activeDeck.purpose}</p>
        </div>
        <blockquote>{activeDeck.cards[cardIndex]}</blockquote>
        <div className="prompt-actions">
          <button className="secondary" onClick={() => draw()}>
            <RefreshCw size={17} />
            Draw
          </button>
          <button
            className="primary"
            onClick={() => setDeckStats({ ...deckStats, [activeDeck.id]: (deckStats[activeDeck.id] ?? 0) + 1 })}
          >
            <Check size={17} />
            Practiced
          </button>
        </div>
        <div className="closing-line">
          <HeartHandshake size={18} />
          <span>
            Close with: one thing I heard, one thing I appreciate, and one next step I can do for{" "}
            {profile.partnerAName && profile.partnerBName ? `${profile.partnerAName} and ${profile.partnerBName}` : "us"}.
          </span>
        </div>
      </div>
    </section>
  );
}

function PracticeStudio({
  profile,
  setProfile,
  signals,
  setSessions,
  safetyFlag,
  deckStats,
  setDeckStats
}: {
  profile: CoupleProfile;
  setProfile: (profile: CoupleProfile) => void;
  signals: BodySignals;
  setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>>;
  safetyFlag: boolean;
  deckStats: Record<string, number>;
  setDeckStats: (stats: Record<string, number>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingRef = useRef(false);
  const elapsedRef = useRef(0);
  const activeSpeakerRef = useRef<PartnerId>("A");
  const autoSpeechLanguageRef = useRef<SpeechLanguage>("he-IL");
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sessionType, setSessionType] = useState<SessionType>("daily-check-in");
  const [activeSpeaker, setActiveSpeaker] = useState<PartnerId>("A");
  const [transcriptLanguage, setTranscriptLanguage] = useLocalState<"auto" | SpeechLanguage>(
    "couple-lab-transcript-language-mode",
    "auto"
  );
  const [autoSpeechLanguage, setAutoSpeechLanguage] = useState<SpeechLanguage>(() => chooseInitialSpeechLanguage(profile, []));
  const [activeDeck, setActiveDeck] = useState<Deck>(decks[0]);
  const [cardIndex, setCardIndex] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [cues, setCues] = useState<LiveCue[]>([]);
  const [visualObservations, setVisualObservations] = useState<VisualObservation[]>([]);
  const [manualText, setManualText] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [speechStatus, setSpeechStatus] = useState("Ready");
  const [visualStatus, setVisualStatus] = useState("Visual AI warming up");
  const calibrationText = profile.visualCalibration
    ? `${partnerName(profile, "A")} = ${slotName(profile.visualCalibration.A)}, ${partnerName(profile, "B")} = ${slotName(
        profile.visualCalibration.B
      )}`
    : "Not calibrated yet";

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    activeSpeakerRef.current = activeSpeaker;
  }, [activeSpeaker]);

  useEffect(() => {
    autoSpeechLanguageRef.current = autoSpeechLanguage;
  }, [autoSpeechLanguage]);

  useEffect(() => {
    if (transcriptLanguage !== "auto" || recording) return;
    const nextLanguage = chooseInitialSpeechLanguage(profile, segments);
    setAutoSpeechLanguage(nextLanguage);
    autoSpeechLanguageRef.current = nextLanguage;
  }, [profile, recording, segments, transcriptLanguage]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(
      () =>
        setElapsed((value) => {
          const next = value + 1;
          elapsedRef.current = next;
          return next;
        }),
      1000
    );
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const draw = (deck = activeDeck) => {
    const next = Math.floor(Math.random() * deck.cards.length);
    setCardIndex(next === cardIndex ? (next + 1) % deck.cards.length : next);
  };

  const buildSegment = (text: string, source: TranscriptSegment["source"], speaker = activeSpeakerRef.current): TranscriptSegment => {
    const clean = text.trim();
    const endSeconds = elapsedRef.current;
    const startSeconds = source === "speech" ? Math.max(0, endSeconds - estimateSpeechDuration(clean)) : endSeconds;
    const detectedLanguage =
      detectScriptLanguage(clean) ?? (transcriptLanguage === "auto" ? autoSpeechLanguageRef.current : transcriptLanguage);

    return {
      id: nowId("segment"),
      speaker,
      target: otherPartner(speaker),
      text: clean,
      seconds: startSeconds,
      endSeconds,
      source,
      detectedLanguage,
      wordCount: spokenWordCount(clean)
    };
  };

  const appendSegment = (text: string, source: TranscriptSegment["source"]) => {
    const clean = text.trim();
    if (!clean) return;
    const segment = buildSegment(clean, source);
    setSegments((current) => [...current, segment]);
  };

  const loadVisualModels = async () => {
    if (faceLandmarkerRef.current && poseLandmarkerRef.current) return;
    setVisualStatus("Loading face/body models");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
    );

    const createFace = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          delegate,
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
        },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true
      });

    const createPose = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          delegate,
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
        },
        runningMode: "VIDEO",
        numPoses: 2
      });

    try {
      faceLandmarkerRef.current = await createFace("GPU");
      poseLandmarkerRef.current = await createPose("GPU");
    } catch {
      faceLandmarkerRef.current = await createFace("CPU");
      poseLandmarkerRef.current = await createPose("CPU");
    }
    setVisualStatus("Visual AI active");
  };

  const readBlendshape = (categories: Array<{ categoryName?: string; score?: number }>, name: string) =>
    categories.find((category) => category.categoryName === name)?.score ?? 0;

  const subjectForSlot = (slot: "left" | "right"): PartnerId => {
    if (profile.visualCalibration) {
      return profile.visualCalibration.A === slot ? "A" : "B";
    }
    return slot === "left" ? "A" : "B";
  };

  const faceSlot = (landmarks: Array<{ x?: number }>): "left" | "right" => {
    const xs = landmarks.map((landmark) => landmark.x ?? 0.5);
    return average(xs) < 0.5 ? "left" : "right";
  };

  const deriveVisualWindowObservations = (current: VisualObservation[], batch: VisualObservation[], sampleSeconds: number) => {
    const windowItems = [...current.slice(-50), ...batch].filter((item) => sampleSeconds - item.seconds <= 14);
    const derived: VisualObservation[] = [];
    const count = (labels: VisualObservation["label"][], subject?: PartnerId) =>
      windowItems.filter((item) => labels.includes(item.label) && (!subject || item.subject === subject)).length;

    (["A", "B"] as PartnerId[]).forEach((subject) => {
      const warmth = count(["warm-expression", "partner-gaze"], subject);
      const stress = count(["brow-tension", "mouth-tension", "closed-posture", "leaning-away", "head-turned-away"], subject);
      const withdrawal = count(["looking-away", "leaning-away", "head-turned-away", "closed-posture"], subject);

      if (warmth >= 2) {
        derived.push({
          id: nowId("visual-derived"),
          seconds: sampleSeconds,
          label: "sustained-warmth",
          subject,
          score: clamp(0.52 + warmth * 0.08, 0.52, 0.86),
          evidence: `${warmth} warmth/partner-gaze cues in the last 14 seconds`,
          provider: "derived",
          metadata: { windowSeconds: 14, cueCount: warmth }
        });
      }
      if (stress >= 3) {
        derived.push({
          id: nowId("visual-derived"),
          seconds: sampleSeconds,
          label: "sustained-tension",
          subject,
          score: clamp(0.5 + stress * 0.07, 0.5, 0.84),
          evidence: `${stress} tension/posture cues in the last 14 seconds`,
          provider: "derived",
          metadata: { windowSeconds: 14, cueCount: stress }
        });
      }
      if (withdrawal >= 3) {
        derived.push({
          id: nowId("visual-derived"),
          seconds: sampleSeconds,
          label: "possible-withdrawal",
          subject,
          score: clamp(0.48 + withdrawal * 0.07, 0.48, 0.82),
          evidence: `${withdrawal} look-away/lean-away cues in the last 14 seconds`,
          provider: "derived",
          metadata: { windowSeconds: 14, cueCount: withdrawal }
        });
      }
    });

    const engagement = count(["warm-expression", "partner-gaze", "mutual-attention", "shared-frame", "sustained-warmth"]);
    if (engagement >= 4) {
      derived.push({
        id: nowId("visual-derived"),
        seconds: sampleSeconds,
        label: "possible-engagement",
        score: clamp(0.5 + engagement * 0.05, 0.5, 0.84),
        evidence: `${engagement} warmth/gaze/shared-frame cues in the last 14 seconds`,
        provider: "derived",
        metadata: { windowSeconds: 14, cueCount: engagement }
      });
    }

    return derived;
  };

  const collectVisualObservations = () => {
    const video = videoRef.current;
    if (!recordingRef.current) {
      setVisualStatus("Visual AI ready; record to tag cues");
      return;
    }
    if (!video || video.readyState < 2 || !faceLandmarkerRef.current || !poseLandmarkerRef.current) return;

    const timestamp = Date.now();
    const sampleSeconds = elapsedRef.current;
    const observations: VisualObservation[] = [];
    const faceResults = faceLandmarkerRef.current.detectForVideo(video, timestamp);
    const poseResults = poseLandmarkerRef.current.detectForVideo(video, timestamp);
    const faceCount = faceResults.faceLandmarks?.length ?? 0;
    const partnerGazeSubjects = new Set<PartnerId>();

    if (faceCount > 0) {
      const calibratedNote = profile.visualCalibration ? `; ${calibrationText}` : "";
      observations.push({
        id: nowId("visual"),
        seconds: sampleSeconds,
        label: "face-visible",
        score: Math.min(0.9, 0.45 + faceCount * 0.2),
        evidence: `${faceCount} face${faceCount > 1 ? "s" : ""} visible${calibratedNote}`
      });
    } else if (recordingRef.current) {
      observations.push({
        id: nowId("visual"),
        seconds: sampleSeconds,
        label: "looking-away",
        score: 0.55,
        evidence: "No face visible in sampled frame"
      });
    }

    if (faceCount >= 2) {
      observations.push({
        id: nowId("visual"),
        seconds: sampleSeconds,
        label: "shared-frame",
        score: 0.82,
        evidence: "Both partners appeared in the same frame"
      });
    }

    const blendshapeSets = faceResults.faceBlendshapes ?? [];
    blendshapeSets.forEach((blendshapeSet, faceIndex) => {
      const categories = blendshapeSet.categories ?? [];
      const landmarks = faceResults.faceLandmarks?.[faceIndex] ?? [];
      const subject = subjectForSlot(faceSlot(landmarks));
      const smile = (readBlendshape(categories, "mouthSmileLeft") + readBlendshape(categories, "mouthSmileRight")) / 2;
      const brow =
        (readBlendshape(categories, "browDownLeft") +
          readBlendshape(categories, "browDownRight") +
          readBlendshape(categories, "browInnerUp")) /
        3;
      const mouthTension =
        (readBlendshape(categories, "mouthPressLeft") +
          readBlendshape(categories, "mouthPressRight") +
          readBlendshape(categories, "mouthFrownLeft") +
          readBlendshape(categories, "mouthFrownRight")) /
        4;
      const eyeAway =
        (readBlendshape(categories, "eyeLookOutLeft") + readBlendshape(categories, "eyeLookOutRight")) / 2;
      const eyeInside =
        (readBlendshape(categories, "eyeLookInLeft") + readBlendshape(categories, "eyeLookInRight")) / 2;
      const nose = landmarks[1];
      const leftEye = landmarks[33];
      const rightEye = landmarks[263];
      const eyeCenter = leftEye && rightEye ? ((leftEye.x ?? 0.5) + (rightEye.x ?? 0.5)) / 2 : 0.5;
      const headYawOffset = nose ? Math.abs((nose.x ?? 0.5) - eyeCenter) : 0;
      const partnerGaze = faceCount >= 2 && eyeAway < 0.22 && eyeInside < 0.42;

      if (smile > 0.28) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "warm-expression",
          subject,
          score: smile,
          evidence: "Smile-related face blendshapes rose"
        });
      }
      if (brow > 0.24) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "brow-tension",
          subject,
          score: brow,
          evidence: "Brow tension blendshapes rose"
        });
      }
      if (mouthTension > 0.2) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "mouth-tension",
          subject,
          score: mouthTension,
          evidence: "Mouth press/frown blendshapes rose"
        });
      }
      if (eyeAway > 0.35) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "looking-away",
          subject,
          score: eyeAway,
          evidence: "Eye-look-away blendshapes rose"
        });
      }
      if (headYawOffset > 0.04) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "head-turned-away",
          subject,
          score: clamp(headYawOffset * 9, 0.38, 0.78),
          evidence: "Head orientation shifted away from the face center",
          metadata: { headYawOffset: Number(headYawOffset.toFixed(3)) }
        });
      }
      if (partnerGaze) {
        partnerGazeSubjects.add(subject);
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "partner-gaze",
          subject,
          score: 0.7,
          evidence: `${partnerName(profile, subject)} likely oriented toward the partner in a shared frame`
        });
      }
    });

    if (partnerGazeSubjects.has("A") && partnerGazeSubjects.has("B")) {
      observations.push({
        id: nowId("visual"),
        seconds: sampleSeconds,
        label: "mutual-attention",
        score: 0.76,
        evidence: "Both calibrated partners were likely oriented toward each other"
      });
    }

    const poses = poseResults.landmarks ?? [];
    if (poses.length > 0) {
      observations.push({
        id: nowId("visual"),
        seconds: sampleSeconds,
        label: "body-visible",
        score: Math.min(0.9, 0.48 + poses.length * 0.18),
        evidence: `${poses.length} body pose${poses.length > 1 ? "s" : ""} visible`
      });
    }

    poses.forEach((pose) => {
      const leftShoulder = pose[11];
      const rightShoulder = pose[12];
      const leftWrist = pose[15];
      const rightWrist = pose[16];
      if (!leftShoulder || !rightShoulder) return;
      const shoulderCenter = (leftShoulder.x + rightShoulder.x) / 2;
      if (shoulderCenter < 0.28 || shoulderCenter > 0.72) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "leaning-away",
          score: Math.abs(shoulderCenter - 0.5),
          evidence: "Pose center shifted toward the edge of frame"
        });
      }
      if (leftWrist && rightWrist) {
        const wristsNearChest =
          Math.abs(leftWrist.x - rightShoulder.x) < 0.14 && Math.abs(rightWrist.x - leftShoulder.x) < 0.14;
        if (wristsNearChest) {
          observations.push({
            id: nowId("visual"),
            seconds: sampleSeconds,
            label: "closed-posture",
            score: 0.58,
            evidence: "Wrists crossed near opposite shoulders"
          });
        }
      }
    });

    if (observations.length > 0) {
      setVisualObservations((current) => {
        const enriched = observations.map((observation) => ({
          provider: "mediapipe" as const,
          ...observation,
          metadata: {
            ...(observation.metadata ?? {}),
            sampleSeconds,
            model: observation.provider ?? "mediapipe"
          }
        }));
        const derived = deriveVisualWindowObservations(current, enriched, sampleSeconds);
        return [...current.slice(-260), ...enriched, ...derived];
      });
    }
  };

  const calibrateVisualIdentity = async (aSlot: "left" | "right") => {
    if (!streamRef.current) {
      await startCamera();
    }
    await loadVisualModels();
    const video = videoRef.current;
    const faceCount =
      video && video.readyState >= 2 && faceLandmarkerRef.current
        ? faceLandmarkerRef.current.detectForVideo(video, Date.now()).faceLandmarks?.length ?? 0
        : 0;
    const nextCalibration = {
      A: aSlot,
      B: aSlot === "left" ? ("right" as const) : ("left" as const),
      calibratedAt: new Date().toISOString(),
      note:
        faceCount >= 2
          ? `Saved with ${faceCount} faces visible.`
          : "Saved as a position preference. Recalibrate when both faces are visible."
    };
    setProfile({ ...profile, visualCalibration: nextCalibration });
    setVisualStatus(`Calibrated: ${partnerName(profile, "A")} ${aSlot}`);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraReady(true);
      setSpeechStatus("Camera ready");
    } catch {
      setSpeechStatus("Camera permission needed");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  };

  useEffect(() => {
    if (!cameraReady || safetyFlag) return;
    let cancelled = false;
    let intervalId = 0;

    loadVisualModels()
      .then(() => {
        if (cancelled) return;
        collectVisualObservations();
        intervalId = window.setInterval(collectVisualObservations, 1200);
      })
      .catch(() => setVisualStatus("Visual AI unavailable"));

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [cameraReady, safetyFlag, profile]);

  useEffect(() => {
    if (!streamRef.current && !safetyFlag) {
      startCamera();
    }
  }, [safetyFlag]);

  const startSpeech = () => {
    const SpeechConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechConstructor) {
      setSpeechStatus("Manual transcript mode");
      return;
    }
    const recognition = new SpeechConstructor();
    recognition.continuous = true;
    recognition.interimResults = false;
    const effectiveLanguage = transcriptLanguage === "auto" ? autoSpeechLanguageRef.current : transcriptLanguage;
    recognition.lang = effectiveLanguage;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          const transcript = result[0].transcript;
          appendSegment(transcript, "speech");
          const detectedLanguage = detectScriptLanguage(transcript);
          if (transcriptLanguage === "auto" && detectedLanguage && detectedLanguage !== autoSpeechLanguageRef.current) {
            autoSpeechLanguageRef.current = detectedLanguage;
            setAutoSpeechLanguage(detectedLanguage);
            setSpeechStatus(`Detected ${detectedLanguage === "he-IL" ? "Hebrew" : "English"}; switching transcription`);
            recognition.stop();
            return;
          }
        }
      }
    };
    recognition.onerror = () => setSpeechStatus("Speech capture paused");
    recognition.onend = () => {
      if (recordingRef.current) {
        try {
          startSpeech();
        } catch {
          setSpeechStatus("Speech restart blocked");
        }
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    const languageLabel =
      transcriptLanguage === "auto"
        ? `Auto (${effectiveLanguage === "he-IL" ? "Hebrew" : "English"})`
        : transcriptLanguages.find((language) => language.id === transcriptLanguage)?.label ?? "browser";
    setSpeechStatus(`Speech capture on (${languageLabel})`);
  };

  const startRecording = async () => {
    if (!streamRef.current) {
      await startCamera();
    }
    if (!streamRef.current) return;
    mediaChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "";
    const recorder = mimeType ? new MediaRecorder(streamRef.current, { mimeType }) : new MediaRecorder(streamRef.current);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        mediaChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(mediaChunksRef.current, { type: "video/webm" });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(blob));
    };
    mediaRecorderRef.current = recorder;
    setElapsed(0);
    elapsedRef.current = 0;
    if (transcriptLanguage === "auto") {
      const nextLanguage = chooseInitialSpeechLanguage(profile, segments);
      autoSpeechLanguageRef.current = nextLanguage;
      setAutoSpeechLanguage(nextLanguage);
    }
    recordingRef.current = true;
    setRecording(true);
    recorder.start(1000);
    startSpeech();
  };

  const stopRecording = () => {
    recordingRef.current = false;
    mediaRecorderRef.current?.stop();
    recognitionRef.current?.stop();
    setRecording(false);
    setSpeechStatus("Stopped");
  };

  const saveSession = () => {
    const pendingText = manualText.trim();
    const segmentsToSave = pendingText
      ? [...segments, buildSegment(pendingText, "manual")]
      : segments;
    const analysis = analyzeSession(segmentsToSave, signals, cues, sessionType, visualObservations);
    const nonverbalMetrics = computeNonverbalMetrics(visualObservations);
    const record: SessionRecord = {
      id: nowId("session"),
      title: `${activeDeck.title} / ${sessionTypes.find((type) => type.id === sessionType)?.label ?? "Session"} - ${new Date().toLocaleDateString()}`,
      type: sessionType,
      startedAt: new Date().toISOString(),
      durationSeconds: elapsed,
      segments: segmentsToSave,
      cues,
      visualObservations,
      nonverbalMetrics,
      signals,
      analysis
    };
    setSessions((current) => [record, ...current]);
    setSegments([]);
    setCues([]);
    setVisualObservations([]);
    setManualText("");
    setElapsed(0);
    elapsedRef.current = 0;
    setDeckStats({ ...deckStats, [activeDeck.id]: (deckStats[activeDeck.id] ?? 0) + 1 });
  };

  const previewAnalysis = useMemo(
    () => analyzeSession(segments, signals, cues, sessionType, visualObservations),
    [segments, signals, cues, sessionType, visualObservations]
  );
  const currentNonverbalMetrics = useMemo(() => computeNonverbalMetrics(visualObservations), [visualObservations]);
  const tagsBySegment = useMemo(() => {
    return previewAnalysis.tags.reduce<Record<string, InteractionTag[]>>((acc, tag) => {
      if (!tag.segmentId) return acc;
      acc[tag.segmentId] = [...(acc[tag.segmentId] ?? []), tag];
      return acc;
    }, {});
  }, [previewAnalysis.tags]);

  return (
    <section className="practice-grid">
      <div className="prompt-stage studio-prompt">
        <div className="prompt-meta">
          <span>{activeDeck.lens}</span>
          <strong>{activeDeck.title}</strong>
          <p>{activeDeck.purpose}</p>
        </div>
        <blockquote>{activeDeck.cards[cardIndex]}</blockquote>
        <div className="prompt-actions">
          <select
            value={activeDeck.id}
            onChange={(event) => {
              const deck = decks.find((item) => item.id === event.target.value) ?? decks[0];
              setActiveDeck(deck);
              setCardIndex(0);
            }}
          >
            {decks.map((deck) => (
              <option value={deck.id} key={deck.id}>
                {deck.title}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={() => draw()}>
            <RefreshCw size={17} />
            Draw
          </button>
          <button
            className="secondary"
            onClick={() => setDeckStats({ ...deckStats, [activeDeck.id]: (deckStats[activeDeck.id] ?? 0) + 1 })}
          >
            <Check size={17} />
            Practiced
          </button>
        </div>
      </div>

      <div className="lab-stage">
        {safetyFlag && (
          <div className="safety-banner">
            <ShieldCheck size={18} />
            Practice mode is paused until the safety checklist is reviewed.
          </div>
        )}
        <video ref={videoRef} autoPlay playsInline muted className="video-preview" />
        {!cameraReady && (
          <div className="video-placeholder">
            <CameraEmptyArt size={92} />
            <span>Camera preview</span>
          </div>
        )}
        <div className="lab-controls">
          <button className="secondary" onClick={cameraReady ? stopCamera : startCamera}>
            <Camera size={17} />
            {cameraReady ? "Stop camera" : "Camera"}
          </button>
          <button className="primary" onClick={recording ? stopRecording : startRecording} disabled={safetyFlag}>
            {recording ? <Square size={17} /> : <Play size={17} />}
            {recording ? "Stop" : "Record"}
          </button>
          <span className="timer">{formatTime(elapsed)}</span>
          <span className="status-dot">
            <Mic size={15} />
            {speechStatus}
          </span>
          <span className="status-dot">
            <Activity size={15} />
            {visualStatus}
          </span>
        </div>
        {videoUrl && (
          <a className="download-link" href={videoUrl} download="couple-lab-session.webm">
            <Download size={16} />
            Download video
          </a>
        )}
      </div>

      <NonverbalPanel
        profile={profile}
        metrics={currentNonverbalMetrics}
        observations={visualObservations}
        calibrationText={calibrationText}
      />

      <div className="panel lab-side">
        <div className="field-row">
          <label>
            Session
            <select value={sessionType} onChange={(event) => setSessionType(event.target.value as SessionType)}>
              {sessionTypes.map((type) => (
                <option value={type.id} key={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Speaker
            <select value={activeSpeaker} onChange={(event) => setActiveSpeaker(event.target.value as PartnerId)}>
              <option value="A">{partnerName(profile, "A")}</option>
              <option value="B">{partnerName(profile, "B")}</option>
            </select>
          </label>
          <label>
            Transcript language
            <select value={transcriptLanguage} onChange={(event) => setTranscriptLanguage(event.target.value as "auto" | SpeechLanguage)}>
              {transcriptLanguages.map((language) => (
                <option value={language.id} key={language.id}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cue-grid">
          {cueOptions.map((cue) => (
            <button
              key={cue.tone}
              className="cue-button"
              onClick={() =>
                setCues((current) => [...current, { id: nowId("cue"), speaker: activeSpeaker, tone: cue.tone, seconds: elapsedRef.current }])
              }
            >
              {cue.label}
            </button>
          ))}
        </div>

        <label className="manual-entry">
          Transcript note
          <textarea value={manualText} onChange={(event) => setManualText(event.target.value)} />
        </label>
        <button
          className="secondary"
          onClick={() => {
            appendSegment(manualText, "manual");
            setManualText("");
          }}
        >
          <Mic size={17} />
          Add note
        </button>

        <div className="visual-stack">
          <strong>Visual observations</strong>
          <span>{visualObservations.length} saved cues in this session</span>
          <small>{calibrationText}</small>
          <div className="calibration-actions">
            <button className="secondary" onClick={() => calibrateVisualIdentity("left")}>
              {partnerName(profile, "A")} left
            </button>
            <button className="secondary" onClick={() => calibrateVisualIdentity("right")}>
              {partnerName(profile, "A")} right
            </button>
          </div>
          <div className="tag-cloud compact">
            {Array.from(new Set(visualObservations.slice(-12).map((item) => item.label))).map((label) => (
              <span key={label}>{label.replace(/-/g, " ")}</span>
            ))}
            {visualObservations.length === 0 && <span>waiting for video cues</span>}
          </div>
        </div>

        <AdvancedEnginesPanel visualStatus={visualStatus} />
      </div>

      <div className="panel transcript-panel">
        <div className="panel-heading">
          <h2>Transcript</h2>
          <button className="text-button" onClick={() => setSegments([])}>
            <Trash2 size={15} />
            Clear
          </button>
        </div>
        <div className="transcript-list">
          {segments.length === 0 && <p className="muted">No transcript segments yet.</p>}
          {segments.map((segment) => {
            const segmentTags = tagsBySegment[segment.id] ?? [];
            return (
              <article key={segment.id} className={`segment speaker-${segment.speaker.toLowerCase()}`}>
                <span>
                  {partnerName(profile, segment.speaker)} to {partnerName(profile, segment.target ?? otherPartner(segment.speaker))} -{" "}
                  {formatTime(segment.seconds)}
                  {segment.endSeconds !== undefined ? `-${formatTime(segment.endSeconds)}` : ""} - {segment.source}
                  {segment.detectedLanguage ? ` - ${segment.detectedLanguage}` : ""}
                </span>
                <p>{segment.text}</p>
                {segmentTags.length > 0 && (
                  <div className="segment-tags">
                    {segmentTags.slice(0, 6).map((tag) => (
                      <small key={tag.id} className={`tag-pill ${tag.family}`}>
                        {tag.label} {Math.round(tag.confidence * 100)}%
                      </small>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div className="panel analysis-panel">
        <div className="panel-heading">
          <h2>Live reflection</h2>
          <Activity size={18} />
        </div>
        <p>{previewAnalysis.summary}</p>
        <div className="metric-row wide">
          <MiniMetric label="Practice" value={previewAnalysis.metrics.connectionPracticeScore} />
          <MiniMetric label="Balance" value={previewAnalysis.metrics.turnBalance} />
          <MiniMetric label="Horsemen" value={previewAnalysis.metrics.fourHorsemenSignals} raw invert />
          <MiniMetric label="Flooding" value={previewAnalysis.metrics.floodingRisk} invert />
        </div>
        <div className="metric-row wide">
          <MiniMetric label="Warmth" value={previewAnalysis.metrics.emotionalState?.warmth ?? 0} />
          <MiniMetric label="Engagement" value={previewAnalysis.metrics.emotionalState?.engagement ?? 0} />
          <MiniMetric label="Tension" value={previewAnalysis.metrics.emotionalState?.tension ?? 0} invert />
          <MiniMetric label="Repair ready" value={previewAnalysis.metrics.emotionalState?.repairReadiness ?? 0} />
        </div>
        <TaggedTimeline profile={profile} tags={previewAnalysis.tags.slice(-10).reverse()} title="Tagged timeline" />
        <div className="script-box">{previewAnalysis.suggestedScript}</div>
        <button className="primary full" onClick={saveSession}>
          <Check size={17} />
          Save session
        </button>
      </div>
    </section>
  );
}

function tagFamilyLabel(family: InteractionTag["family"]) {
  const labels: Record<InteractionTag["family"], string> = {
    "four-horsemen": "Four Horsemen",
    repair: "Repair",
    strength: "Strength",
    flooding: "Flooding",
    "turn-taking": "Turn-taking",
    nonverbal: "Nonverbal",
    desire: "Desire",
    "conversation-structure": "Structure"
  };

  return labels[family];
}

function tagParticipantLine(profile: CoupleProfile, tag: InteractionTag) {
  if (tag.speaker && tag.target) {
    return `${partnerName(profile, tag.speaker)} to ${partnerName(profile, tag.target)}`;
  }
  if (tag.speaker) {
    return partnerName(profile, tag.speaker);
  }
  return "Couple moment";
}

function TaggedTimeline({ profile, tags, title }: { profile: CoupleProfile; tags: InteractionTag[]; title: string }) {
  return (
    <div className="tagged-timeline">
      <strong>{title}</strong>
      {tags.length === 0 && <span className="muted">No tagged moments yet.</span>}
      {tags.map((tag) => (
        <article key={tag.id} className={`timeline-tag ${tag.family}`}>
          <div>
            <span>{formatTime(tag.seconds)}</span>
            <b>{tag.label}</b>
            <small>
              {tagParticipantLine(profile, tag)} - {tag.source} - {tagFamilyLabel(tag.family)} - {Math.round(tag.confidence * 100)}%
            </small>
          </div>
          <p>{tag.evidence}</p>
          {tag.suggestion && <small>{tag.suggestion}</small>}
        </article>
      ))}
    </div>
  );
}

function AdvancedEnginesPanel({ visualStatus }: { visualStatus: string }) {
  const [statuses, setStatuses] = useState<Record<string, "active" | "ready" | "offline" | "checking">>({
    mediapipe: "active"
  });

  const checkEngines = async () => {
    setStatuses((current) =>
      localEngineChecks.reduce<Record<string, "active" | "ready" | "offline" | "checking">>(
        (acc, engine) => ({
          ...acc,
          [engine.id]: engine.id === "mediapipe" ? "active" : "checking"
        }),
        current
      )
    );

    const results = await Promise.all(
      localEngineChecks.map(async (engine) => {
        if (!engine.url) return [engine.id, "active"] as const;
        try {
          const response = await fetch(engine.url, { method: "GET" });
          return [engine.id, response.ok ? "ready" : "offline"] as const;
        } catch {
          return [engine.id, "offline"] as const;
        }
      })
    );

    setStatuses(
      results.reduce<Record<string, "active" | "ready" | "offline" | "checking">>((acc, [id, status]) => ({ ...acc, [id]: status }), {})
    );
  };

  return (
    <div className="advanced-engines">
      <div className="mini-heading">
        <strong>Advanced signals</strong>
        <button className="text-button" onClick={checkEngines}>
          <RefreshCw size={14} />
          Check
        </button>
      </div>
      <div className="engine-grid">
        {localEngineChecks.map((engine) => {
          const status = statuses[engine.id] ?? "offline";
          return (
            <div className={`engine-card ${status}`} key={engine.id}>
              <span>{engine.label}</span>
              <small>{engine.id === "mediapipe" ? visualStatus : engine.detail}</small>
              <b>{status}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NonverbalPanel({
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

function AdviserView({
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
  const safetyFlag =
    safety.fearOrCoercion ||
    safety.violenceOrThreats ||
    safety.pressuredToParticipate ||
    safety.seriousDepressionOrAddiction;
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

function InsightsView({ sessions, profile }: { sessions: SessionRecord[]; profile: CoupleProfile }) {
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

function ExportSafetyView({
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
  const safetyItems: { key: keyof SafetyState; label: string }[] = [
    { key: "fearOrCoercion", label: "One partner feels afraid or coerced." },
    { key: "violenceOrThreats", label: "There has been violence, threats, stalking, or intimidation." },
    { key: "pressuredToParticipate", label: "One partner feels pressured to record or share." },
    { key: "seriousDepressionOrAddiction", label: "Serious depression, addiction, or crisis is active." }
  ];
  const safetyFlag = safetyItems.some((item) => Boolean(safety[item.key]));

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

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className="progress">
      <span>
        {label}
        <b>{value}%</b>
      </span>
      <div>
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  invert,
  raw
}: {
  label: string;
  value: number;
  invert?: boolean;
  raw?: boolean;
}) {
  const colorValue = raw ? Math.min(100, value * 10) : value;
  return (
    <div className="mini-metric">
      <span>{label}</span>
      <strong>{raw ? value : `${value}%`}</strong>
      <div className={invert ? "invert" : ""}>
        <i style={{ width: `${Math.max(3, Math.min(100, colorValue))}%` }} />
      </div>
    </div>
  );
}

function InsightList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        <Check size={18} />
      </div>
      <ul className="plain-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
