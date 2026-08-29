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
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  Eye,
  FileDown,
  FileText,
  Fingerprint,
  HeartHandshake,
  Lock,
  Mic,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  Video
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeSession, CONTEMPT_RISK_LABEL } from "./relationshipEngine";
import { resolveAdviserRecommendation } from "./adviserRecommendation";
import { CALIBRATION_STORAGE_KEY, readCalibrationState, summarizeCalibration } from "./transcriptionCalibration";
import { type GoldenMoment, goldenMomentsForSession } from "./goldenMoments";
import { highlightPieces, searchTranscripts } from "./transcriptSearch";
import { addTranscriptRate, analyzeAcousticFeatures } from "./acousticFeatures";
import { VocalAnalyser, type VocalObservationLite } from "./audioAnalysis";
import { inspectAudioQuality, matchPartnerVector, resampleAudio } from "./biometricQuality";
import { incompleteBiometricPartners } from "./biometricReadiness";
import { BiometricEnrollmentWizard } from "./BiometricEnrollmentWizard";
import { createFaceDescriptor } from "./faceDescriptor";
import { nextQuestionIndex, rememberQuestion, type QuestionHistory } from "./questionRotation";
import {
  clearDeviceStore,
  clearDiagnostics,
  deleteSessionMedia,
  getDiagnostics,
  loadSessionMedia,
  logDiagnostic,
  saveSessionMedia,
  type DiagnosticEventRecord
} from "./localStore";
import { type PracticePhase, sessionEvidenceSummary } from "./sessionFlow";
import {
  buildTranscriptCorrectionPrompt,
  parseTranscriptCorrectionResponse,
  TranscriptCorrectionError
} from "./transcriptCorrection";
import { DesktopFoundationPanel } from "./desktopFoundation";
import { getVisionAssetUrls } from "./visionAssets";
import {
  headOrientationObservations,
  headOrientationProxy,
  movementObservation,
  normalizedPoseMotion,
  qualityObservation,
  type VisualPoint
} from "./visualObservation";
import {
  decks,
  defaultAssessment,
  defaultProfile,
  defaultSafety,
  defaultSignals,
  domains,
  evidenceNotes
} from "./data";
import {
  AssessmentState,
  AcousticMetrics,
  BiometricEnrollmentState,
  BiometricEnrollmentSummary,
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
  StoredTranscriptionMetadata,
  TranscriptSegment,
  VisualObservation,
  VocalObservation
} from "./types";

type View = "dashboard" | "setup" | "assess" | "practice" | "insights" | "adviser" | "report" | "settings" | "export" | "diagnostics" | "more";
type SpeechLanguage = "he-IL" | "en-US";
type TranscriptLanguageMode = "auto" | SpeechLanguage;
type TranscriptionStatusKind = "idle" | "listening" | "processing" | "ready" | "error";
type InterfaceLanguage = "he" | "en";
type PracticeLaunch = { deckId: string; cardIndex?: number; source: "adviser" };

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const storageKeys = {
  profile: "couple-lab-profile",
  assessment: "couple-lab-assessment",
  sessions: "couple-lab-sessions",
  signals: "couple-lab-signals",
  safety: "couple-lab-safety",
  deckStats: "couple-lab-deck-stats",
  questionHistory: "couple-lab-question-history",
  transcriptLanguage: "couple-lab-transcript-language-mode",
  interfaceLanguage: "couple-lab-interface-language",
  reportFeedback: "couple-lab-report-feedback",
  ollamaModel: "couple-lab-ollama-model",
  transcriptionCalibration: CALIBRATION_STORAGE_KEY
};

/** Single source for the local Ollama model choices shown in every picker. */
const OLLAMA_MODEL_OPTIONS = ["gemma3:4b", "gemma4:latest", "llama3.2:3b", "mistral:latest", "mistral-ctx16k:latest"];

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
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // A full quota must not crash the app mid-session; the in-memory state
      // keeps working and the failure is surfaced in the diagnostics log.
      console.warn(`couple-lab: local persistence failed for ${key}`, error);
      void logDiagnostic({ name: "storage.persist_failed", status: "error", phase: key });
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function partnerName(profile: CoupleProfile, partner: PartnerId) {
  return partner === "A" ? profile.partnerAName || "שותף/ה א׳" : profile.partnerBName || "שותף/ה ב׳";
}

function PartnerPortrait({ profile, partner }: { profile: CoupleProfile; partner: PartnerId }) {
  const name = partnerName(profile, partner);
  const photo = profile.partnerPhotos?.[partner];
  return photo ? (
    <img className="partner-portrait" src={photo} alt={`תמונת הפרופיל של ${name}`} width={240} height={240} />
  ) : (
    <span className="partner-portrait partner-portrait-fallback" aria-hidden="true">{name.trim().charAt(0) || "?"}</span>
  );
}

function TranscriptSegments({
  profile,
  segments,
  tags = []
}: {
  profile: CoupleProfile;
  segments: TranscriptSegment[];
  tags?: InteractionTag[];
}) {
  const tagsBySegment = tags.reduce<Record<string, InteractionTag[]>>((grouped, tag) => {
    if (!tag.segmentId) return grouped;
    grouped[tag.segmentId] = [...(grouped[tag.segmentId] ?? []), tag];
    return grouped;
  }, {});

  return segments.map((segment) => {
    const segmentTags = tagsBySegment[segment.id] ?? [];
    const speakerLabel = segment.speakerAttribution === "unknown"
      ? "דובר/ת לא משויך/ת"
      : `${partnerName(profile, segment.speaker)} אל ${partnerName(profile, segment.target ?? otherPartner(segment.speaker))}`;
    return (
      <article key={segment.id} className={`segment speaker-${segment.speaker.toLowerCase()}`}>
        <span>
          {speakerLabel} ·{" "}
          <bdi dir="ltr">
            {formatTime(segment.seconds)}
            {segment.endSeconds !== undefined ? `–${formatTime(segment.endSeconds)}` : ""}
          </bdi>{" "}
          · {segment.source === "speech" ? "תמלול קולי" : "הערה ידנית"}
          {segment.detectedLanguage ? ` · ${segment.detectedLanguage === "he-IL" ? "עברית" : segment.detectedLanguage === "en-US" ? "אנגלית" : "שפה לא ידועה"}` : ""}
          {segment.transcriptionMetadata?.confidenceLevel === "low" ? " · כדאי לבדוק את הניסוח" : ""}
          {segment.correction ? " · נוסח שנבדק ואושר" : ""}
        </span>
        <p dir="auto">{segment.text}</p>
        {segment.originalText && segment.originalText !== segment.text && (
          <details className="segment-original">
            <summary>הצגת התמלול המקורי</summary>
            <p dir="auto">{segment.originalText}</p>
          </details>
        )}
        {segmentTags.length > 0 && (
          <div className="segment-tags" aria-label="רגעים שזוהו בקטע">
            {segmentTags.slice(0, 6).map((tag) => (
              <small key={tag.id} className={`tag-pill ${tag.family}`}>
                {tag.label}
              </small>
            ))}
          </div>
        )}
      </article>
    );
  });
}

function PrivateHandoff({ name, onReady }: { name: string; onReady: () => void }) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="panel private-handoff" role="region" aria-label={`העברה פרטית אל ${name}`}>
      <div className="private-handoff-icon"><Lock size={28} aria-hidden="true" /></div>
      <h2 ref={headingRef} tabIndex={-1}>העבירו את המחשב אל <bdi>{name}</bdi></h2>
      <p>התשובות של האדם הקודם מוסתרות. כשיש לך פרטיות ואפשר להתחיל, לחצו על הכפתור.</p>
      <button className="primary" onClick={onReady}>אני <bdi>{name}</bdi>, אפשר להתחיל</button>
      <small>המסך רק מסתיר את התשובות; אין צורך בחשבון או בסיסמה.</small>
    </div>
  );
}

function RatingScale({
  label,
  selected,
  locked = false,
  onSelect,
  onLocked
}: {
  label: string;
  selected?: number;
  locked?: boolean;
  onSelect: (value: number) => void;
  onLocked?: () => void;
}) {
  const activeValue = selected ?? 1;
  const choose = (value: number) => {
    if (locked) {
      onLocked?.();
      return;
    }
    onSelect(value);
  };
  const moveWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, value: number) => {
    const increments: Record<string, number> = {
      ArrowLeft: 1,
      ArrowDown: 1,
      ArrowRight: -1,
      ArrowUp: -1
    };
    let nextValue = value;
    if (event.key === "Home") nextValue = 1;
    else if (event.key === "End") nextValue = 10;
    else if (event.key in increments) nextValue = Math.min(10, Math.max(1, value + increments[event.key]));
    else return;

    event.preventDefault();
    if (locked) {
      onLocked?.();
      return;
    }
    onSelect(nextValue);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='radio']");
    window.requestAnimationFrame(() => buttons?.[nextValue - 1]?.focus());
  };

  return (
    <div
      className="rating-grid"
      role="radiogroup"
      aria-label={`${label}: דירוג מ־1 עד 10${locked ? ". כדי לבחור תשובה, כתבו קודם איך קוראים לכם" : ""}`}
      data-locked={locked ? "true" : undefined}
    >
      {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
        <button
          type="button"
          role="radio"
          aria-label={`${value} מתוך 10${locked ? " — לחצו כדי לעבור לשדה השם" : ""}`}
          aria-checked={selected === value}
          data-locked={locked ? "true" : undefined}
          tabIndex={value === activeValue ? 0 : -1}
          className={selected === value ? "selected" : ""}
          onClick={() => choose(value)}
          onKeyDown={(event) => moveWithKeyboard(event, value)}
          key={value}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

function slotName(slot: "left" | "right") {
  return slot === "left" ? "צד שמאל" : "צד ימין";
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function joinAudioChunks(chunks: Float32Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    joined.set(chunk, offset);
    offset += chunk.length;
  });
  return joined;
}

function partnerAssessmentComplete(assessment: AssessmentState, partner: PartnerId) {
  const allAnswered = domains.every((domain) => {
    const value = assessment[partner][domain.key];
    return Number.isFinite(value) && value >= 1 && value <= 10;
  });
  return allAnswered && Boolean(assessment.completedBy?.[partner] || assessment.updatedAt);
}

function assessmentComplete(assessment: AssessmentState) {
  return partnerAssessmentComplete(assessment, "A") && partnerAssessmentComplete(assessment, "B");
}

function partnerRegistrationComplete(profile: CoupleProfile, assessment: AssessmentState, partner: PartnerId) {
  return Boolean((partner === "A" ? profile.partnerAName : profile.partnerBName).trim()) && partnerAssessmentComplete(assessment, partner);
}

const followUpOutcomeLabels: Record<NonNullable<SessionRecord["followUp"]>["outcome"], string> = {
  helped: "עזר לנו",
  partly: "עזר קצת",
  "not-yet": "עוד לא יצא",
  "not-fit": "לא התאים לנו"
};

function followUpOutcomeLabel(outcome: NonNullable<SessionRecord["followUp"]>["outcome"]) {
  return followUpOutcomeLabels[outcome];
}

const diagnosticEventLabels: Record<string, string> = {
  "permission.requested": "בקשת גישה למצלמה ולמיקרופון",
  "permission.result": "תוצאת הרשאת מצלמה ומיקרופון",
  "recording.started": "ההקלטה התחילה",
  "recording.stopped": "ההקלטה הסתיימה",
  "recording.failed": "שגיאה בהקלטה",
  "recording.persist_completed": "ההקלטה נשמרה במחשב",
  "recording.deleted": "ההקלטה נמחקה",
  "transcription.started": "התמלול התחיל",
  "transcription.segment_captured": "נקלט קטע תמלול",
  "transcription.failed": "שגיאה בתמלול",
  "transcription.unavailable": "התמלול אינו זמין",
  "transcription.local_ready": "התמלול המקומי מוכן",
  "transcription.local_unavailable": "התמלול המקומי אינו זמין",
  "transcription.local_empty": "לא נקלט דיבור לתמלול",
  "transcription.local_completed": "התמלול המקומי הושלם",
  "transcription.local_failed": "שגיאה בתמלול המקומי",
  "analysis.started": "הכנת הסיכום התחילה",
  "analysis.completed": "הסיכום הושלם",
  "session.save_requested": "שמירת השיחה התחילה",
  "session.save_completed": "השיחה נשמרה",
  "session.save_failed": "שמירת השיחה נכשלה",
  "session.closing_completed": "סיכום השיחה נשמר",
  "session.follow_up_completed": "בדיקת הצעד המשותף נשמרה",
  "consent.confirmed": "הסכמה להקלטה נשמרה"
};

const diagnosticDetailLabels: Record<string, string> = {
  info: "מידע",
  success: "הושלם",
  error: "שגיאה",
  recording: "במהלך ההקלטה",
  saving: "במהלך השמירה",
  analyzing: "במהלך הכנת הסיכום",
  finalized: "הסתיים",
  granted: "הגישה אושרה",
  "camera-and-microphone": "מצלמה ומיקרופון",
  "he-IL": "עברית",
  "en-US": "אנגלית",
  "permission-denied": "הגישה נחסמה",
  "speech-api-missing": "שירות התמלול אינו זמין",
  "no-speech": "לא נקלט דיבור",
  "empty-result": "לא התקבל טקסט",
  "device-storage-failed": "השמירה במחשב נכשלה",
  "media-track-ended": "המצלמה או המיקרופון נותקו",
  "media-recorder-error": "שגיאת הקלטה",
  "media-recorder-start-failed": "ההקלטה לא התחילה",
  "media-recorder-stop-failed": "ההקלטה לא הסתיימה כראוי"
};

function diagnosticEventLabel(name: string) {
  return diagnosticEventLabels[name] ?? "אירוע טכני";
}

function diagnosticDetailLabel(value?: string) {
  if (!value) return "פרט טכני";
  return diagnosticDetailLabels[value] ?? "פרט טכני זמין בקובץ הייצוא";
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

const LEGACY_VISUAL_SAMPLE_SECONDS = 1.2;

function visualObservationDuration(observation: VisualObservation) {
  return typeof observation.metadata?.sampleIntervalMs === "number"
    ? clamp(observation.metadata.sampleIntervalMs / 1000, 0.5, 3)
    : LEGACY_VISUAL_SAMPLE_SECONDS;
}

function visualDurationWhere(observations: VisualObservation[], predicate: (observation: VisualObservation) => boolean) {
  const samples = new Map<number, number>();
  observations.forEach((observation) => {
    if (!predicate(observation)) return;
    const duration = visualObservationDuration(observation);
    samples.set(observation.seconds, Math.max(samples.get(observation.seconds) ?? 0, duration));
  });
  return Math.round(Array.from(samples.values()).reduce((sum, duration) => sum + duration, 0));
}

function visualDuration(
  observations: VisualObservation[],
  labels: VisualObservation["label"][],
  subject?: PartnerId
) {
  return visualDurationWhere(
    observations,
    (observation) => labels.includes(observation.label) && (!subject || observation.subject === subject)
  );
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds} שנ׳`;
  }
  return `${Math.floor(seconds / 60)} דק׳ ${seconds % 60} שנ׳`;
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
  // The product UI and the primary real-world use are Hebrew. In auto mode,
  // starting with Hebrew is safer than waiting for an English-biased result
  // that may never arrive and therefore cannot trigger script detection.
  return "he-IL";
}

function computeNonverbalMetrics(observations: VisualObservation[]): NonverbalMetrics {
  const seconds = (labels: VisualObservation["label"][], subject?: PartnerId) => visualDuration(observations, labels, subject);
  const qualitySamples = observations.filter((observation) => observation.label === "capture-quality");

  return {
    sampleCount: new Set(qualitySamples.map((observation) => observation.seconds)).size || new Set(observations.map((observation) => observation.seconds)).size,
    analyzedSeconds: seconds(["capture-quality"]),
    faceCoverageSeconds: visualDurationWhere(qualitySamples, (observation) => Number(observation.metadata?.faceCount ?? 0) >= 1),
    twoFaceCoverageSeconds: visualDurationWhere(qualitySamples, (observation) => Number(observation.metadata?.faceCount ?? 0) >= 2),
    poseCoverageSeconds: visualDurationWhere(qualitySamples, (observation) => Number(observation.metadata?.poseCount ?? 0) >= 1),
    lowQualitySeconds: visualDurationWhere(qualitySamples, (observation) => observation.score < 0.35),
    headOrientationChangeSecondsA: seconds(["head-orientation-change"], "A"),
    headOrientationChangeSecondsB: seconds(["head-orientation-change"], "B"),
    bodyMovementSecondsA: seconds(["body-movement"], "A"),
    bodyMovementSecondsB: seconds(["body-movement"], "B"),
    sharedFrameSeconds: seconds(["shared-frame"]),
    mutualAttentionSeconds: seconds(["mutual-attention"]),
    partnerGazeSecondsA: seconds(["partner-gaze"], "A"),
    partnerGazeSecondsB: seconds(["partner-gaze"], "B"),
    lookAwaySecondsA: seconds(["looking-away"], "A"),
    lookAwaySecondsB: seconds(["looking-away"], "B"),
    warmExpressionSeconds: seconds(["warm-expression"]),
    tensionSeconds: seconds(["brow-tension", "mouth-tension", "closed-posture", "leaning-away", "head-turned-away"]),
    engagementSeconds: seconds(["possible-engagement", "mutual-attention", "partner-gaze"]),
    withdrawalSeconds: seconds(["possible-withdrawal", "leaning-away", "head-turned-away"])
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
  { id: "daily-check-in", label: "בדיקה יומית" },
  { id: "conflict", label: "מחלוקת" },
  { id: "repair", label: "תיקון" },
  { id: "intimacy", label: "אינטימיות" },
  { id: "shared-meaning", label: "משמעות משותפת" }
];

function sessionTypeForDeck(deckId: string): SessionType {
  if (deckId === "repair") return "repair";
  if (deckId === "gridlock") return "conflict";
  if (deckId === "desire") return "intimacy";
  if (deckId === "shared-meaning") return "shared-meaning";
  return "daily-check-in";
}

function conversationGuide(sessionType: SessionType, deckId?: string) {
  if (deckId === "gridlock") {
    return {
      title: "איך חוקרים מה נמצא מתחת לעמדה",
      intro: "כאן לא מבקשים פתרון ולא מנסחים צורך מעשי. המטרה היא להבין את החלום, הערך או הפחד שהנושא מייצג עבור כל אחד.",
      steps: [
        "אחד עונה על שאלת הכרטיס ומסביר למה הדבר חשוב לו.",
        "השני שואל שאלה סקרנית אחת, בלי לשכנע ובלי להציע פשרה.",
        "מחליפים, ובסוף נותנים שם לדבר החשוב שכל אחד רוצה לשמור עליו."
      ]
    };
  }
  if (sessionType === "conflict") {
    return {
      title: "איך מדברים על נושא תקוע",
      intro: "כאן הפתיחה הרכה קשורה לנושא: מתארים אירוע מסוים, את ההשפעה שלו ובקשה מעשית אחת.",
      steps: [
        "הדובר/ת: כש___ קרה, הרגשתי___; חשוב לי___; האם נוכל___?",
        "המקשיב/ה: מסכם/ת את מה שהבין/ה לפני שמציגים עמדה אחרת.",
        "לא פותרים מיד: קודם מוודאים ששני הצדדים הובנו."
      ]
    };
  }
  if (sessionType === "repair") {
    return {
      title: "איך מתרגלים תיקון",
      intro: "המטרה אינה להכריע מי צדק, אלא לזהות מה נפגע ומה יעזור להתחיל מחדש.",
      steps: [
        "אחד משתף מה היה קשה ברגע המסוים.",
        "השני משקף את ההשפעה ששמע, בלי להסביר עדיין את הכוונה.",
        "מסיימים במשפט תיקון קטן שאפשר לזהות בפעם הבאה."
      ]
    };
  }
  if (sessionType === "intimacy") {
    return {
      title: "איך משתפים על קרבה ורצון",
      intro: "עונים על השאלה מתוך סקרנות. אין צורך להגיע לבקשה, החלטה או פתרון.",
      steps: [
        "אחד משתף בחוויה או ברצון שלו בקצב שנוח לו.",
        "השני מקשיב ושואל שאלה פתוחה אחת בלבד.",
        "אפשר להשאיר את התשובה פתוחה בלי להתחייב לשינוי."
      ]
    };
  }
  if (sessionType === "shared-meaning") {
    return {
      title: "איך חוקרים משמעות משותפת",
      intro: "כל אחד עונה מנקודת המבט שלו; אחר כך מחפשים ערך או טקס קטן שמשותף לשניכם.",
      steps: [
        "כל אחד מתאר מה השאלה מעוררת אצלו.",
        "מקשיבים לדמיון ולהבדלים בלי לתקן אותם.",
        "בסוף בוחרים רעיון קטן אחד שאפשר לנסות יחד."
      ]
    };
  }
  return {
    title: "איך משתמשים בשאלת השיתוף",
    intro: "השאלות האלה בונות את מפת האהבה ומעמיקות את ההיכרות עם העולם הפנימי זה של זו.",
    steps: [
      "אחד משתף בתשובה בקצב שנוח לו.",
      "השני מקשיב בסקרנות ושואל שאלה פתוחה אחת.",
      "כשזה מרגיש טבעי מתחלפים וממשיכים להכיר את העולם של האחר."
    ]
  };
}

const transcriptLanguages: { id: TranscriptLanguageMode; label: string }[] = [
  { id: "auto", label: "אוטומטי — עברית / אנגלית" },
  { id: "he-IL", label: "עברית" },
  { id: "en-US", label: "אנגלית" }
];

const cueOptions: { tone: LiveCue["tone"]; label: string }[] = [
  { tone: "warmth", label: "חום" },
  { tone: "repair", label: "ניסיון תיקון" },
  { tone: "humor", label: "הומור" },
  { tone: "softening", label: "התרככות" },
  { tone: "look-away", label: "הסטת מבט" },
  { tone: "overwhelm", label: "עומס" },
  { tone: "pause", label: "הפסקה" }
];

function visualSignalLabel(label: VisualObservation["label"]) {
  const labels: Record<VisualObservation["label"], string> = {
    "face-visible": "פנים נראות",
    "warm-expression": "חום אפשרי",
    "brow-tension": "מתח אפשרי בגבות",
    "mouth-tension": "מתח אפשרי בפה",
    "looking-away": "מבט אפשרי הצידה",
    "partner-gaze": "מבט אפשרי לבן או בת הזוג",
    "mutual-attention": "קשב הדדי אפשרי",
    "shared-frame": "שניכם בתמונה",
    "body-visible": "תנוחת הגוף נראית",
    "closed-posture": "תנוחה סגורה אפשרית",
    "leaning-away": "הישענות אפשרית לאחור",
    "head-turned-away": "הפניית ראש אפשרית",
    "sustained-warmth": "רצף אפשרי של חום",
    "sustained-tension": "רצף אפשרי של מתח",
    "possible-engagement": "מעורבות אפשרית",
    "possible-withdrawal": "התרחקות אפשרית",
    "capture-quality": "איכות כיסוי המצלמה",
    "smile-configuration": "תנועת זוויות הפה",
    "brow-movement": "תנועת גבות",
    "mouth-press": "הצמדת שפתיים",
    "eyes-turned-sideways": "כיוון עיניים הצידה",
    "head-orientation-offset": "כיוון הראש השתנה מהמרכז",
    "head-orientation-change": "שינוי בכיוון הראש",
    "wrists-near-opposite-shoulders": "פרקי הידיים ליד הכתפיים הנגדיות",
    "body-near-frame-edge": "מרכז הגוף ליד שולי התמונה",
    "body-movement": "תנועת גוף בין רגעים"
  };
  return labels[label];
}

/**
 * Hebrew label, family, and an accessible glyph for each live vocal state. The
 * family drives the pill colour so the tone tags read the same as the
 * transcript interaction tags.
 */
const VOCAL_STATE_META: Record<
  VocalObservation["label"],
  { label: string; family: "flooding" | "strength" | "four-horsemen" | "nonverbal"; glyph: string }
> = {
  "raised-voice": { label: "הרמת קול", family: "flooding", glyph: "🔊" },
  "tense-voice": { label: "מתח בקול", family: "four-horsemen", glyph: "📈" },
  "flat-withdrawn": { label: "קול שטוח/מרוחק", family: "nonverbal", glyph: "🌫️" },
  "warm-engaged": { label: "טון חם ומעורב", family: "strength", glyph: "💛" },
  "long-pause": { label: "שתיקה ארוכה", family: "nonverbal", glyph: "⏸️" }
};

function VocalToneTag({
  observation,
  profile,
  live = false
}: {
  observation: VocalObservation;
  profile: CoupleProfile;
  live?: boolean;
}) {
  const meta = VOCAL_STATE_META[observation.label];
  const who = observation.subject ? partnerName(profile, observation.subject) : null;
  return (
    <span className={`vocal-tone-tag tag-pill ${meta.family}${live ? " live" : ""}`} title={observation.evidence}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.label}{who ? ` · ${who}` : ""}</span>
    </span>
  );
}

const VOCAL_LABEL_ORDER: VocalObservation["label"][] = [
  "warm-engaged",
  "tense-voice",
  "raised-voice",
  "flat-withdrawn",
  "long-pause"
];

function VocalTonePanel({
  profile,
  observations
}: {
  profile: CoupleProfile;
  observations: VocalObservation[];
}) {
  const counts = observations.reduce<Partial<Record<VocalObservation["label"], number>>>((grouped, observation) => {
    grouped[observation.label] = (grouped[observation.label] ?? 0) + 1;
    return grouped;
  }, {});
  const recent = observations.slice(-6).reverse();

  return (
    <div className="panel vocal-panel">
      <div className="panel-heading">
        <h2>טון הקול שנשמע</h2>
        <Mic size={18} aria-hidden="true" />
      </div>
      <p className="muted">
        המדדים מתארים את צליל הקול — עוצמה, גובה ושתיקות — כפי שנקלט במיקרופון. הם אינם קובעים רגש או כוונה.
      </p>
      {observations.length === 0 ? (
        <p className="muted">לא נקלט מספיק קול לניתוח טון בשיחה הזו.</p>
      ) : (
        <>
          <div className="vocal-tone-summary">
            {VOCAL_LABEL_ORDER.map((label) => {
              const count = counts[label] ?? 0;
              if (count === 0) return null;
              const meta = VOCAL_STATE_META[label];
              return (
                <span key={label} className={`tag-pill ${meta.family}`}>
                  <span aria-hidden="true">{meta.glyph}</span> {meta.label}: {count}
                </span>
              );
            })}
          </div>
          {recent.length > 0 && (
            <ul className="vocal-tone-list">
              {recent.map((observation) => (
                <li key={observation.id}>
                  <VocalToneTag observation={observation} profile={profile} />
                  <span className="vocal-tone-when">
                    <bdi dir="ltr">{formatTime(observation.seconds)}</bdi> · {observation.evidence}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const navItems: { view: View; label: string; icon: typeof HeartHandshake; desktopOnly?: boolean }[] = [
  { view: "dashboard", label: "בית", icon: HeartHandshake },
  { view: "practice", label: "תרגול", icon: Video },
  { view: "insights", label: "תובנות", icon: Activity },
  { view: "adviser", label: "מדריך", icon: Sparkles, desktopOnly: true },
  { view: "report", label: "דוח", icon: FileText, desktopOnly: true },
  { view: "more", label: "עוד", icon: MoreHorizontal }
];

const knownViews = new Set<View>([
  "dashboard", "setup", "assess", "practice", "insights", "adviser", "report", "settings", "export", "diagnostics", "more"
]);

function isKnownView(view: View | null): view is View {
  return Boolean(view && knownViews.has(view));
}

export default function App() {
  const [view, setViewState] = useState<View>(() => {
    if (typeof window === "undefined") return "dashboard";
    const requestedView = new URLSearchParams(window.location.search).get("view") as View | null;
    return isKnownView(requestedView) ? requestedView : "dashboard";
  });
  const [profile, setProfile] = useLocalState<CoupleProfile>(storageKeys.profile, defaultProfile);
  const [assessment, setAssessment] = useLocalState<AssessmentState>(storageKeys.assessment, defaultAssessment);
  const [sessions, setSessions] = useLocalState<SessionRecord[]>(storageKeys.sessions, []);
  const [signals, setSignals] = useLocalState<BodySignals>(storageKeys.signals, defaultSignals);
  const [safety, setSafety] = useLocalState<SafetyState>(storageKeys.safety, defaultSafety);
  const [deckStats, setDeckStats] = useLocalState<Record<string, number>>(storageKeys.deckStats, {});
  const [questionHistory, setQuestionHistory] = useLocalState<QuestionHistory>(storageKeys.questionHistory, {});
  const [transcriptLanguage, setTranscriptLanguage] = useLocalState<TranscriptLanguageMode>(storageKeys.transcriptLanguage, "auto");
  const [interfaceLanguage, setInterfaceLanguage] = useLocalState<InterfaceLanguage>(storageKeys.interfaceLanguage, "he");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [practiceLaunch, setPracticeLaunch] = useState<PracticeLaunch | null>(null);

  useEffect(() => {
    if (interfaceLanguage !== "he") {
      setInterfaceLanguage("he");
      return;
    }
    document.documentElement.lang = interfaceLanguage;
    document.documentElement.dir = interfaceLanguage === "he" ? "rtl" : "ltr";
  }, [interfaceLanguage, setInterfaceLanguage]);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const clearInstallPrompt = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", clearInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", clearInstallPrompt);
    };
  }, []);

  useEffect(() => {
    const syncViewFromHistory = () => {
      const requestedView = new URLSearchParams(window.location.search).get("view") as View | null;
      const nextView = isKnownView(requestedView) ? requestedView : "dashboard";
      setViewState(nextView);
      window.scrollTo({ top: 0, behavior: "auto" });
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>("h1")?.focus());
    };
    window.addEventListener("popstate", syncViewFromHistory);
    return () => window.removeEventListener("popstate", syncViewFromHistory);
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const safetyFlag = Object.values({
    fearOrCoercion: safety.fearOrCoercion,
    violenceOrThreats: safety.violenceOrThreats,
    pressuredToParticipate: safety.pressuredToParticipate,
    seriousDepressionOrAddiction: safety.seriousDepressionOrAddiction
  }).some(Boolean);
  const profileConfigured = Boolean(profile.partnerAName.trim() && profile.partnerBName.trim());
  const registrationComplete = profileConfigured && assessmentComplete(assessment);

  useEffect(() => {
    const visibleTitle = !registrationComplete && view === "dashboard" ? "מתחילים כאן" : pageTitle(view);
    document.title = `${visibleTitle} — Couple Lab`;
  }, [registrationComplete, view]);

  useEffect(() => {
    if (registrationComplete || view === "dashboard" || view === "setup") return;
    setViewState("dashboard");
    const url = new URL(window.location.href);
    url.searchParams.set("view", "dashboard");
    window.history.replaceState({ view: "dashboard" }, "", url);
  }, [registrationComplete, view]);

  const latestSession = sessions[0];
  const secondaryViewActive = ["assess", "settings", "export", "diagnostics"].includes(view);
  const setView = (nextView: View) => {
    if (nextView === view) return;
    setViewState(nextView);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", nextView);
      window.history.pushState({ view: nextView }, "", url);
      window.scrollTo({ top: 0, behavior: "auto" });
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>("h1")?.focus());
    }
  };
  const startPractice = (launch?: PracticeLaunch) => {
    setPracticeLaunch(launch ?? null);
    setView("practice");
  };

  useEffect(() => {
    if (view !== "practice") setPracticeLaunch(null);
  }, [view]);

  return (
    <>
      <a className="skip-link" href="#main-content">דילוג לתוכן הראשי</a>
      <div className="app-shell">
      <aside className="sidebar" aria-label="ניווט ראשי">
        <div className="brand">
          <div className="brand-mark">
            <img src="/app-icon.png" alt="" width={40} height={40} aria-hidden="true" />
          </div>
          <div>
            <strong>Couple Lab</strong>
            <span>מרחב לשיחה זוגית</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                className={`nav-item ${view === item.view || (item.view === "more" && secondaryViewActive) ? "active" : ""} ${item.desktopOnly ? "desktop-nav-only" : ""}`}
                onClick={() => item.view === "practice" ? startPractice() : setView(item.view)}
                disabled={!registrationComplete && item.view !== "dashboard"}
                aria-current={view === item.view || (item.view === "more" && secondaryViewActive) ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

      </aside>

      <main className="main" id="main-content">
        <header className="topbar">
          <div>
            <h1 tabIndex={-1}>{!registrationComplete && view === "dashboard" ? "מתחילים כאן" : pageTitle(view)}</h1>
          </div>
          {safetyFlag && (
            <div className="safety-pill alert">
              <ShieldCheck size={16} />
              נדרשת בדיקת בטיחות
            </div>
          )}
          {installPrompt && (
            <button className="secondary install-button" onClick={installApp}>
              <Smartphone size={17} />
              התקנה בטלפון
            </button>
          )}
        </header>

        {view === "dashboard" && !registrationComplete && (
          <FirstRunDashboard
            onStart={() => setView("setup")}
          />
        )}
        {view === "dashboard" && registrationComplete && (
          <Dashboard
            profile={profile}
            setProfile={setProfile}
            latestSession={latestSession}
            sessions={sessions}
            assessment={assessment}
            setAssessment={setAssessment}
            assessmentUpdated={assessmentComplete(assessment)}
            transcriptLanguage={transcriptLanguage}
            setTranscriptLanguage={setTranscriptLanguage}
            interfaceLanguage={interfaceLanguage}
            setInterfaceLanguage={setInterfaceLanguage}
            setView={setView}
            switchCouple={async () => {
              if (!window.confirm("להתחיל פרופיל זוגי חדש במכשיר הזה? הסשנים המקומיים הנוכחיים יימחקו.")) {
                return;
              }
              try {
                await window.coupleLabDesktop?.clearBiometricEnrollment();
                await clearDeviceStore();
              } catch {
                window.alert("מחיקת נתוני הזיהוי או ההקלטות נכשלה. הפרופיל לא הוחלף כדי שלא לערבב מידע בין זוגות.");
                return;
              }
              setProfile({ ...defaultProfile, createdAt: new Date().toISOString() });
              setAssessment(defaultAssessment);
              setSessions([]);
              setSignals(defaultSignals);
              setSafety(defaultSafety);
              setDeckStats({});
              setQuestionHistory({});
              setTranscriptLanguage("auto");
              localStorage.removeItem(storageKeys.assessment);
              localStorage.removeItem(storageKeys.sessions);
              localStorage.removeItem(storageKeys.safety);
              localStorage.removeItem(storageKeys.deckStats);
              localStorage.removeItem(storageKeys.questionHistory);
              localStorage.removeItem(storageKeys.transcriptLanguage);
            }}
          />
        )}
        {view === "setup" && (
          <Dashboard
            profile={profile}
            setProfile={setProfile}
            latestSession={latestSession}
            sessions={sessions}
            assessment={assessment}
            setAssessment={setAssessment}
            assessmentUpdated={assessmentComplete(assessment)}
            transcriptLanguage={transcriptLanguage}
            setTranscriptLanguage={setTranscriptLanguage}
            interfaceLanguage={interfaceLanguage}
            setInterfaceLanguage={setInterfaceLanguage}
            setView={setView}
            setupMode
            onSetupComplete={() => setView("dashboard")}
            switchCouple={async () => undefined}
          />
        )}
        {view === "assess" && (
          <AssessView profile={profile} assessment={assessment} setAssessment={setAssessment} onContinue={() => startPractice()} />
        )}
        {view === "practice" && (
          <PracticeStudio
            profile={profile}
            setProfile={setProfile}
            assessment={assessment}
            signals={signals}
            sessions={sessions}
            setSessions={setSessions}
            safetyFlag={safetyFlag}
            deckStats={deckStats}
            setDeckStats={setDeckStats}
            questionHistory={questionHistory}
            setQuestionHistory={setQuestionHistory}
            transcriptLanguage={transcriptLanguage}
            setTranscriptLanguage={setTranscriptLanguage}
            practiceLaunch={practiceLaunch}
            onViewResults={() => setView("insights")}
          />
        )}
        {view === "insights" && <InsightsView sessions={sessions} profile={profile} setSessions={setSessions} />}
        {view === "adviser" && (
          <AdviserView profile={profile} assessment={assessment} sessions={sessions} safety={safety} setView={setView} onStartPractice={startPractice} />
        )}
        {view === "report" && (
          <ReportView profile={profile} assessment={assessment} sessions={sessions} safety={safety} />
        )}
        {view === "settings" && (
          <Dashboard
            profile={profile}
            setProfile={setProfile}
            latestSession={latestSession}
            sessions={sessions}
            assessment={assessment}
            setAssessment={setAssessment}
            assessmentUpdated={assessmentComplete(assessment)}
            transcriptLanguage={transcriptLanguage}
            setTranscriptLanguage={setTranscriptLanguage}
            interfaceLanguage={interfaceLanguage}
            setInterfaceLanguage={setInterfaceLanguage}
            setView={setView}
            settingsMode
            onSettingsComplete={() => setView("more")}
            switchCouple={async () => undefined}
          />
        )}
        {view === "export" && (
            <ExportSafetyView
              profile={profile}
              assessment={assessment}
            sessions={sessions}
            safety={safety}
            setSafety={setSafety}
            clearAll={async () => {
              if (window.confirm("למחוק מהמכשיר הזה את כל נתוני Couple Lab, כולל הקלטות ולוגים?")) {
                try {
                  await window.coupleLabDesktop?.clearBiometricEnrollment();
                  await clearDeviceStore();
                  Object.values(storageKeys).forEach((key) => localStorage.removeItem(key));
                  window.location.reload();
                } catch {
                  window.alert("לא ניתן היה למחוק את כל המידע המקומי. הנתונים שנמחקו עד לנקודת הכשל אינם ניתנים לשחזור.");
                }
              }
            }}
          />
        )}
        {view === "diagnostics" && <DiagnosticsView />}
        {view === "more" && <MoreView setView={setView} safetyFlag={safetyFlag} sessions={sessions} onOpenSettings={() => setView("settings")} />}
      </main>
    </div>
    </>
  );
}

function pageTitle(view: View) {
  const titles: Record<View, string> = {
    dashboard: "המרחב הזוגי שלנו",
    setup: "הגדרת הזוג",
    assess: "מפת הקשר",
    practice: "תרגול שיחה",
    insights: "תובנות מהשיחות",
    adviser: "המדריך לתרגול הבא",
    report: "הדוח הזוגי",
    settings: "הגדרות",
    export: "בטיחות וסודיות",
    diagnostics: "בדיקות ותמיכה",
    more: "כלים נוספים"
  };
  return titles[view];
}

function MoreView({
  setView,
  safetyFlag,
  sessions,
  onOpenSettings
}: {
  setView: (view: View) => void;
  safetyFlag: boolean;
  sessions: SessionRecord[];
  onOpenSettings: () => void;
}) {
  const tools = [
    { key: "adviser", label: "המדריך", detail: "המלצה לתרגול הבא שמתאים לכם", icon: Sparkles, action: () => setView("adviser") },
    { key: "report", label: "הדוח הזוגי", detail: "תמונה מסכמת של התהליך והצעדים", icon: FileText, action: () => setView("report") },
    { key: "assessment", label: "מפת הקשר", detail: "צפייה ועדכון של ההערכה", icon: ClipboardCheck, action: () => setView("assess") },
    { key: "settings", label: "הגדרות", detail: "שמות, שפה וזיהוי אוטומטי", icon: Settings, action: onOpenSettings },
    { key: "privacy", label: "בטיחות וסודיות", detail: safetyFlag ? "נדרשת בדיקת בטיחות" : "הסכמות, ייצוא ומחיקה", icon: ShieldCheck, action: () => setView("export") },
    { key: "diagnostics", label: "בדיקות ותמיכה", detail: "מידע שעוזר לפתור תקלות", icon: Activity, action: () => setView("diagnostics") }
  ];

  return (
    <section className="stack">
      <div className="local-data-summary">
        <Lock size={22} aria-hidden="true" />
        <div>
          <strong>נשאר במחשב הזה</strong>
          <p>השיחות, הפרטים ותמונות הפרופיל שלכם אינם נשלחים לענן.</p>
        </div>
        <div className="local-session-count" aria-label={`${sessions.length} שיחות שמורות`}>
          <strong>{sessions.length}</strong>
          <span>{sessions.length === 1 ? "שיחה שמורה" : "שיחות שמורות"}</span>
        </div>
      </div>
      <div className="tile-grid four more-grid">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button className="metric-tile" key={tool.key} onClick={tool.action}>
              <Icon size={20} />
              <span>{tool.label}</span>
              <strong>{tool.detail}</strong>
              <ChevronRight size={18} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FirstRunDashboard({
  onStart
}: {
  onStart: () => void;
}) {
  return (
    <section className="stack first-run-home">
      <div className="first-run-hero">
        <div className="first-run-copy">
          <h2>נכיר אתכם, נבין מה חשוב לכם — ואז נתחיל לתרגל</h2>
          <p>כל אחד יענה על שאלון קצר, ואז נלמד לזהות מי מדבר — כדי שתוכלו להתמקד זה בזו, ולא בכפתורים.</p>
          <button className="primary" onClick={onStart}>
            <ChevronRight size={18} aria-hidden="true" />
            בואו נתחיל
          </button>
          <ol className="first-run-summary" aria-label="שלבי ההגדרה">
            <li><strong>1</strong><span>שאלון קצר לכל אחד</span></li>
            <li><strong>2</strong><span>נלמד לזהות אתכם</span></li>
            <li><strong>3</strong><span>התרגול הראשון שלכם</span></li>
          </ol>
        </div>
        <img
          className="first-run-image"
          src="/couple-lab-hero.png"
          alt="איור של בני זוג יושבים זה מול זו לשיחה רגועה"
          width={1672}
          height={941}
          fetchPriority="high"
        />
      </div>
    </section>
  );
}

/**
 * Transcription engine status and one-click upgrade.
 *
 * The packaged whisper-tiny pack measures around 80% word error rate on
 * Hebrew, which makes the transcript — and every metric derived from it —
 * unusable. The stronger packs are official sherpa-onnx exports, so the app
 * downloads and activates one directly. No terminal, no manual file handling.
 */
function TranscriptionEnginePanel() {
  const bridge = typeof window !== "undefined" ? window.coupleLabDesktop : undefined;
  const [modelId, setModelId] = useState<string>("");
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [message, setMessage] = useState("");
  const [choice, setChoice] = useState<"turbo" | "small">("turbo");
  const calibration = useMemo(() => summarizeCalibration(readCalibrationState()), [modelId, installing]);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getTranscriptionModelStatus().then((status) => setModelId(status.modelId ?? "")).catch(() => undefined);
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.onTranscriptionModelProgress) return;
    return bridge.onTranscriptionModelProgress((update) => {
      setProgress({ received: update.receivedBytes, total: update.totalBytes });
    });
  }, [bridge]);

  if (!bridge?.installTranscriptionModel) return null;

  const isBasicModel = modelId.includes("tiny");
  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.received / progress.total) * 100))
    : 0;

  const install = async () => {
    setInstalling(true);
    setMessage("מורידים את מנוע התמלול. אפשר להמשיך להשתמש באפליקציה.");
    setProgress({ received: 0, total: 1 });
    try {
      const result = await bridge.installTranscriptionModel!(choice);
      setModelId(result.modelId);
      setMessage("המנוע החדש פעיל. כדאי לעשות כיול קצר כדי לראות את ההבדל.");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message.includes("download-failed")
          ? "ההורדה נכשלה. בדקו את החיבור לאינטרנט ונסו שוב."
          : "לא הצלחנו להתקין את המנוע. אפשר לנסות שוב."
      );
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  };

  return (
    <div className="engine-panel">
      <div className="engine-heading">
        <Mic size={19} aria-hidden="true" />
        <div>
          <strong>{isBasicModel ? "מנוע התמלול הבסיסי פעיל" : "מנוע תמלול משופר פעיל"}</strong>
          <p>
            {calibration.averageWer !== null
              ? `בבדיקה האחרונה זוהו כ־${Math.max(0, Math.round((1 - calibration.averageWer) * 100))}% מהמילים שקראתם.`
              : "עדיין לא נמדדה איכות התמלול. אפשר למדוד בכיול הקול."}
          </p>
        </div>
      </div>

      {isBasicModel && (
        <p className="engine-note">
          המנוע הבסיסי חלש בעברית. גרסה חזקה יותר משפרת את התמלול משמעותית, ואיתו גם הסיכום,
          זיהוי מי אמר מה והרגעים שנשמרים לכם.
        </p>
      )}

      <label className="preference-field">
        גרסה
        <select value={choice} disabled={installing} onChange={(event) => setChoice(event.target.value as "turbo" | "small")}>
          <option value="turbo">מדויקת — כ־1 ג׳יגה, מומלצת</option>
          <option value="small">קלה — כ־0.4 ג׳יגה, מהירה יותר</option>
        </select>
        <small>ההורדה חד־פעמית ונשמרת במחשב. אפשר לחזור למנוע הקודם בכל שלב.</small>
      </label>

      {installing && (
        <div className="engine-progress" role="status" aria-live="polite">
          <div className="engine-progress-track">
            <div className="engine-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span dir="ltr">{percent}%</span>
        </div>
      )}

      <button type="button" className="secondary" disabled={installing} onClick={() => void install()}>
        <Download size={16} aria-hidden="true" />
        {installing ? "מוריד…" : isBasicModel ? "שדרוג מנוע התמלול" : "החלפת מנוע התמלול"}
      </button>

      {message && <p className="engine-message" role="status">{message}</p>}
    </div>
  );
}

function Dashboard({
  profile,
  setProfile,
  latestSession,
  sessions,
  assessment,
  setAssessment,
  assessmentUpdated,
  transcriptLanguage,
  setTranscriptLanguage,
  interfaceLanguage,
  setInterfaceLanguage,
  setView,
  switchCouple,
  setupMode = false,
  onSetupComplete,
  settingsMode = false,
  onSettingsComplete
}: {
  profile: CoupleProfile;
  setProfile: (profile: CoupleProfile) => void;
  latestSession?: SessionRecord;
  sessions: SessionRecord[];
  assessment: AssessmentState;
  setAssessment: (assessment: AssessmentState) => void;
  assessmentUpdated: boolean;
  transcriptLanguage: TranscriptLanguageMode;
  setTranscriptLanguage: React.Dispatch<React.SetStateAction<TranscriptLanguageMode>>;
  interfaceLanguage: InterfaceLanguage;
  setInterfaceLanguage: React.Dispatch<React.SetStateAction<InterfaceLanguage>>;
  setView: (view: View) => void;
  switchCouple: () => void | Promise<void>;
  setupMode?: boolean;
  onSetupComplete?: () => void;
  settingsMode?: boolean;
  onSettingsComplete?: () => void;
}) {
  const [editingCouple, setEditingCouple] = useState(
    () => setupMode || settingsMode
  );
  const [registrationMode, setRegistrationMode] = useState(
    () => setupMode && !(profile.partnerAName.trim() && profile.partnerBName.trim() && assessmentComplete(assessment))
  );
  const [setupPartner, setSetupPartner] = useState<PartnerId>(() =>
    partnerRegistrationComplete(profile, assessment, "A") && !partnerRegistrationComplete(profile, assessment, "B") ? "B" : "A"
  );
  const [setupAccessGranted, setSetupAccessGranted] = useState(
    () => !(partnerRegistrationComplete(profile, assessment, "A") && !partnerRegistrationComplete(profile, assessment, "B"))
  );
  const [enrollmentSummary, setEnrollmentSummary] = useState<BiometricEnrollmentSummary | null>(null);
  const [setupNameMessage, setSetupNameMessage] = useState("");
  const setupNameInputRef = useRef<HTMLInputElement | null>(null);
  const profileReady = Boolean(profile.partnerAName.trim() && profile.partnerBName.trim());
  const setupPartnerName = partnerName(profile, setupPartner);
  const setupNameReady = Boolean((setupPartner === "A" ? profile.partnerAName : profile.partnerBName).trim());
  const setupAnsweredCount = domains.filter((domain) => Number.isFinite(assessment[setupPartner][domain.key])).length;
  const setupAssessmentComplete = setupNameReady && partnerAssessmentComplete(assessment, setupPartner);
  const setupCalibrated = Boolean(enrollmentSummary?.partners[setupPartner]);

  useEffect(() => {
    if (setupMode && (!profileReady || !assessmentUpdated)) setEditingCouple(true);
    if (settingsMode) setEditingCouple(true);
  }, [profileReady, assessmentUpdated, setupMode, settingsMode]);

  useEffect(() => {
    if (!setupMode || assessmentUpdated) return;
    setRegistrationMode(true);
  }, [assessmentUpdated, setupMode]);

  useEffect(() => {
    if (assessmentUpdated) return;
    const nextPartner = partnerRegistrationComplete(profile, assessment, "A") ? "B" : "A";
    setSetupPartner(nextPartner);
    setSetupAccessGranted(nextPartner === "A");
  }, [profile.createdAt]);

  useEffect(() => {
    setSetupNameMessage("");
    if (!editingCouple || !registrationMode || !setupAccessGranted || setupNameReady) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const frame = window.requestAnimationFrame(() => setupNameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editingCouple, registrationMode, setupAccessGranted, setupNameReady, setupPartner]);

  const requestSetupPartner = (partner: PartnerId) => {
    if (partner === setupPartner && setupAccessGranted) return;
    setSetupPartner(partner);
    setSetupAccessGranted(false);
  };

  const updateSetupScore = (domainKey: string, value: number) => {
    if (!setupNameReady) return;
    setAssessment({
      ...assessment,
      [setupPartner]: {
        ...assessment[setupPartner],
        [domainKey]: value
      },
      completedBy: {
        ...assessment.completedBy,
        [setupPartner]: undefined
      },
      updatedAt: undefined,
      schemaVersion: 2
    });
  };

  const requestNameBeforeQuestion = () => {
    setSetupNameMessage("כדי להתחיל בשאלון, כתבו קודם איך קוראים לכם.");
    window.requestAnimationFrame(() => {
      setupNameInputRef.current?.focus();
      setupNameInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const completeSetupAssessment = () => {
    if (!setupNameReady || setupAnsweredCount !== domains.length) return;
    const completedAt = new Date().toISOString();
    const nextAssessment: AssessmentState = {
      ...assessment,
      completedBy: {
        ...assessment.completedBy,
        [setupPartner]: completedAt
      },
      schemaVersion: 2
    };
    const willBeComplete = partnerAssessmentComplete(nextAssessment, "A") && partnerAssessmentComplete(nextAssessment, "B");
    setAssessment({ ...nextAssessment, updatedAt: willBeComplete ? completedAt : undefined });
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const savePartnerPhoto = (partner: PartnerId, dataUrl: string) => {
    setProfile({
      ...profile,
      partnerPhotos: { ...profile.partnerPhotos, [partner]: dataUrl }
    });
  };

  const continueSetup = () => {
    if (setupPartner === "A") {
      setSetupPartner("B");
      setSetupAccessGranted(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setRegistrationMode(false);
    setEditingCouple(false);
    onSetupComplete?.();
  };

  const sharedStep = latestSession?.closingReflection?.nextStep;
  const guideSuggestion = latestSession?.analysis.nextSteps?.[0];
  const nextAction = !assessmentUpdated && !latestSession
    ? {
        title: "נתחיל במפת הקשר",
        body: "כל אחד מכם יענה בנפרד על עשרה עקרונות. ההשוואה תופיע רק לאחר ששניכם תסיימו.",
        view: "assess" as View,
        button: "התחלת מפת הקשר",
        icon: ClipboardCheck
      }
    : !latestSession
      ? {
          title: "מתחילים תרגול מודרך ראשון",
          body: "בוחרים שאלה, מדברים בקצב שלכם ומסיימים בשמירה ובסיכום.",
          view: "practice" as View,
          button: "לבחירת תרגול",
          icon: Video
        }
      : sharedStep
        ? {
            title: "הצעד שבחרתם יחד",
            body: sharedStep,
            view: "practice" as View,
            button: latestSession?.followUp ? "לשיחה הבאה" : "לבדיקה ותרגול",
            icon: HeartHandshake
          }
        : {
            title: "התרגול הבא שלכם",
            body: guideSuggestion || "בחרו יחד צעד קטן אחד מתוך השיחה האחרונה.",
            view: "adviser" as View,
            button: "פתיחת המדריך",
            icon: Sparkles
          };
  const NextIcon = nextAction.icon;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentSessions = sessions.filter((session) => {
    const startedAt = new Date(session.startedAt).getTime();
    return Number.isFinite(startedAt) && startedAt >= sevenDaysAgo;
  });
  const recentMinutes = Math.round(recentSessions.reduce((sum, session) => sum + session.durationSeconds, 0) / 60);
  const rhythmItems = [
    {
      label: "שתי שיחות קצרות ומונחות",
      detail: `${Math.min(recentSessions.length, 2)} מתוך 2 בשבעת הימים האחרונים`,
      done: recentSessions.length >= 2
    },
    {
      label: "ניסיון תיקון אחד שזוהה",
      detail: "זוהה או סומן במהלך שיחה שנשמרה",
      done: recentSessions.some((session) => session.analysis.metrics.repairSignals > 0)
    },
    {
      label: "רגע אחד של הערכה או תיקוף",
      detail: "הפקדה קטנה בחשבון הקשר",
      done: recentSessions.some(
        (session) =>
          session.analysis.metrics.validationSignals > 0 || session.analysis.metrics.emotionalBankDeposits > 0
      )
    },
    {
      label: "תרגול אחד של קרבה או משמעות משותפת",
      detail: "קרבה, משחקיות, ערכים או טקס משותף",
      done: recentSessions.some(
        (session) => session.type === "intimacy" || session.type === "shared-meaning" || session.analysis.tags.some((tag) => tag.family === "desire")
      )
    }
  ];
  const rhythmDone = rhythmItems.filter((item) => item.done).length;

  if (editingCouple && registrationMode) {
    const partnerADone = partnerRegistrationComplete(profile, assessment, "A");
    const partnerBDone = partnerRegistrationComplete(profile, assessment, "B");
    const nextName = partnerName(profile, otherPartner(setupPartner));

    return (
      <section className="stack setup-onboarding" aria-labelledby="couple-registration-title">
        <div className="setup-intro panel">
          <h2 id="couple-registration-title">נכיר כל אחד מכם בכמה דקות</h2>
          <p>כל אחד יענה בפרטיות על שאלון קצר, ואז נלמד לזהות אותו בזמן השיחה. בסיום מעבירים את המחשב לאדם השני.</p>
          <ol className="setup-steps" aria-label="שלבי רישום הזוג">
            <li className={partnerADone ? "done" : setupPartner === "A" ? "current" : "pending"}>
              <span>{partnerADone ? <Check size={16} /> : "1"}</span><strong>{profile.partnerAName || "אדם ראשון"}</strong><small>{partnerADone ? "מוכן/ה" : setupPartner === "A" ? "עכשיו" : "ממתין"}</small>
            </li>
            <li className={partnerBDone ? "done" : setupPartner === "B" ? "current" : "pending"}>
              <span>{partnerBDone ? <Check size={16} /> : "2"}</span><strong>{profile.partnerBName || "אדם שני"}</strong><small>{partnerBDone ? "מוכן/ה" : setupPartner === "B" ? "עכשיו" : "ממתין"}</small>
            </li>
            <li className={partnerADone && partnerBDone ? "current" : "pending"}>
              <span>3</span><strong>סיום ההגדרה</strong><small>אחרי שניכם</small>
            </li>
          </ol>
        </div>

        {!setupAccessGranted ? (
          <PrivateHandoff name={setupPartnerName} onReady={() => setSetupAccessGranted(true)} />
        ) : <div className="panel registration-card">
          <div className="registration-person-heading">
            <div className="registration-person-identity">
              <PartnerPortrait profile={profile} partner={setupPartner} />
              <div>
                <h2>{setupAssessmentComplete ? `עכשיו נלמד לזהות את ${setupPartnerName}` : setupNameReady ? setupPartnerName : "נתחיל בשם"}</h2>
              </div>
            </div>
            <div className="segmented compact" aria-label="בחירת האדם שמגדירים">
              <button aria-label={`אדם ראשון — ${profile.partnerAName || "טרם הוגדר"}`} className={setupPartner === "A" ? "active" : ""} onClick={() => requestSetupPartner("A")}>1</button>
              <button aria-label={`אדם שני — ${profile.partnerBName || "טרם הוגדר"}`} className={setupPartner === "B" ? "active" : ""} onClick={() => requestSetupPartner("B")} disabled={!partnerADone}>2</button>
            </div>
          </div>

          {!setupAssessmentComplete && <><label className="registration-name-field">
            <span className="visually-hidden">איך קוראים לך?</span>
            <input
              ref={setupNameInputRef}
              name={setupPartner === "A" ? "partner-a-name" : "partner-b-name"}
              autoComplete="off"
              dir="auto"
              value={setupPartner === "A" ? profile.partnerAName : profile.partnerBName}
              placeholder="איך קוראים לך?"
              aria-label="איך קוראים לך?"
              aria-describedby="setup-name-message"
              onChange={(event) => {
                setSetupNameMessage("");
                setProfile({
                  ...profile,
                  [setupPartner === "A" ? "partnerAName" : "partnerBName"]: event.target.value
                });
              }}
            />
          </label>
          <p id="setup-name-message" className={`setup-name-message ${setupNameMessage ? "visible" : ""}`} aria-live="polite">
            {setupNameMessage}
          </p>

          <div className={`registration-questionnaire ${!setupNameReady ? "needs-name" : ""}`}>
            <div className="assessment-progress" aria-live="polite">
              <strong>השאלון האישי של {setupNameReady ? setupPartnerName : "האדם הזה"}</strong>
              <span>{setupAnsweredCount} מתוך {domains.length} תשובות</span>
              <div><i style={{ width: `${(setupAnsweredCount / domains.length) * 100}%` }} /></div>
            </div>
            <p className="scale-help"><span>1 — כמעט לא מרגיש/ה כך עכשיו</span><span>10 — מרגיש/ה כך מאוד עכשיו</span></p>
            {domains.map((domain, index) => (
              <fieldset className="assessment-question" key={domain.key} data-locked={!setupNameReady ? "true" : undefined}>
                <legend>
                  <small>שאלה {index + 1}</small>
                  <strong>{domain.label}</strong>
                  <span>{domain.description}</span>
                </legend>
                <RatingScale
                  label={domain.label}
                  selected={assessment[setupPartner][domain.key]}
                  locked={!setupNameReady}
                  onLocked={requestNameBeforeQuestion}
                  onSelect={(value) => updateSetupScore(domain.key, value)}
                />
              </fieldset>
            ))}
            <button
              className="primary assessment-submit"
              onClick={completeSetupAssessment}
              disabled={!setupNameReady || setupAnsweredCount !== domains.length || setupAssessmentComplete}
            >
              <Check size={18} />
              {setupAssessmentComplete ? `התשובות של ${setupPartnerName} נשמרו` : "שמירה והמשך"}
            </button>
          </div>
          </>}

          {setupAssessmentComplete && (
            <DesktopFoundationPanel
              profile={profile}
              targetPartner={setupPartner}
              onSummaryChange={setEnrollmentSummary}
              onProfilePhotoCaptured={savePartnerPhoto}
              onEnrollmentComplete={continueSetup}
              completionActionLabel={setupPartner === "A" ? `מעבר אל ${nextName}` : "סיום הגדרת הזוג"}
            />
          )}

          {setupAssessmentComplete && (
            <div className="setup-actions registration-next">
              <div>
                <strong>{setupCalibrated ? `${setupPartnerName} מוכן/ה לתרגול` : "אפשר להשלים את הזיהוי עכשיו או לחזור אליו אחר כך"}</strong>
                <small>{setupPartner === "A" ? `אחר כך נעביר את המחשב אל ${nextName}.` : "לאחר הסיום תוכלו להתחיל את השיחה הראשונה."}</small>
              </div>
              <button
                className={setupCalibrated ? "primary" : "secondary"}
                disabled={setupPartner === "B" && !profileReady}
                onClick={continueSetup}
              >
                {setupCalibrated
                  ? setupPartner === "A" ? `מעבר אל ${nextName}` : "סיום הגדרת הזוג"
                  : setupPartner === "A" ? `עכשיו לא — מעבר אל ${nextName}` : "עכשיו לא — סיום ההגדרה"}
                <ChevronRight size={17} />
              </button>
            </div>
          )}
        </div>}
      </section>
    );
  }

  if (editingCouple) {
    return (
      <section className="stack setup-onboarding" aria-labelledby="couple-setup-title">
        <div className="setup-intro panel">
          <h2 id="couple-setup-title">כמה פרטים שיעזרו לנו ללוות אתכם</h2>
          <p>אפשר לעדכן שמות, לבחור מה תרצו לתרגל וללמד את האפליקציה לזהות אתכם.</p>
          <ol className="setup-steps" aria-label="שלבי הגדרת הזוג">
            <li className={profileReady ? "done" : "current"} aria-current={!profileReady ? "step" : undefined}><span>1</span><strong>פרטי הזוג</strong><small>{profileReady ? "הושלם" : "עכשיו"}</small></li>
            <li className={profileReady ? "current" : "pending"} aria-current={profileReady ? "step" : undefined}><span>2</span><strong>נלמד לזהות אתכם</strong><small>אפשר גם אחר כך</small></li>
            <li className="pending"><span>3</span><strong>תחילת תרגול</strong><small>לאחר שמירה</small></li>
          </ol>
        </div>

        <div className="profile-form couple-card setup-card">
          <div className="setup-section-heading wide">
            <span>שלב 1</span>
            <div>
              <h2>מי משתתף בתרגול?</h2>
              <p>כך נדע לפנות לכל אחד מכם במהלך התרגול.</p>
            </div>
          </div>
          <label>
            שם האדם הראשון
            <input
              autoFocus={!profile.partnerAName}
              name="partner-a-name"
              autoComplete="off"
              value={profile.partnerAName}
              placeholder="לדוגמה: תמר"
              onChange={(event) => setProfile({ ...profile, partnerAName: event.target.value })}
            />
          </label>
          <label>
            שם האדם השני
            <input
              name="partner-b-name"
              autoComplete="off"
              value={profile.partnerBName}
              placeholder="לדוגמה: אגמון"
              onChange={(event) => setProfile({ ...profile, partnerBName: event.target.value })}
            />
          </label>
          <label className="wide">
            מה הייתם רוצים לתרגל יחד?
            <input
              name="relationship-goal"
              autoComplete="off"
              value={profile.relationshipGoal}
              onChange={(event) => setProfile({ ...profile, relationshipGoal: event.target.value })}
            />
          </label>
          <details className="wide setup-settings">
            <summary>שפה, זיהוי אוטומטי ופרטיות</summary>
            <div className="setup-settings-content">
              <label className="preference-field">
                שפת הממשק
                <select name="interface-language" value={interfaceLanguage} onChange={(event) => setInterfaceLanguage(event.target.value as InterfaceLanguage)}>
                  <option value="he">עברית</option>
                  <option value="en" disabled>אנגלית — בקרוב</option>
                </select>
                <small>הממשק כולו מוצג כרגע בעברית. אנגלית תיפתח רק לאחר שכל המסכים יתורגמו, כדי לא ליצור ממשק מעורב.</small>
              </label>
              <label className="preference-field">
                שפת התמלול
                <select
                  name="transcript-language"
                  value={transcriptLanguage}
                  onChange={(event) => setTranscriptLanguage(event.target.value as TranscriptLanguageMode)}
                >
                  {transcriptLanguages.map((language) => (
                    <option value={language.id} key={language.id}>{language.label}</option>
                  ))}
                </select>
                <small>ברירת המחדל היא זיהוי אוטומטי. אפשר לבחור עברית במפורש.</small>
              </label>

              <TranscriptionEnginePanel />

              <div className="privacy-summary">
                <Eye size={19} />
                <div>
                  <strong>מיקום ודובר מזוהים אוטומטית בזמן התרגול</strong>
                  <p>אחרי שנלמד לזהות אתכם, האפליקציה תנסה להבין לבד מי מדבר ומי יושב בכל צד. כשלא נהיה בטוחים, לא ננחש.</p>
                </div>
              </div>

              <div className="privacy-summary">
                <ShieldCheck size={19} />
                <div>
                  <strong>{profile.recordingConsent ? "הסכמה לשמירת שיחות פעילה" : "הסכמה לשמירת שיחות טרם ניתנה"}</strong>
                  <p>ההסכמה ניתנת יחד פעם אחת לפני ההקלטה הראשונה וחלה על שיחות התרגול המקומיות עד לביטול.</p>
                  {profile.recordingConsent && (
                    <button
                      type="button"
                      className="text-button danger-text"
                      onClick={() => {
                        const { recordingConsent: _recordingConsent, ...withoutConsent } = profile;
                        setProfile(withoutConsent);
                      }}
                    >
                      ביטול ההסכמה להקלטות עתידיות
                    </button>
                  )}
                </div>
              </div>
            </div>
          </details>

          <DesktopFoundationPanel profile={profile} onProfilePhotoCaptured={savePartnerPhoto} />

          <div className="setup-actions wide">
            <div>
              <strong>{profileReady ? "הפרטים הבסיסיים מוכנים" : "נדרשים שני שמות כדי להמשיך"}</strong>
              <small>אפשר לדלג על הזיהוי עכשיו ולחזור אליו דרך „עריכת ההגדרות”.</small>
            </div>
            <button className="primary" disabled={!profileReady} onClick={() => {
              setEditingCouple(false);
              onSettingsComplete?.();
            }}>
              שמירת ההגדרה והמשך
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="stack home-space">
      <div className="home-intro">
        <div className="couple-identity home-couple">
          <span className="partner-chip"><PartnerPortrait profile={profile} partner="A" /><strong>{profile.partnerAName}</strong></span>
          <HeartHandshake size={22} aria-hidden="true" />
          <span className="partner-chip"><PartnerPortrait profile={profile} partner="B" /><strong>{profile.partnerBName}</strong></span>
        </div>
        <p>{profile.relationshipGoal}</p>
        <button className="text-button home-settings" onClick={() => setEditingCouple(true)}>עריכת ההגדרות</button>
      </div>

      <div className="home-primary-action">
        <div>
          <h2>{nextAction.title}</h2>
          <p>{nextAction.body}</p>
        </div>
        <button className="primary" onClick={() => setView(nextAction.view)}>
          <NextIcon size={19} />
          {nextAction.button}
        </button>
      </div>

      <div className="home-secondary-grid">
        <section className="home-summary-section">
          <div className="panel-heading">
            <h2>מה כבר עשינו</h2>
            <button className="text-button" onClick={() => setView("insights")}>כל השיחות</button>
          </div>
          {latestSession ? (
            <div className="latest">
              <strong>{latestSession.title}</strong>
              <p>{latestSession.analysis.summary}</p>
              {latestSession.closingReflection?.feltGood && <p className="shared-memory"><HeartHandshake size={16} /> מה הרגיש טוב: {latestSession.closingReflection.feltGood}</p>}
              <button className="text-button" onClick={() => setView("insights")}>לסיכום השיחה <ChevronRight size={16} /></button>
            </div>
          ) : (
            <div className="empty-state compact-empty">
              <p>השיחה הראשונה עוד מחכה לכם.</p>
              <span>לאחר שתשמרו תרגול, הסיכום יופיע כאן.</span>
            </div>
          )}
        </section>

        <section className="home-rhythm-section">
          <div className="panel-heading">
            <h2>הקצב שלנו</h2>
            <span>{recentMinutes} דקות השבוע</span>
          </div>
          <p>{rhythmDone > 0 ? `${rhythmDone} מתוך ${rhythmItems.length} רגעי תרגול הושלמו.` : "בלי יעדים ובלי לחץ — שיחה אחת טובה היא התחלה."}</p>
          <div className="home-rhythm-dots" aria-label={`${rhythmDone} מתוך ${rhythmItems.length} רגעי תרגול`}>
            {rhythmItems.map((item) => <span className={item.done ? "done" : ""} key={item.label} aria-hidden="true" />)}
          </div>
        </section>
      </div>

      <div className="home-links" aria-label="אפשרויות נוספות">
        <button onClick={() => setView("assess")}><ClipboardCheck size={18} /> מפת הקשר <span>{assessmentUpdated ? "הושלמה" : "להשלמה"}</span></button>
        <button onClick={() => setView("more")}><MoreHorizontal size={18} /> הגדרות, מפת קשר ובטיחות</button>
        <button className="quiet-danger-link" onClick={switchCouple}>התחלת פרופיל זוגי חדש</button>
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
  const [feedback, setFeedback] = useLocalState<Record<string, string>>(storageKeys.reportFeedback, {});
  const [coachModel, setCoachModel] = useLocalState(storageKeys.ollamaModel, "gemma3:4b");
  const [coachDraft, setCoachDraft] = useState("");
  const [coachStatus, setCoachStatus] = useState("מוכן");
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
  const visualCount = sessions.reduce(
    (sum, session) => sum + (session.visualObservations?.filter((observation) => observation.label !== "capture-quality").length ?? 0),
    0
  );
  const latestAcoustic = latest?.acousticMetrics;
  const reportNonverbal = sessions.reduce<NonverbalMetrics>(
    (acc, session) => {
      const metrics = session.nonverbalMetrics ?? computeNonverbalMetrics(session.visualObservations ?? []);
      return {
        sampleCount: acc.sampleCount + metrics.sampleCount,
        analyzedSeconds: (acc.analyzedSeconds ?? 0) + (metrics.analyzedSeconds ?? 0),
        faceCoverageSeconds: (acc.faceCoverageSeconds ?? 0) + (metrics.faceCoverageSeconds ?? 0),
        twoFaceCoverageSeconds: (acc.twoFaceCoverageSeconds ?? 0) + (metrics.twoFaceCoverageSeconds ?? 0),
        poseCoverageSeconds: (acc.poseCoverageSeconds ?? 0) + (metrics.poseCoverageSeconds ?? 0),
        lowQualitySeconds: (acc.lowQualitySeconds ?? 0) + (metrics.lowQualitySeconds ?? 0),
        headOrientationChangeSecondsA: (acc.headOrientationChangeSecondsA ?? 0) + (metrics.headOrientationChangeSecondsA ?? 0),
        headOrientationChangeSecondsB: (acc.headOrientationChangeSecondsB ?? 0) + (metrics.headOrientationChangeSecondsB ?? 0),
        bodyMovementSecondsA: (acc.bodyMovementSecondsA ?? 0) + (metrics.bodyMovementSecondsA ?? 0),
        bodyMovementSecondsB: (acc.bodyMovementSecondsB ?? 0) + (metrics.bodyMovementSecondsB ?? 0),
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
      analyzedSeconds: 0,
      faceCoverageSeconds: 0,
      twoFaceCoverageSeconds: 0,
      poseCoverageSeconds: 0,
      lowQualitySeconds: 0,
      headOrientationChangeSecondsA: 0,
      headOrientationChangeSecondsB: 0,
      bodyMovementSecondsA: 0,
      bodyMovementSecondsB: 0,
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
    "דוח התרגול של Couple Lab",
    `נוצר בתאריך: ${new Date().toLocaleString("he-IL")}`,
    `בני הזוג: ${profile.partnerAName} + ${profile.partnerBName}`,
    `מיקוד: ${profile.relationshipGoal}`,
    `מדד תרגול: ${reportScore}%`,
    `שיחות שמורות: ${sessions.length}`,
    `רמזים לתיקון: ${totalRepairs}`,
    `רמזים שכדאי לבדוק: ${totalRisks}`,
    `רגעים מסומנים: ${allTags.length}`,
    latest
      ? [
          `מדדי התרגול האחרונים: פתיחות רכות ${latest.analysis.metrics.softStartups ?? 0}`,
          `תיקוף ${latest.analysis.metrics.validationSignals ?? 0}`,
          `ניסיונות תיקון ${latest.analysis.metrics.repairSignals}`,
          ...(latest.analysis.metrics.speakerAttributionReliable === false ? [] : [`איזון תורות ${latest.analysis.metrics.turnBalance}%`])
        ].join(", ")
      : "מדדי התרגול האחרונים: עדיין אין שיחה שמורה",
    `תצפיות חזותיות: ${visualCount}`,
    ...(latestAcoustic ? [
      `דיבור שנקלט: ${formatDuration(Math.round(latestAcoustic.speechSeconds))}`,
      `הפסקות ארוכות אפשריות: ${latestAcoustic.longPauseCount}`,
      `שינויי עוצמה יחסיים: ${latestAcoustic.relativeLevelShiftCount}`,
      latestAcoustic.estimatedWordsPerMinute
        ? `קצב דיבור משוער: ${latestAcoustic.estimatedWordsPerMinute} מילים לדקה`
        : ""
    ].filter(Boolean) : []),
    `זמן מצלמה שנדגם: ${formatDuration(reportNonverbal.analyzedSeconds ?? 0)}`,
    `לפחות פנים אחת נראתה: ${formatDuration(reportNonverbal.faceCoverageSeconds ?? 0)}`,
    `שתי פנים נראו: ${formatDuration(reportNonverbal.twoFaceCoverageSeconds ?? 0)}`,
    `לפחות גוף אחד נראה: ${formatDuration(reportNonverbal.poseCoverageSeconds ?? 0)}`,
    `תנועת גוף — ${partnerName(profile, "A")}: ${formatDuration(reportNonverbal.bodyMovementSecondsA ?? 0)}`,
    `תנועת גוף — ${partnerName(profile, "B")}: ${formatDuration(reportNonverbal.bodyMovementSecondsB ?? 0)}`,
    `שינויי כיוון ראש — ${partnerName(profile, "A")}: ${formatDuration(reportNonverbal.headOrientationChangeSecondsA ?? 0)}`,
    `שינויי כיוון ראש — ${partnerName(profile, "B")}: ${formatDuration(reportNonverbal.headOrientationChangeSecondsB ?? 0)}`,
    "מדדי המצלמה והקול הם תיאוריים ומושפעים מכיסוי ומאיכות ההקלטה; הם אינם קובעים רגש או כוונה.",
    "",
    "בטיחות",
    safetyFlag ? "סומנה דאגת בטיחות. יש לפנות לתמיכה אישית או מקצועית לפני תרגול זוגי." : "לא סומנה דאגה בבדיקת הבטיחות.",
    "",
    "תחומי מיקוד מרכזיים",
    ...focusRows.map((row) => `${row.label}: ${row.score}% — ${row.practice}`),
    "",
    "חוזקות",
    ...(latest?.analysis.strengths ?? ["השלימו תרגול שיחה כדי לזהות חוזקות."]),
    "",
    "נקודות שכדאי לבדוק",
    ...(latest?.analysis.risks ?? ["השלימו תרגול שיחה כדי לזהות נקודות שכדאי לבדוק."]),
    "",
    "תרגילים",
    ...exercises,
    ...(latest?.closingReflection ? [
      "",
      "מה בחרנו יחד",
      latest.closingReflection.feltGood ? `מה הרגיש טוב: ${latest.closingReflection.feltGood}` : "",
      latest.closingReflection.remember ? `מה חשוב לזכור: ${latest.closingReflection.remember}` : "",
      `הצעד הבא: ${latest.closingReflection.nextStep}`,
      latest.followUp ? `איך הלך: ${followUpOutcomeLabel(latest.followUp.outcome)}` : "עדיין לא בדקנו איך הלך"
    ].filter(Boolean) : []),
    "",
    "עמדת דיוק וזהירות",
    ...evidenceNotes
  ].join("\n");

  const runLocalCoach = async () => {
    setCoachStatus("מכינים הצעה אישית…");
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
            "אתה מדריך חם ולא־קליני לתקשורת זוגית. כתוב בעברית בלבד.",
            "אין לאבחן, לנבא פרידה, להאשים או לטעון לוודאות.",
            "על בסיס הדוח שלמטה, כתוב שלוש חוזקות קצרות, שלוש עדיפויות לתרגול ותרגיל אחד בן עשר דקות.",
            "שמור על ניסוח עדין, מסוים ומעשי.",
            "",
            reportText
          ].join("\n")
        })
      });
      if (!response.ok) {
        throw new Error("local-coach-unavailable");
      }
      const data = (await response.json()) as { response?: string };
      setCoachDraft(data.response?.trim() || "לא התקבלה הצעה. אפשר לנסות שוב.");
      setCoachStatus("ההכוונה המקומית מוכנה");
    } catch (error) {
      setCoachStatus(
        error instanceof DOMException && error.name === "AbortError"
          ? "הכנת ההצעה ארכה יותר מדי. אפשר לנסות שוב."
          : "ההצעה האישית אינה זמינה כרגע. ודאו שהשירות המקומי פועל ונסו שוב."
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  return (
    <section className="stack report-print">
      <div className="report-hero panel">
        <div>
          <h2>
            {profile.partnerAName} + {profile.partnerBName}
          </h2>
          <p>דוח הדרכה לאחר השיחה</p>
          <p>{profile.relationshipGoal}</p>
        </div>
        <div className="report-score">
          <span>מדד תרגול</span>
          <strong>{reportScore}%</strong>
        </div>
      </div>

      <div className="tile-grid four">
        <div className="metric-tile static">
          <FileText size={20} />
          <span>שיחות</span>
          <strong>{sessions.length}</strong>
        </div>
        <div className="metric-tile static">
          <HeartHandshake size={20} />
          <span>תיקונים</span>
          <strong>{totalRepairs}</strong>
        </div>
        <div className="metric-tile static">
          <Activity size={20} />
          <span>נקודות לבדיקה</span>
          <strong>{totalRisks}</strong>
        </div>
        <div className="metric-tile static">
          <Camera size={20} />
          <span>תצפיות חזותיות</span>
          <strong>{visualCount}</strong>
        </div>
      </div>

      <div className="two-col">
        <div className={`panel safety-review ${safetyFlag ? "alert" : ""}`}>
          <ShieldCheck size={22} />
          <div>
            <strong>{safetyFlag ? "נדרשת בדיקת בטיחות" : "בדיקת הבטיחות תקינה"}</strong>
            <p>
              {safetyFlag
                ? "אין לבצע תרגילי מחלוקת כאשר יש פחד, כפייה, איומים או משבר פעיל."
                : "אפשר להמשיך במצב תרגול. האפליקציה עדיין אינה תחליף לטיפול."}
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>פעולות בדוח</h2>
            <Download size={18} />
          </div>
          <div className="export-actions">
            <button className="primary" onClick={() => window.print()}>
              <FileDown size={17} />
              הדפסה או שמירה כ־PDF
            </button>
            <button className="secondary" onClick={() => downloadBlob("couplelab-report.txt", reportText, "text/plain")}>
              <Download size={17} />
              הורדת קובץ טקסט
            </button>
          </div>
        </div>
      </div>

      <div className="panel local-coach">
        <div className="panel-heading">
          <h2>רעיון אישי להמשך</h2>
          <Sparkles size={18} />
        </div>
        <p className="muted">נשתמש בסיכום השיחות כדי להציע צעד קטן שאפשר לנסות יחד.</p>
        <div className="coach-controls">
          <button className="primary" onClick={runLocalCoach}>
            <Sparkles size={17} />
            הציעו לנו צעד הבא
          </button>
          <span className="muted">{coachStatus}</span>
        </div>
        <details className="desktop-advanced">
          <summary>אפשרויות מתקדמות</summary>
          <label>
            מנוע ההדרכה המקומי
            <select name="coach-model" value={coachModel} onChange={(event) => setCoachModel(event.target.value)}>
              {OLLAMA_MODEL_OPTIONS.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </label>
        </details>
        {coachDraft && <div className="coach-draft">{coachDraft}</div>}
      </div>

      <div className="two-col">
        <InsightList title="תחומי מיקוד מרכזיים" items={focusRows.map((row) => `${row.label}: ${row.practice}`)} />
        <InsightList title="תרגילים מומלצים" items={exercises.length ? exercises : ["השלימו תרגול שיחה אחד."]} />
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>מה היה זמין למערכת</h2>
          <Eye size={18} />
        </div>
        <div className="nonverbal-grid">
          <MiniMetric label="זמן שנדגם" value={reportNonverbal.analyzedSeconds ?? 0} raw />
          <MiniMetric label="לפחות פנים אחת נראתה" value={reportNonverbal.faceCoverageSeconds ?? 0} raw />
          <MiniMetric label="שתי פנים נראו" value={reportNonverbal.twoFaceCoverageSeconds ?? reportNonverbal.sharedFrameSeconds} raw />
          <MiniMetric label="לפחות גוף אחד נראה" value={reportNonverbal.poseCoverageSeconds ?? 0} raw />
          <MiniMetric label={`תנועת גוף — ${partnerName(profile, "A")}`} value={reportNonverbal.bodyMovementSecondsA ?? 0} raw />
          <MiniMetric label={`תנועת גוף — ${partnerName(profile, "B")}`} value={reportNonverbal.bodyMovementSecondsB ?? 0} raw />
          <MiniMetric label={`שינוי כיוון ראש — ${partnerName(profile, "A")}`} value={reportNonverbal.headOrientationChangeSecondsA ?? 0} raw />
          <MiniMetric label={`שינוי כיוון ראש — ${partnerName(profile, "B")}`} value={reportNonverbal.headOrientationChangeSecondsB ?? 0} raw />
        </div>
        <p className="muted">
          אלה מדדי כיסוי ותנועה גאומטריים מהמצלמה. הם מתארים מה היה זמין למדידה ואינם קובעים רגש, כוונה או איכות קשר.
        </p>
      </div>

      {latestAcoustic && <div className="panel">
        <div className="panel-heading">
          <h2>קצב והפסקות בקול</h2>
          <Mic size={18} />
        </div>
        <div className="nonverbal-grid">
          <MiniMetric label="דיבור שנקלט" value={Math.round(latestAcoustic.speechSeconds)} raw />
          <MiniMetric label="שקט בין קטעי דיבור" value={Math.round(latestAcoustic.silenceSeconds)} raw />
          <MiniMetric label="הפסקות ארוכות" value={latestAcoustic.longPauseCount} raw />
          <MiniMetric label="ההפסקה הארוכה ביותר" value={Math.round(latestAcoustic.longestPauseSeconds)} raw />
          <MiniMetric label="שינויי עוצמה יחסיים" value={latestAcoustic.relativeLevelShiftCount} raw />
          {latestAcoustic.estimatedWordsPerMinute && <MiniMetric label="קצב משוער — מילים בדקה" value={latestAcoustic.estimatedWordsPerMinute} raw />}
        </div>
        <p className="muted">
          אלה מדדים מקומיים של דיבור, שקט ועוצמה יחסית. הם אינם מזהים כעס, מתח או מצב רגשי, ויכולים להיות מושפעים מהמיקרופון ומהמרחק ממנו.
        </p>
      </div>}

      <div className="panel">
        <div className="panel-heading">
          <h2>דפוסי תקשורת</h2>
          <Activity size={18} />
        </div>
        <div className="tag-cloud">
          {topPatterns.length === 0 && <span>עדיין לא זוהו דפוסים</span>}
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
            <h2>השיחה האחרונה</h2>
            <span className="score-chip">{latest.analysis.metrics.connectionPracticeScore}%</span>
          </div>
          <p>{latest.analysis.summary}</p>
          <div className="two-col">
            <InsightList title="חוזקות" items={latest.analysis.strengths} />
            <InsightList title="נקודות שכדאי לבדוק" items={latest.analysis.risks} />
          </div>
          <div className="hit-list report-hits">
            {latest.analysis.hits.slice(0, 8).map((hit) => (
              <article key={hit.id} className={`hit ${hit.family}`}>
                <span>
                  {hit.label}
                </span>
                <p>{hit.evidence}</p>
                <small>{hit.suggestion}</small>
              </article>
            ))}
          </div>
          <TaggedTimeline profile={profile} tags={(latest.analysis.tags ?? []).slice(0, 12)} title="רגעים מסומנים" />
          <div className="accuracy-box">
            <strong>האם הסיכום הרגיש מדויק?</strong>
            <div className="export-actions">
              {["מדויק", "מדויק חלקית", "דורש תיקון"].map((choice) => (
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
          <FileText size={44} />
          <h2>עדיין אין נתונים לדוח</h2>
          <p>השלימו ושמרו תרגול שיחה אחד כדי ליצור דוח הדרכה.</p>
        </div>
      )}
    </section>
  );
}

function AssessView({
  profile,
  assessment,
  setAssessment,
  onContinue
}: {
  profile: CoupleProfile;
  assessment: AssessmentState;
  setAssessment: (assessment: AssessmentState) => void;
  onContinue: () => void;
}) {
  const [partner, setPartner] = useState<PartnerId>("A");
  const [accessGranted, setAccessGranted] = useState(false);
  const answeredCount = domains.filter((domain) => Number.isFinite(assessment[partner][domain.key])).length;
  const currentComplete = partnerAssessmentComplete(assessment, partner);
  const bothComplete = assessmentComplete(assessment);
  const focusDomains = useMemo(() => {
    if (!assessmentComplete(assessment)) return [];
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
      completedBy: {
        ...assessment.completedBy,
        [partner]: undefined
      },
      updatedAt: undefined,
      schemaVersion: 2
    });
  };

  const completePartner = () => {
    if (answeredCount !== domains.length) return;
    const completedAt = new Date().toISOString();
    const nextAssessment: AssessmentState = {
      ...assessment,
      completedBy: {
        ...assessment.completedBy,
        [partner]: completedAt
      },
      schemaVersion: 2
    };
    const willBeComplete = partnerAssessmentComplete(nextAssessment, "A") && partnerAssessmentComplete(nextAssessment, "B");
    setAssessment({ ...nextAssessment, updatedAt: willBeComplete ? completedAt : undefined });
    if (!willBeComplete) {
      setPartner(otherPartner(partner));
      setAccessGranted(false);
    }
  };

  return (
    <section className="stack">
      <div className="assessment-intro panel">
        <div>
          <h2>נתחיל במפת הקשר</h2>
          <p>שלב 1 מתוך 2 · כל אחד מכם עונה בנפרד לפי התחושה שלו עכשיו. אין תשובה נכונה, וההשוואה תופיע רק לאחר ששניכם תסיימו.</p>
        </div>
        <div className="privacy-note"><Lock size={18} /> התשובות נשמרות במכשיר הזה.</div>
      </div>

      <div className="segmented" aria-label="בחירת ממלא/ת ההערכה">
        {(["A", "B"] as PartnerId[]).map((id) => (
          <button className={partner === id ? "active" : ""} key={id} onClick={() => {
            setPartner(id);
            setAccessGranted(false);
          }}>
            <span>{partnerName(profile, id)}</span>
            {partnerAssessmentComplete(assessment, id) && <Check size={15} aria-label="הושלם" />}
          </button>
        ))}
      </div>

      {!accessGranted ? (
        <PrivateHandoff name={partnerName(profile, partner)} onReady={() => setAccessGranted(true)} />
      ) : <div className="assessment-grid">
        <div className="panel assessment-panel">
          <div className="assessment-progress" aria-live="polite">
            <strong>{partnerName(profile, partner)}</strong>
            <span>{answeredCount} מתוך {domains.length} תשובות</span>
            <div><i style={{ width: `${(answeredCount / domains.length) * 100}%` }} /></div>
          </div>
          <p className="scale-help"><span>1 — כמעט לא מרגיש/ה כך עכשיו</span><span>10 — מרגיש/ה כך מאוד עכשיו</span></p>
          {domains.map((domain, index) => (
            <fieldset className="assessment-question" key={domain.key}>
              <legend>
                <small>שאלה {index + 1}</small>
                <strong>{domain.label}</strong>
                <span>{domain.description}</span>
              </legend>
              <RatingScale
                label={domain.label}
                selected={assessment[partner][domain.key]}
                onSelect={(value) => updateScore(domain.key, value)}
              />
            </fieldset>
          ))}
          <button className="primary assessment-submit" onClick={completePartner} disabled={answeredCount !== domains.length || currentComplete}>
            <Check size={18} />
            {currentComplete ? `התשובות של ${partnerName(profile, partner)} נשמרו` : `שמירת התשובות של ${partnerName(profile, partner)}`}
          </button>
        </div>

        <aside className="panel">
          <div className="panel-heading">
            <h2>{bothComplete ? "נושאים אפשריים לתרגול" : "השלמת המפה"}</h2>
            <ClipboardCheck size={18} />
          </div>
          {bothComplete ? (
            <>
              <p>זו נקודת פתיחה לשיחה, לא אבחון של הקשר.</p>
              <div className="focus-list">
                {focusDomains.map((domain) => (
                  <article key={domain.key}>
                    <strong>{domain.label}</strong>
                    <p>{domain.practice}</p>
                  </article>
                ))}
              </div>
              <button className="primary full" onClick={onContinue}>לבחירת תרגול</button>
            </>
          ) : (
            <div className="empty-state">
              <p>לא נציג ממוצעים או השוואה עד ששני בני הזוג ישלימו את כל השאלות.</p>
            </div>
          )}
        </aside>
      </div>}
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
            <small>{deckStats[deck.id] ?? 0} תרגולים</small>
          </button>
        ))}
      </div>

      <div className="prompt-stage">
        <div className="prompt-meta">
          <span>נושא לתרגול</span>
          <strong>{activeDeck.title}</strong>
          <p>{activeDeck.purpose}</p>
        </div>
        <blockquote dir="auto">{activeDeck.cards[cardIndex]}</blockquote>
        <div className="prompt-actions">
          <button className="secondary" onClick={() => draw()}>
            <RefreshCw size={17} />
            שאלה אחרת
          </button>
          <button
            className="primary"
            onClick={() => setDeckStats({ ...deckStats, [activeDeck.id]: (deckStats[activeDeck.id] ?? 0) + 1 })}
          >
            <Check size={17} />
            תרגלנו
          </button>
        </div>
        <div className="closing-line">
          <HeartHandshake size={18} />
          <span>
            מסיימים בדבר אחד ששמעתי, דבר אחד שהערכתי וצעד קטן אחד שאוכל לעשות עבור{" "}
            {profile.partnerAName && profile.partnerBName ? `${profile.partnerAName} ו${profile.partnerBName}` : "שנינו"}.
          </span>
        </div>
      </div>
    </section>
  );
}

function PracticeStudio({
  profile,
  setProfile,
  assessment,
  signals,
  sessions,
  setSessions,
  safetyFlag,
  deckStats,
  setDeckStats,
  questionHistory,
  setQuestionHistory,
  transcriptLanguage,
  setTranscriptLanguage,
  practiceLaunch,
  onViewResults
}: {
  profile: CoupleProfile;
  setProfile: (profile: CoupleProfile) => void;
  assessment: AssessmentState;
  signals: BodySignals;
  sessions: SessionRecord[];
  setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>>;
  safetyFlag: boolean;
  deckStats: Record<string, number>;
  setDeckStats: (stats: Record<string, number>) => void;
  questionHistory: QuestionHistory;
  setQuestionHistory: React.Dispatch<React.SetStateAction<QuestionHistory>>;
  transcriptLanguage: TranscriptLanguageMode;
  setTranscriptLanguage: React.Dispatch<React.SetStateAction<TranscriptLanguageMode>>;
  practiceLaunch: PracticeLaunch | null;
  onViewResults: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const videoBlobRef = useRef<Blob | null>(null);
  const savingRef = useRef(false);
  const stopRecordingRef = useRef<() => void>(() => undefined);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechRetryRef = useRef(0);
  const speechTerminalErrorRef = useRef(false);
  const speechRetryTimerRef = useRef<number | null>(null);
  const speechStopResolverRef = useRef<(() => void) | null>(null);
  const interimTranscriptRef = useRef("");
  const recordingRef = useRef(false);
  const elapsedRef = useRef(0);
  const videoUrlRef = useRef<string | null>(null);
  const lastAnalyzedVideoTimeRef = useRef(-1);
  const visualSampleIndexRef = useRef(0);
  const previousPoseRef = useRef<Partial<Record<PartnerId, VisualPoint[]>>>({});
  const previousHeadOrientationRef = useRef<Partial<Record<PartnerId, number>>>({});
  const activeSpeakerRef = useRef<PartnerId>("A");
  const autoSpeechLanguageRef = useRef<SpeechLanguage>("he-IL");
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const visualLoadPromiseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const cameraAutostartAttemptedRef = useRef(false);
  const enrollmentRef = useRef<BiometricEnrollmentState | null>(null);
  const speakerAudioContextRef = useRef<AudioContext | null>(null);
  const speakerProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const speakerSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const speakerSilentGainRef = useRef<GainNode | null>(null);
  const speakerChunksRef = useRef<Float32Array[]>([]);
  const speakerSamplesRef = useRef(0);
  const speakerMatchBusyRef = useRef(false);
  const transcriptionChunksRef = useRef<Float32Array[]>([]);
  const transcriptionSampleRateRef = useRef(16000);
  const localTranscriptionReadyRef = useRef(false);
  const localTranscriptionMetadataRef = useRef<StoredTranscriptionMetadata | undefined>(undefined);
  const acousticMetricsRef = useRef<AcousticMetrics | undefined>(undefined);
  const manualCorrectionRef = useRef<HTMLDetailsElement | null>(null);
  const transcriptPanelRef = useRef<HTMLDivElement | null>(null);
  const identityCameraWasReadyRef = useRef(false);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const cuesRef = useRef<LiveCue[]>([]);
  const observationsRef = useRef<VisualObservation[]>([]);
  const visualMetricObservationsRef = useRef<VisualObservation[]>([]);
  const vocalObservationsRef = useRef<VocalObservation[]>([]);
  const vocalAnalyserRef = useRef<VocalAnalyser | null>(null);
  const manualTextRef = useRef("");
  const [cameraReady, setCameraReady] = useState(false);
  const [lightingHint, setLightingHint] = useState("");
  // Read inside long-lived sampling closures so a profile update (e.g. an
  // automatic calibration write) does not tear down and restart the visual
  // sampling loop mid-recording.
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  const [recording, setRecording] = useState(false);
  const [phase, setPhase] = useState<PracticePhase>("setup");
  const [phaseError, setPhaseError] = useState("");
  const [lastCompletedSession, setLastCompletedSession] = useState<SessionRecord | null>(null);
  const [recordingConsent, setRecordingConsent] = useState(() => Boolean(profile.recordingConsent));
  const [elapsed, setElapsed] = useState(0);
  const [sessionType, setSessionType] = useState<SessionType>(() => sessionTypeForDeck(practiceLaunch?.deckId ?? decks[0].id));
  const [activeSpeaker, setActiveSpeaker] = useState<PartnerId>("A");
  const [completedAnswerers, setCompletedAnswerers] = useState<PartnerId[]>([]);
  const [turnMessage, setTurnMessage] = useState("");
  const [breakPlan, setBreakPlan] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [autoSpeechLanguage, setAutoSpeechLanguage] = useState<SpeechLanguage>(() => chooseInitialSpeechLanguage(profile, []));
  const [activeDeck, setActiveDeck] = useState<Deck>(() => decks.find((deck) => deck.id === practiceLaunch?.deckId) ?? decks[0]);
  const [cardIndex, setCardIndex] = useState(() => {
    const deck = decks.find((item) => item.id === practiceLaunch?.deckId) ?? decks[0];
    const requestedIndex = practiceLaunch?.cardIndex;
    return typeof requestedIndex === "number" && requestedIndex >= 0 && requestedIndex < deck.cards.length
      ? requestedIndex
      : nextQuestionIndex(deck.cards.length, questionHistory[deck.id] ?? []);
  });
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [cues, setCues] = useState<LiveCue[]>([]);
  const [visualObservations, setVisualObservations] = useState<VisualObservation[]>([]);
  const [vocalObservations, setVocalObservations] = useState<VocalObservation[]>([]);
  const [liveVocalTone, setLiveVocalTone] = useState<VocalObservation | null>(null);
  const [manualText, setManualText] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [speechStatus, setSpeechStatus] = useState("מוכן לבדיקה");
  const [transcriptionStatusKind, setTranscriptionStatusKind] = useState<TranscriptionStatusKind>("idle");
  const [visualStatus, setVisualStatus] = useState("לא הופעל");
  const [vocalStatus, setVocalStatus] = useState("יופעל עם ההקלטה");
  const [identityStatus, setIdentityStatus] = useState("ממתינים למצלמה");
  const [speakerStatus, setSpeakerStatus] = useState("הדובר יזוהה אוטומטית");
  const [incompleteIdentity, setIncompleteIdentity] = useState<PartnerId[]>(["A", "B"]);
  const [identitySetupOpen, setIdentitySetupOpen] = useState(false);
  const [identitySetupBusy, setIdentitySetupBusy] = useState(false);
  const [identitySetupError, setIdentitySetupError] = useState("");
  const [closingFeltGood, setClosingFeltGood] = useState("");
  const [closingRemember, setClosingRemember] = useState("");
  const [closingNextStep, setClosingNextStep] = useState("");
  const [closingSaved, setClosingSaved] = useState(false);
  const mobileRealtime = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 680px), (pointer: coarse)").matches,
    []
  );
  const visualSampleMs = mobileRealtime ? 2000 : 1200;
  const pendingFollowUp = sessions.find((session) => session.closingReflection?.nextStep && !session.followUp);
  const calibrationText = profile.visualCalibration
    ? `${partnerName(profile, "A")} = ${slotName(profile.visualCalibration.A)}, ${partnerName(profile, "B")} = ${slotName(
        profile.visualCalibration.B
      )}`
    : "המיקום יזוהה אוטומטית בתחילת השיחה";

  function applyAutomaticSpeaker(partner: PartnerId, source: "voice" | "face") {
    if (activeSpeakerRef.current === partner && recordingRef.current) return;
    activeSpeakerRef.current = partner;
    setActiveSpeaker(partner);
    setSpeakerStatus(`${partnerName(profile, partner)} זוהה/תה אוטומטית`);
    if (recordingRef.current) {
      setTurnMessage(`${partnerName(profile, partner)} מדבר/ת עכשיו — הזיהוי אוטומטי.`);
    }
  }

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    setRecordingConsent(Boolean(profile.recordingConsent));
  }, [profile.recordingConsent]);

  const refreshBiometricEnrollment = useCallback(async () => {
    const bridge = window.coupleLabDesktop;
    if (!bridge) {
      setIncompleteIdentity(["A", "B"]);
      setIdentityStatus("הזיהוי זמין באפליקציה שבמחשב");
      return;
    }
    try {
      const enrollment = await bridge.loadBiometricEnrollment();
      enrollmentRef.current = enrollment;
      const incomplete = incompleteBiometricPartners(enrollment);
      setIncompleteIdentity(incomplete);
      setIdentityStatus(
        incomplete.length === 0
          ? "הזיהוי האוטומטי מוכן"
          : incomplete.length === 1
            ? `עוד לא למדנו לזהות את ${partnerName(profile, incomplete[0])}`
            : "עוד לא למדנו לזהות את שניכם"
      );
    } catch {
      setIdentityStatus("הזיהוי האוטומטי אינו זמין כרגע");
    }
  }, [profile.partnerAName, profile.partnerBName]);

  useEffect(() => {
    void refreshBiometricEnrollment();
  }, [refreshBiometricEnrollment]);

  useEffect(() => {
    const bridge = window.coupleLabDesktop;
    if (!bridge) {
      setSpeechStatus("התמלול יתחיל אוטומטית עם ההקלטה");
      return;
    }
    setSpeechStatus("מכינים תמלול מקומי");
    void bridge.getTranscriptionModelStatus()
      .then((status) => {
        localTranscriptionReadyRef.current = status.ready;
        setTranscriptionStatusKind(status.ready ? "ready" : "error");
        setSpeechStatus(status.ready ? "התמלול יוכן במכשיר אחרי סיום השיחה" : "התמלול המקומי אינו זמין; אפשר להשלים טקסט ידנית");
        void logDiagnostic({
          name: status.ready ? "transcription.local_ready" : "transcription.local_unavailable",
          status: status.ready ? "success" : "error",
          errorCode: status.error
        });
      })
      .catch((error) => {
        localTranscriptionReadyRef.current = false;
        setTranscriptionStatusKind("error");
        setSpeechStatus("התמלול המקומי אינו זמין; אפשר להשלים טקסט ידנית");
        void logDiagnostic({
          name: "transcription.local_unavailable",
          status: "error",
          errorCode: error instanceof Error ? error.message : "model-status-failed"
        });
      });
  }, []);

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
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    cuesRef.current = cues;
  }, [cues]);

  useEffect(() => {
    observationsRef.current = visualObservations;
  }, [visualObservations]);

  useEffect(() => {
    manualTextRef.current = manualText;
  }, [manualText]);

  useEffect(() => {
    setQuestionHistory((current) => ({
      ...current,
      [activeDeck.id]: rememberQuestion(current[activeDeck.id] ?? [], cardIndex, activeDeck.cards.length)
    }));
  }, [activeDeck.id, activeDeck.cards.length, cardIndex, setQuestionHistory]);

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
          if (next >= 15 * 60) {
            stopRecordingRef.current();
            setSpeechStatus("ההקלטה הסתיימה במגבלת 15 הדקות");
          }
          return next;
        }),
      1000
    );
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      recordingRef.current = false;
      recognitionRef.current?.stop();
      if (speechRetryTimerRef.current) window.clearTimeout(speechRetryTimerRef.current);
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      faceLandmarkerRef.current?.close();
      poseLandmarkerRef.current?.close();
      speakerProcessorRef.current?.disconnect();
      speakerSourceRef.current?.disconnect();
      speakerSilentGainRef.current?.disconnect();
      void speakerAudioContextRef.current?.close();
      vocalAnalyserRef.current?.stop();
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    };
  }, []);

  const draw = (deck = activeDeck) => {
    const history = rememberQuestion(questionHistory[deck.id] ?? [], cardIndex, deck.cards.length);
    setCardIndex(nextQuestionIndex(deck.cards.length, history));
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
      speakerAttribution: source === "manual" ? "manual" : "automatic",
      detectedLanguage,
      wordCount: spokenWordCount(clean)
    };
  };

  const appendSegment = (text: string, source: TranscriptSegment["source"]) => {
    const clean = text.trim();
    if (!clean) return;
    const segment = buildSegment(clean, source);
    setSegments((current) => {
      const next = [...current, segment];
      segmentsRef.current = next;
      return next;
    });
  };

  const loadVisualModels = () => {
    if (faceLandmarkerRef.current && poseLandmarkerRef.current) return Promise.resolve();
    if (visualLoadPromiseRef.current) return visualLoadPromiseRef.current;

    const loadPromise = (async () => {
      setVisualStatus("טוענים את מודלי הפנים והגוף");
      const assets = getVisionAssetUrls();
      const vision = await FilesetResolver.forVisionTasks(assets.wasmRoot);

    const createFace = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          delegate,
          modelAssetPath: assets.faceModel
        },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true
      });

    const createPose = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          delegate,
          modelAssetPath: assets.poseModel
        },
        runningMode: "VIDEO",
        numPoses: 2
      });

      let face: FaceLandmarker | null = null;
      let pose: PoseLandmarker | null = null;
      try {
        face = await createFace("GPU");
        pose = await createPose("GPU");
      } catch {
        face?.close();
        pose?.close();
        face = await createFace("CPU");
        pose = await createPose("CPU");
      }

      if (!mountedRef.current) {
        face.close();
        pose.close();
        return;
      }
      faceLandmarkerRef.current = face;
      poseLandmarkerRef.current = pose;
      setVisualStatus(`הניתוח החזותי פעיל · מצב ${mobileRealtime ? "טלפון" : "מחשב"}`);
    })().finally(() => {
      visualLoadPromiseRef.current = null;
    });

    visualLoadPromiseRef.current = loadPromise;
    return loadPromise;
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

  const collectVisualObservations = () => {
    const video = videoRef.current;
    const shouldStoreObservations = recordingRef.current;
    if (document.visibilityState !== "visible") return;
    if (!video || video.readyState < 2 || !faceLandmarkerRef.current || !poseLandmarkerRef.current) return;
    if (video.currentTime === lastAnalyzedVideoTimeRef.current) return;
    lastAnalyzedVideoTimeRef.current = video.currentTime;

    const timestamp = Date.now();
    const sampleSeconds = elapsedRef.current;
    const observations: VisualObservation[] = [];
    const faceResults = faceLandmarkerRef.current.detectForVideo(video, timestamp);
    const shouldAnalyzePose = !mobileRealtime || visualSampleIndexRef.current % 2 === 0;
    visualSampleIndexRef.current += 1;
    const poseResults = shouldAnalyzePose
      ? poseLandmarkerRef.current.detectForVideo(video, timestamp)
      : { landmarks: [] };
    const faceCount = faceResults.faceLandmarks?.length ?? 0;
    const poses = poseResults.landmarks ?? [];
    const automaticSubjects = new Map<"left" | "right", PartnerId>();
    const enrollment = enrollmentRef.current;

    if (enrollment?.partners.A?.faceTemplates.length && enrollment.partners.B?.faceTemplates.length) {
      (faceResults.faceLandmarks ?? []).forEach((landmarks) => {
        try {
          const match = matchPartnerVector(
            createFaceDescriptor(landmarks),
            enrollment.partners.A,
            enrollment.partners.B,
            "faceTemplates"
          );
          if (match.partnerId) automaticSubjects.set(faceSlot(landmarks), match.partnerId);
        } catch {
          // A small, partial or blurred face remains unknown; it is never forced to a name.
        }
      });
    }

    const leftIdentity = automaticSubjects.get("left");
    const rightIdentity = automaticSubjects.get("right");
    const currentProfile = profileRef.current;
    if (leftIdentity && rightIdentity && leftIdentity !== rightIdentity) {
      const aSlot = leftIdentity === "A" ? "left" : "right";
      if (currentProfile.visualCalibration?.A !== aSlot || currentProfile.visualCalibration.note !== "Automatic face-vector match") {
        setProfile({
          ...currentProfile,
          visualCalibration: {
            A: aSlot,
            B: aSlot === "left" ? "right" : "left",
            calibratedAt: new Date().toISOString(),
            note: "Automatic face-vector match"
          }
        });
      }
      setIdentityStatus(`${partnerName(currentProfile, leftIdentity)} משמאל · ${partnerName(currentProfile, rightIdentity)} מימין`);
    } else if (faceCount >= 2 && enrollment) {
      setIdentityStatus("הפנים לא זוהו בוודאות — לא משייכים שמות");
    }

    if (faceCount > 0) {
      const calibratedNote = currentProfile.visualCalibration ? `; ${calibrationText}` : "";
      observations.push({
        id: nowId("visual"),
        seconds: sampleSeconds,
        label: "face-visible",
        score: Math.min(0.9, 0.45 + faceCount * 0.2),
        evidence: `${faceCount} face${faceCount > 1 ? "s" : ""} visible${calibratedNote}`
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

    observations.push(qualityObservation(sampleSeconds, visualSampleMs, faceCount, poses.length));

    const speakingCandidates: Array<{ partner: PartnerId; score: number }> = [];
    const blendshapeSets = faceResults.faceBlendshapes ?? [];
    blendshapeSets.forEach((blendshapeSet, faceIndex) => {
      const categories = blendshapeSet.categories ?? [];
      const landmarks = faceResults.faceLandmarks?.[faceIndex] ?? [];
      const slot = faceSlot(landmarks);
      const subject = automaticSubjects.get(slot) ?? subjectForSlot(slot);
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
      const jawOpen = readBlendshape(categories, "jawOpen");
      const mouthFunnel = readBlendshape(categories, "mouthFunnel");
      speakingCandidates.push({ partner: subject, score: jawOpen + mouthFunnel * 0.35 });

      const headOrientation = headOrientationProxy(landmarks);
      observations.push(
        ...headOrientationObservations(
          sampleSeconds,
          subject,
          headOrientation,
          previousHeadOrientationRef.current[subject]
        )
      );
      if (headOrientation !== null) previousHeadOrientationRef.current[subject] = headOrientation;

      if (smile > 0.28) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "smile-configuration",
          subject,
          score: smile,
          evidence: "Smile-related face blendshape coefficients rose"
        });
      }
      if (brow > 0.24) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "brow-movement",
          subject,
          score: brow,
          evidence: "Brow-related blendshape coefficients rose"
        });
      }
      if (mouthTension > 0.2) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "mouth-press",
          subject,
          score: mouthTension,
          evidence: "Mouth press/frown blendshape coefficients rose"
        });
      }
      if (eyeAway > 0.35) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "eyes-turned-sideways",
          subject,
          score: eyeAway,
          evidence: "Side-looking eye blendshape coefficients rose"
        });
      }
    });

    const orderedSpeakers = speakingCandidates.sort((first, second) => second.score - first.score);
    if (
      orderedSpeakers[0]?.score > 0.16 &&
      orderedSpeakers[0].partner !== orderedSpeakers[1]?.partner &&
      orderedSpeakers[0].score - (orderedSpeakers[1]?.score ?? 0) > 0.07
    ) {
      applyAutomaticSpeaker(orderedSpeakers[0].partner, "face");
    }

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
      const subject = subjectForSlot(shoulderCenter < 0.5 ? "left" : "right");
      const motion = normalizedPoseMotion(previousPoseRef.current[subject], pose);
      const motionCue = motion === null ? null : movementObservation(sampleSeconds, subject, motion);
      if (motionCue) observations.push(motionCue);
      previousPoseRef.current[subject] = pose;

      if (shoulderCenter < 0.28 || shoulderCenter > 0.72) {
        observations.push({
          id: nowId("visual"),
          seconds: sampleSeconds,
          label: "body-near-frame-edge",
          subject,
          score: Math.abs(shoulderCenter - 0.5),
          evidence: "The shoulder center was near an edge of the camera frame"
        });
      }
      if (leftWrist && rightWrist) {
        const wristsNearChest =
          Math.abs(leftWrist.x - rightShoulder.x) < 0.14 && Math.abs(rightWrist.x - leftShoulder.x) < 0.14;
        if (wristsNearChest) {
          observations.push({
            id: nowId("visual"),
            seconds: sampleSeconds,
            label: "wrists-near-opposite-shoulders",
            subject,
            score: 0.58,
            evidence: "Both wrists were near the opposite shoulder landmarks"
          });
        }
      }
    });

    if (shouldStoreObservations && observations.length > 0) {
      const enriched = observations.map((observation) => ({
        provider: "mediapipe" as const,
        ...observation,
        metadata: {
          ...(observation.metadata ?? {}),
          sampleSeconds,
          sampleIntervalMs: visualSampleMs,
          model: observation.provider ?? "mediapipe"
        }
      }));
      visualMetricObservationsRef.current.push(...enriched);
      setVisualObservations((current) => [...current.slice(-260), ...enriched]);
    } else if (!shouldStoreObservations) {
      setVisualStatus("המצלמה מוכנה; זיהוי המיקום פעיל");
    }
  };

  const calibrateVisualIdentity = (aSlot: "left" | "right") => {
    const nextCalibration = {
      A: aSlot,
      B: aSlot === "left" ? ("right" as const) : ("left" as const),
      calibratedAt: new Date().toISOString(),
      note: "תיקון ידני של מיקום הישיבה"
    };
    setProfile({ ...profile, visualCalibration: nextCalibration });
    setVisualStatus(`המיקום תוקן: ${partnerName(profile, "A")} ${aSlot === "left" ? "משמאל" : "מימין"}`);
  };

  const startCamera = async () => {
    setPhase("requesting-permission");
    void logDiagnostic({ name: "permission.requested", status: "info", phase: "camera-and-microphone" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          // Two seated people share one frame: at 640x480 each face is only
          // ~150px wide, below what the landmark models need for stable
          // geometry. 720p roughly doubles face size; analysis stays cheap
          // because frames are sampled every 1.2-2s, not per frame.
          width: { ideal: mobileRealtime ? 960 : 1280, max: 1920 },
          height: { ideal: mobileRealtime ? 540 : 720, max: 1080 },
          frameRate: { ideal: mobileRealtime ? 20 : 24, max: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (streamRef.current === stream) {
            streamRef.current = null;
            setCameraReady(false);
            if (recordingRef.current) {
              recordingRef.current = false;
              setRecording(false);
              setPhase("error");
              setPhaseError("המצלמה או המיקרופון הופסקו לפני שההקלטה נשמרה.");
              setSpeechStatus("המצלמה או המיקרופון הופסקו");
              void logDiagnostic({ name: "recording.failed", status: "error", errorCode: "media-track-ended" });
            }
          }
        };
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraReady(true);
      setPhase("setup");
      setSpeechStatus("המצלמה והמיקרופון מוכנים");
      void logDiagnostic({ name: "permission.result", status: "success", phase: "granted" });
    } catch {
      setPhase("error");
      setPhaseError("לא ניתנה גישה למצלמה ולמיקרופון. אפשר לנסות שוב או להמשיך עם הערה ידנית.");
      setSpeechStatus("נדרשת הרשאת מצלמה ומיקרופון");
      void logDiagnostic({ name: "permission.result", status: "error", errorCode: "permission-denied" });
    }
  };

  useEffect(() => {
    if (cameraAutostartAttemptedRef.current || safetyFlag) return;
    cameraAutostartAttemptedRef.current = true;
    void startCamera();
  }, [safetyFlag]);

  const stopCamera = () => {
    stopVocalAnalysis();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  };

  const openIdentitySetup = async () => {
    const bridge = window.coupleLabDesktop;
    if (!bridge) {
      setIdentitySetupError("כדי ללמוד לזהות אתכם, פתחו את Couple Lab מהסמל שעל שולחן העבודה.");
      return;
    }
    if (recordingRef.current || ["finalizing", "saving", "analyzing"].includes(phase)) return;

    setIdentitySetupBusy(true);
    setIdentitySetupError("");
    try {
      const [runtime, voiceModel] = await Promise.all([
        bridge.getRuntimeInfo(),
        bridge.getVoiceModelStatus()
      ]);
      if (runtime.biometricEncryption !== "os") {
        setIdentitySetupError("הגנת הזיהוי המקומית אינה זמינה כרגע. אפשר להמשיך בשיחה בלי זיהוי אוטומטי.");
        return;
      }
      if (!voiceModel.ready) {
        setIdentitySetupError("מודל זיהוי הקול עדיין אינו מוכן. אפשר להמשיך בשיחה ולנסות שוב מאוחר יותר.");
        return;
      }
      identityCameraWasReadyRef.current = cameraReady;
      if (cameraReady) stopCamera();
      setIdentitySetupOpen(true);
    } catch {
      setIdentitySetupError("לא הצלחנו להכין את לימוד הזיהוי. אפשר להמשיך בשיחה ולנסות שוב מאוחר יותר.");
    } finally {
      setIdentitySetupBusy(false);
    }
  };

  const closeIdentitySetup = () => {
    setIdentitySetupOpen(false);
    void refreshBiometricEnrollment();
    if (identityCameraWasReadyRef.current && !safetyFlag) {
      identityCameraWasReadyRef.current = false;
      window.setTimeout(() => void startCamera(), 0);
    }
  };

  // Cheap lighting check: a 64x36 luma sample every few seconds. Bad light is
  // the most common reason face analysis silently degrades, so the couple gets
  // one human sentence of guidance instead of degraded results.
  useEffect(() => {
    if (!cameraReady) {
      setLightingHint("");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    const checkLighting = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      try {
        context.drawImage(video, 0, 0, 64, 36);
        const { data } = context.getImageData(0, 0, 64, 36);
        const pixelCount = data.length / 4;
        let lumaSum = 0;
        let brightPixels = 0;
        for (let index = 0; index < data.length; index += 4) {
          const luma = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
          lumaSum += luma;
          if (luma > 215) brightPixels += 1;
        }
        const meanLuma = lumaSum / pixelCount;
        const brightShare = brightPixels / pixelCount;
        setLightingHint(
          meanLuma < 55
            ? "חשוך כאן. אור קטן לידכם ישפר מאוד את הזיהוי."
            : brightShare > 0.28 && meanLuma < 125
              ? "נראה שהאור מגיע מאחוריכם. נסו לשבת כשהחלון או המנורה מולכם."
              : ""
        );
      } catch {
        // A blocked frame read is not worth surfacing; try again next tick.
      }
    };

    checkLighting();
    const intervalId = window.setInterval(checkLighting, 5000);
    return () => window.clearInterval(intervalId);
  }, [cameraReady]);

  useEffect(() => {
    if (!cameraReady || safetyFlag) return;
    let cancelled = false;
    let intervalId = 0;

    loadVisualModels()
      .then(() => {
        if (cancelled) return;
        collectVisualObservations();
        intervalId = window.setInterval(collectVisualObservations, visualSampleMs);
      })
      .catch(() => setVisualStatus("הניתוח החזותי אינו זמין"));

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // `profile` is intentionally not a dependency: it is read through
    // profileRef so automatic calibration writes do not restart sampling.
  }, [cameraReady, safetyFlag, recording, visualSampleMs]);

  const startSpeech = () => {
    if (window.coupleLabDesktop) return;
    const SpeechConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechConstructor) {
      setTranscriptionStatusKind("error");
      setSpeechStatus("לא ניתן להפעיל תמלול אוטומטי בדפדפן הזה");
      void logDiagnostic({ name: "transcription.unavailable", status: "error", errorCode: "speech-api-missing" });
      return;
    }
    const recognition = new SpeechConstructor();
    speechTerminalErrorRef.current = false;
    recognition.continuous = true;
    recognition.interimResults = true;
    const effectiveLanguage = transcriptLanguage === "auto" ? autoSpeechLanguageRef.current : transcriptLanguage;
    recognition.lang = effectiveLanguage;
    recognition.onstart = () => {
      const languageLabel =
        transcriptLanguage === "auto"
          ? `אוטומטי (${effectiveLanguage === "he-IL" ? "עברית" : "אנגלית"})`
          : transcriptLanguages.find((language) => language.id === transcriptLanguage)?.label ?? "דפדפן";
      setTranscriptionStatusKind("listening");
      setSpeechStatus(`התמלול מקשיב (${languageLabel})`);
      void logDiagnostic({ name: "transcription.started", status: "success", phase: effectiveLanguage });
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          const transcript = result[0].transcript;
          speechRetryRef.current = 0;
          appendSegment(transcript, "speech");
          interimTranscriptRef.current = "";
          setInterimTranscript("");
          const detectedLanguage = detectScriptLanguage(transcript);
          void logDiagnostic({
            name: "transcription.segment_captured",
            status: "success",
            itemCount: 1,
            language: detectedLanguage ?? effectiveLanguage
          });
          if (transcriptLanguage === "auto" && detectedLanguage && detectedLanguage !== autoSpeechLanguageRef.current) {
            autoSpeechLanguageRef.current = detectedLanguage;
            setAutoSpeechLanguage(detectedLanguage);
            setSpeechStatus(`זוהתה ${detectedLanguage === "he-IL" ? "עברית" : "אנגלית"}; מחליפים שפת תמלול`);
            recognition.stop();
            return;
          }
        } else {
          const interim = result[0].transcript.trim();
          interimTranscriptRef.current = interim;
          setInterimTranscript(interim);
        }
      }
    };
    recognition.onerror = (event) => {
      const errorCode = (event as Event & { error?: string }).error ?? "browser-speech-error";
      const terminalErrors = new Set(["network", "not-allowed", "service-not-allowed", "language-not-supported", "audio-capture"]);
      speechTerminalErrorRef.current = terminalErrors.has(errorCode);
      interimTranscriptRef.current = "";
      setInterimTranscript("");
      setTranscriptionStatusKind(speechTerminalErrorRef.current ? "error" : "idle");
      const messageByError: Record<string, string> = {
        "not-allowed": "יש לאשר גישה למיקרופון בהגדרות הדפדפן",
        "service-not-allowed": "שירות התמלול חסום בדפדפן הזה",
        "language-not-supported": "שפת התמלול שנבחרה אינה נתמכת",
        "audio-capture": "לא נקלט מיקרופון עבור התמלול",
        network: "שירות התמלול של הדפדפן אינו זמין כרגע",
        "no-speech": "המיקרופון פתוח, אבל עדיין לא נקלט דיבור"
      };
      setSpeechStatus(messageByError[errorCode] ?? "התמלול הושהה; ננסה לחדש אותו");
      void logDiagnostic({
        name: "transcription.failed",
        status: "error",
        errorCode,
        attempt: speechRetryRef.current + 1
      });
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!recordingRef.current && interimTranscriptRef.current.trim()) {
        appendSegment(interimTranscriptRef.current, "speech");
        interimTranscriptRef.current = "";
        setInterimTranscript("");
      }
      speechStopResolverRef.current?.();
      speechStopResolverRef.current = null;
      if (recordingRef.current && !speechTerminalErrorRef.current) {
        if (speechRetryRef.current >= 3) {
          setSpeechStatus("התמלול נעצר — ההקלטה ממשיכה וניתן להשלים ידנית");
          return;
        }
        speechRetryRef.current += 1;
        const delay = 500 * 2 ** (speechRetryRef.current - 1);
        setSpeechStatus(`מחדשים תמלול (ניסיון ${speechRetryRef.current} מתוך 3)`);
        speechRetryTimerRef.current = window.setTimeout(() => {
          try {
            startSpeech();
          } catch {
            setSpeechStatus("לא הצלחנו לחדש את התמלול — אפשר להשלים ידנית");
          }
        }, delay);
      }
    };
    recognitionRef.current = recognition;
    setTranscriptionStatusKind("idle");
    setSpeechStatus("פותחים את התמלול…");
    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setTranscriptionStatusKind("error");
      setSpeechStatus("לא הצלחנו להפעיל את התמלול; ההקלטה ממשיכה כרגיל");
      void logDiagnostic({
        name: "transcription.failed",
        status: "error",
        errorCode: error instanceof Error ? error.message : "speech-start-failed"
      });
    }
  };

  const stopLiveSpeakerMatching = () => {
    speakerProcessorRef.current?.disconnect();
    speakerSourceRef.current?.disconnect();
    speakerSilentGainRef.current?.disconnect();
    if (speakerAudioContextRef.current && speakerAudioContextRef.current.state !== "closed") {
      void speakerAudioContextRef.current.close();
    }
    speakerProcessorRef.current = null;
    speakerSourceRef.current = null;
    speakerSilentGainRef.current = null;
    speakerAudioContextRef.current = null;
    speakerChunksRef.current = [];
    speakerSamplesRef.current = 0;
    speakerMatchBusyRef.current = false;
  };

  // Live vocal (prosody) analysis: reads loudness, pitch and pauses straight
  // from the microphone signal and streams observations into the session, the
  // same way the camera streams visual observations. Self-contained Web Audio,
  // so it runs in the browser and the desktop build alike — unlike the speaker
  // matcher above, which needs the desktop bridge.
  const startVocalAnalysis = () => {
    const stream = streamRef.current;
    if (!stream || stream.getAudioTracks().length === 0) {
      setVocalStatus("אין מיקרופון זמין לניתוח הקול");
      return;
    }
    stopVocalAnalysis();
    const analyser = new VocalAnalyser({
      activeSpeaker: () => activeSpeakerRef.current,
      onObservations: (observations: VocalObservationLite[]) => {
        if (!recordingRef.current) return;
        // A quiet, unremarkable window clears the live tone so the tag next to
        // the active turn always reflects the here-and-now, never a stale cue.
        if (observations.length === 0) {
          setLiveVocalTone(null);
          return;
        }
        const seconds = Math.round(elapsedRef.current);
        const stamped: VocalObservation[] = observations.map((observation, index) => ({
          id: `vocal-${observation.label}-${observation.subject ?? "x"}-${seconds}-${index}`,
          seconds,
          label: observation.label,
          subject: observation.subject,
          score: observation.score,
          evidence: observation.evidence,
          provider: "local-prosody-v1",
          metadata: observation.metadata
        }));
        vocalObservationsRef.current = [...vocalObservationsRef.current, ...stamped];
        setVocalObservations((current) => [...current.slice(-200), ...stamped]);
        // Surface the strongest cue as the live tone next to the active turn.
        const strongest = [...stamped].sort((first, second) => second.score - first.score)[0];
        setLiveVocalTone(strongest);
      }
    });
    try {
      analyser.start(stream);
      vocalAnalyserRef.current = analyser;
      setVocalStatus("מקשיב לטון הקול בזמן אמת");
    } catch {
      vocalAnalyserRef.current = null;
      setVocalStatus("ניתוח הקול לא זמין בדפדפן הזה");
    }
  };

  const stopVocalAnalysis = () => {
    vocalAnalyserRef.current?.stop();
    vocalAnalyserRef.current = null;
    setLiveVocalTone(null);
  };

  const startLiveSpeakerMatching = () => {
    const stream = streamRef.current;
    const enrollment = enrollmentRef.current;
    const bridge = window.coupleLabDesktop;
    if (!stream || !bridge) {
      setSpeakerStatus("זיהוי הקול אינו זמין; נשתמש בתנועת הפנים");
      return;
    }
    const voiceMatchingReady = Boolean(
      enrollment?.partners.A?.voiceTemplates.length && enrollment.partners.B?.voiceTemplates.length
    );

    stopLiveSpeakerMatching();
    // Ask the browser to run this graph at 16kHz: its internal resampler is
    // properly band-limited (no aliasing) and every downstream consumer
    // (Whisper, CAM++, the energy extractor) expects 16kHz anyway, so the
    // linear-interpolation fallback resampler becomes a no-op and per-block
    // CPU drops by ~3x.
    let audioContext: AudioContext;
    try {
      audioContext = new AudioContext({ sampleRate: 16000 });
    } catch {
      audioContext = new AudioContext();
    }
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    transcriptionSampleRateRef.current = audioContext.sampleRate;
    processor.onaudioprocess = (event) => {
      if (!recordingRef.current) return;
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
      transcriptionChunksRef.current.push(chunk);
      if (!voiceMatchingReady || !enrollment) return;
      speakerChunksRef.current.push(chunk);
      speakerSamplesRef.current += chunk.length;
      const minimumSamples = Math.round(audioContext.sampleRate * 4);
      if (speakerSamplesRef.current < minimumSamples || speakerMatchBusyRef.current) return;

      const captured = joinAudioChunks(speakerChunksRef.current);
      speakerChunksRef.current = [];
      speakerSamplesRef.current = 0;
      const samples = resampleAudio(captured, audioContext.sampleRate, 16000);
      const quality = inspectAudioQuality(samples, 16000);
      if (quality.rms < 0.01 || quality.activeRatio < 0.22) {
        setSpeakerStatus("ממתינים לדיבור ברור לזיהוי הקול");
        return;
      }

      speakerMatchBusyRef.current = true;
      void bridge.extractVoiceEmbedding(samples)
        .then(({ vector }) => {
          if (!recordingRef.current) return;
          const match = matchPartnerVector(vector, enrollment.partners.A, enrollment.partners.B, "voiceTemplates");
          if (match.partnerId) applyAutomaticSpeaker(match.partnerId, "voice");
          else setSpeakerStatus("הקול לא זוהה בוודאות — לא משייכים שם");
        })
        .catch(() => setSpeakerStatus("זיהוי הקול הושהה; השיחה ממשיכה"))
        .finally(() => {
          speakerMatchBusyRef.current = false;
        });
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    speakerAudioContextRef.current = audioContext;
    speakerSourceRef.current = source;
    speakerProcessorRef.current = processor;
    speakerSilentGainRef.current = silentGain;
    setSpeakerStatus(voiceMatchingReady ? "זיהוי הקול פעיל ברקע" : "זיהוי הקול עדיין לא הוגדר; זיהוי הפנים ממשיך");
  };

  /**
   * Post-session speaker attribution: each VAD-timed transcript segment is
   * matched against the enrolled CAM++ voice templates. Confident matches are
   * attributed automatically; everything else stays "unknown" and is never
   * forced to a name. With most words attributed, turn-balance metrics
   * become available without live diarization.
   */
  const attributeSpeakersToLocalSegments = async (
    segmentsToAttribute: TranscriptSegment[],
    samples: Float32Array,
    segmentation?: string
  ): Promise<TranscriptSegment[]> => {
    const bridge = window.coupleLabDesktop;
    const enrollment = enrollmentRef.current;
    const ready = Boolean(
      bridge && enrollment?.partners.A?.voiceTemplates.length && enrollment.partners.B?.voiceTemplates.length
    );
    if (!bridge || !enrollment || !ready) return segmentsToAttribute;
    // Without VAD boundaries the "segment" is the whole recording. Embedding it
    // would return one voice and label the entire conversation as one person,
    // which is worse than admitting the speaker is unknown.
    if (segmentation !== "silero-vad") {
      void logDiagnostic({
        name: "transcription.speaker_attribution",
        status: "info",
        errorCode: "skipped-no-vad-segments",
        phase: segmentation ?? "unknown"
      });
      return segmentsToAttribute;
    }

    const attributed: TranscriptSegment[] = [];
    let attributedCount = 0;
    for (const segment of segmentsToAttribute) {
      const startSample = Math.max(0, Math.floor(segment.seconds * 16000));
      const endSample = Math.min(samples.length, Math.ceil((segment.endSeconds ?? segment.seconds) * 16000));
      if (endSample - startSample < 16000 * 1.2) {
        attributed.push(segment);
        continue;
      }
      try {
        const windowSamples = samples.slice(startSample, endSample);
        const quality = inspectAudioQuality(windowSamples, 16000);
        if (quality.rms < 0.008 || quality.activeRatio < 0.15) {
          attributed.push(segment);
          continue;
        }
        const { vector } = await bridge.extractVoiceEmbedding(windowSamples);
        const match = matchPartnerVector(vector, enrollment.partners.A, enrollment.partners.B, "voiceTemplates");
        if (match.partnerId) {
          attributedCount += 1;
          attributed.push({
            ...segment,
            speaker: match.partnerId,
            target: otherPartner(match.partnerId),
            speakerAttribution: "automatic"
          });
        } else {
          attributed.push(segment);
        }
      } catch {
        attributed.push(segment);
      }
    }
    if (attributedCount > 0) {
      void logDiagnostic({
        name: "transcription.speaker_attribution",
        status: "success",
        itemCount: attributedCount,
        phase: `${attributedCount}/${segmentsToAttribute.length}`
      });
    }
    return attributed;
  };

  const transcribeRecordingLocally = async () => {
    const bridge = window.coupleLabDesktop;
    const chunks = transcriptionChunksRef.current;
    transcriptionChunksRef.current = [];
    if (!bridge || chunks.length === 0) return;

    setTranscriptionStatusKind("processing");
    setSpeechStatus("מכינים את התמלול במכשיר…");
    const startedAt = performance.now();
    try {
      const captured = joinAudioChunks(chunks);
      const samples = resampleAudio(captured, transcriptionSampleRateRef.current, 16000);
      acousticMetricsRef.current = analyzeAcousticFeatures(samples, 16000);
      const quality = inspectAudioQuality(samples, 16000);
      if (quality.rms < 0.004 || quality.activeRatio < 0.04) {
        setTranscriptionStatusKind("error");
        setSpeechStatus("לא זוהה דיבור ברור; אפשר להשלים טקסט ידנית");
        void logDiagnostic({ name: "transcription.local_empty", status: "info", errorCode: "no-speech" });
        return;
      }
      const language = transcriptLanguage === "en-US" ? "en-US" : "he-IL";
      const result = await bridge.transcribeAudio(samples, language);
      localTranscriptionMetadataRef.current = result.metadata ? {
        ...result.metadata,
        speechSegments: result.speechSegments ?? []
      } : undefined;
      const text = result.text.trim();
      if (!text) {
        setTranscriptionStatusKind("error");
        setSpeechStatus("לא זוהה דיבור ברור; אפשר להשלים טקסט ידנית");
        void logDiagnostic({ name: "transcription.local_empty", status: "info", errorCode: "empty-result" });
        return;
      }
      const returnedSegments = result.segments?.filter((segment) => segment.text.trim()) ?? [];
      const localSegments: TranscriptSegment[] = returnedSegments.length > 0
        ? returnedSegments.map((returned) => ({
            ...buildSegment(returned.text, "speech"),
            seconds: Math.max(0, returned.startSeconds),
            endSeconds: Math.max(returned.startSeconds, returned.endSeconds),
            speakerAttribution: "unknown" as const,
            detectedLanguage: returned.language,
            transcriptionMetadata: result.metadata ? {
              modelId: result.metadata.modelId,
              vadModelId: result.metadata.vadModelId,
              segmentation: result.metadata.segmentation,
              ...returned.quality
            } : undefined
          }))
        : [{
            ...buildSegment(text, "speech"),
            seconds: 0,
            endSeconds: elapsedRef.current,
            speakerAttribution: "unknown" as const,
            detectedLanguage: result.language,
            transcriptionMetadata: result.metadata ? {
              modelId: result.metadata.modelId,
              vadModelId: result.metadata.vadModelId,
              segmentation: result.metadata.segmentation,
              ...result.metadata.quality
            } : undefined
          }];
      const segmentation = result.metadata?.segmentation;
      if (segmentation && segmentation !== "silero-vad") {
        // The transcript still saves, but quality is materially lower and every
        // downstream metric is affected. Record why so it is diagnosable.
        void logDiagnostic({
          name: "transcription.vad_fallback",
          status: "error",
          phase: segmentation,
          errorCode: result.metadata?.fallbackReason ?? "unknown"
        });
      }
      setSpeechStatus("מזהים מי אמר מה…");
      const attributedLocalSegments = await attributeSpeakersToLocalSegments(localSegments, samples, segmentation);
      const nextSegments = [...segmentsRef.current, ...attributedLocalSegments];
      acousticMetricsRef.current = addTranscriptRate(
        acousticMetricsRef.current,
        attributedLocalSegments.reduce((sum, segment) => sum + (segment.wordCount ?? spokenWordCount(segment.text)), 0)
      );
      segmentsRef.current = nextSegments;
      setSegments(nextSegments);
      setTranscriptionStatusKind("ready");
      const hasLowConfidence = attributedLocalSegments.some(
        (segment) => segment.transcriptionMetadata?.confidenceLevel === "low"
      );
      setSpeechStatus(hasLowConfidence
        ? "התמלול מוכן; כדאי לעבור על הקטעים שסומנו לבדיקה"
        : "התמלול מוכן; שומרים אותו עם השיחה…");
      void logDiagnostic({
        name: "transcription.local_completed",
        status: "success",
        durationMs: Math.round(performance.now() - startedAt),
        itemCount: attributedLocalSegments.length,
        phase: result.metadata?.segmentation ?? result.language
      });
    } catch (error) {
      setTranscriptionStatusKind("error");
      setSpeechStatus("לא הצלחנו להכין תמלול; ההקלטה נשמרה ואפשר להשלים ידנית");
      void logDiagnostic({
        name: "transcription.local_failed",
        status: "error",
        durationMs: Math.round(performance.now() - startedAt),
        errorCode: error instanceof Error ? error.message : "local-transcription-failed"
      });
    }
  };

  const persistSession = async (mediaBlob: Blob | null) => {
    if (savingRef.current) return;
    const pendingText = manualTextRef.current.trim();
    const currentSegments = segmentsRef.current;
    const segmentsToSave = pendingText
      ? [...currentSegments, buildSegment(pendingText, "manual")]
      : currentSegments;
    const currentCues = cuesRef.current;
    const currentObservations = observationsRef.current;
    const evidence = sessionEvidenceSummary({
      segments: segmentsToSave,
      cues: currentCues,
      observations: currentObservations
    });

    if (!mediaBlob && evidence.evidenceCount === 0) {
      setPhase("error");
      setPhaseError("כדי לשמור שיחה צריך הקלטה, תמלול או הערה ידנית.");
      return;
    }

    savingRef.current = true;
    const saveStartedAt = performance.now();
    const sessionId = nowId("session");
    setPhaseError("");
    setPhase("saving");
    void logDiagnostic({ name: "session.save_requested", status: "info", sessionId, phase: "saving" });

    try {
      const media = mediaBlob && mediaBlob.size > 0 ? await saveSessionMedia(sessionId, mediaBlob) : undefined;
      if (media) {
        void logDiagnostic({
          name: "recording.persist_completed",
          status: "success",
          sessionId,
          phase: "saved",
          durationMs: Math.round(performance.now() - saveStartedAt)
        });
      }

      setPhase("analyzing");
      void logDiagnostic({ name: "analysis.started", status: "info", sessionId, phase: "analyzing" });
      const analysisStartedAt = performance.now();
      const analysis = analyzeSession(segmentsToSave, signals, currentCues, sessionType, currentObservations, vocalObservationsRef.current);
      const nonverbalMetrics = computeNonverbalMetrics(visualMetricObservationsRef.current);
      const record: SessionRecord = {
        schemaVersion: 2,
        id: sessionId,
        title: `${activeDeck.title} · ${new Date().toLocaleDateString("he-IL")}`,
        type: sessionType,
        startedAt: new Date().toISOString(),
        durationSeconds: elapsedRef.current,
        segments: segmentsToSave,
        transcriptionMetadata: localTranscriptionMetadataRef.current,
        acousticMetrics: acousticMetricsRef.current,
        cues: currentCues,
        visualObservations: currentObservations,
        vocalObservations: vocalObservationsRef.current,
        nonverbalMetrics,
        signals,
        analysis,
        media,
        processingStatus: analysis.dataQuality?.status === "insufficient" ? "insufficient-data" : "ready"
      };
      setSessions((current) => current.some((session) => session.id === sessionId) ? current : [record, ...current]);
      setLastCompletedSession(record);
      setPhase("ready");
      if (manualCorrectionRef.current) manualCorrectionRef.current.open = false;
      if (segmentsToSave.length > 0) {
        setTranscriptionStatusKind("ready");
        setSpeechStatus("התמלול נשמר עם השיחה");
      }
      void logDiagnostic({
        name: "analysis.completed",
        status: "success",
        sessionId,
        phase: record.processingStatus,
        durationMs: Math.round(performance.now() - analysisStartedAt),
        itemCount: evidence.evidenceCount
      });
      // Vision telemetry. Without this there is no way to tell a camera that
      // never produced a usable frame from one that worked fine but had
      // nothing warm to report — they look identical in the UI.
      const behavioural = currentObservations.filter((observation) => observation.label !== "capture-quality");
      const qualitySamples = currentObservations.filter((observation) => observation.label === "capture-quality");
      const bothVisible = qualitySamples.filter((observation) => Number(observation.metadata?.faceCount ?? 0) >= 2).length;
      void logDiagnostic({
        name: "vision.session_summary",
        status: qualitySamples.length === 0 ? "error" : behavioural.length === 0 ? "info" : "success",
        sessionId,
        itemCount: behavioural.length,
        // "<samples where both faces were seen>/<total camera samples>"
        phase: `${bothVisible}/${qualitySamples.length}`,
        errorCode: qualitySamples.length === 0 ? "no-camera-samples" : undefined
      });
      void logDiagnostic({
        name: "session.save_completed",
        status: "success",
        sessionId,
        phase: "ready",
        durationMs: Math.round(performance.now() - saveStartedAt),
        itemCount: segmentsToSave.length
      });
      setSegments([]);
      segmentsRef.current = [];
      setCues([]);
      cuesRef.current = [];
      setVisualObservations([]);
      observationsRef.current = [];
      visualMetricObservationsRef.current = [];
      setManualText("");
      manualTextRef.current = "";
      setDeckStats({ ...deckStats, [activeDeck.id]: (deckStats[activeDeck.id] ?? 0) + 1 });
    } catch {
      setPhase("error");
      setPhaseError("לא הצלחנו להשלים את השמירה. ההקלטה עדיין פתוחה במסך הזה ואפשר לנסות שוב או להוריד עותק.");
      if (segmentsRef.current.length > 0) {
        setTranscriptionStatusKind("error");
        setSpeechStatus("התמלול מוכן, אך שמירת השיחה לא הושלמה");
      }
      void logDiagnostic({ name: "session.save_failed", status: "error", sessionId, errorCode: "device-storage-failed" });
    } finally {
      savingRef.current = false;
    }
  };

  const startRecording = async () => {
    if (!profile.recordingConsent) {
      setPhaseError("לפני ההקלטה נדרשת הסכמה משותפת לשמירת שיחות התרגול במכשיר הזה.");
      return;
    }
    setLastCompletedSession(null);
    setCompletedAnswerers([]);
    setBreakPlan("");
    setTurnMessage(`${partnerName(profile, activeSpeakerRef.current)} עונה עכשיו; ${partnerName(profile, otherPartner(activeSpeakerRef.current))} מקשיב/ה.`);
    interimTranscriptRef.current = "";
    setInterimTranscript("");
    setPhaseError("");
    void logDiagnostic({ name: "consent.confirmed", status: "success", phase: "recording" });
    if (!streamRef.current) await startCamera();
    if (!streamRef.current) return;
    try {
      mediaChunksRef.current = [];
      videoBlobRef.current = null;
      previousPoseRef.current = {};
      previousHeadOrientationRef.current = {};
      localTranscriptionMetadataRef.current = undefined;
      acousticMetricsRef.current = undefined;
      visualSampleIndexRef.current = 0;
      visualMetricObservationsRef.current = [];
      vocalObservationsRef.current = [];
      setVocalObservations([]);
      setLiveVocalTone(null);
      // Prefer VP9: noticeably better quality at the same bitrate on modern
      // Chromium; VP8 remains the compatibility fallback.
      const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
      const recorderOptions: MediaRecorderOptions = {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: mobileRealtime ? 1_000_000 : 1_800_000,
        audioBitsPerSecond: 64_000
      };
      const recorder = new MediaRecorder(streamRef.current, recorderOptions);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) mediaChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setPhase("error");
        setPhaseError("אירעה תקלה בהקלטה. אפשר לנסות שוב בלי לאבד את הטקסט שכבר נקלט.");
        void logDiagnostic({ name: "recording.failed", status: "error", errorCode: "media-recorder-error" });
      };
      mediaRecorderRef.current = recorder;
      setElapsed(0);
      elapsedRef.current = 0;
      speechRetryRef.current = 0;
      transcriptionChunksRef.current = [];
      localTranscriptionMetadataRef.current = undefined;
      if (transcriptLanguage === "auto") {
        const nextLanguage = chooseInitialSpeechLanguage(profile, segmentsRef.current);
        autoSpeechLanguageRef.current = nextLanguage;
        setAutoSpeechLanguage(nextLanguage);
      }
      recordingRef.current = true;
      setRecording(true);
      setPhase("recording");
      recorder.start(1000);
      if (window.coupleLabDesktop) {
        setTranscriptionStatusKind(localTranscriptionReadyRef.current ? "listening" : "idle");
        setSpeechStatus(
          localTranscriptionReadyRef.current
            ? "מקליטים; התמלול יוכן במכשיר אחרי הסיום"
            : "מקליטים; נבדוק את התמלול המקומי בסיום"
        );
      } else {
        startSpeech();
      }
      startLiveSpeakerMatching();
      startVocalAnalysis();
      void logDiagnostic({ name: "recording.started", status: "success", phase: "recording" });
    } catch {
      setPhase("error");
      setPhaseError("הדפדפן לא הצליח להתחיל את ההקלטה. אפשר לנסות שוב או להמשיך עם הערות ידניות.");
      void logDiagnostic({ name: "recording.failed", status: "error", errorCode: "media-recorder-start-failed" });
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recordingRef.current = false;
    setRecording(false);
    stopLiveSpeakerMatching();
    stopVocalAnalysis();
    setVocalStatus("ניתוח הקול הסתיים");
    setPhase("finalizing");
    const speechFinalized = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      speechStopResolverRef.current = finish;
      window.setTimeout(finish, 1500);
      if (!recognitionRef.current) finish();
    });
    try {
      recognitionRef.current?.stop();
    } catch {
      speechStopResolverRef.current?.();
      speechStopResolverRef.current = null;
    }
    if (speechRetryTimerRef.current) window.clearTimeout(speechRetryTimerRef.current);
    recorder.onstop = async () => {
      const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || "video/webm" });
      videoBlobRef.current = blob;
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      const nextUrl = URL.createObjectURL(blob);
      videoUrlRef.current = nextUrl;
      setVideoUrl(nextUrl);
      void logDiagnostic({ name: "recording.stopped", status: "success", phase: "finalized" });
      await speechFinalized;
      await transcribeRecordingLocally();
      void persistSession(blob);
    };
    try {
      recorder.stop();
    } catch {
      setPhase("error");
      setPhaseError("לא הצלחנו לסיים את ההקלטה בצורה תקינה. אפשר לנסות שוב.");
      void logDiagnostic({ name: "recording.failed", status: "error", errorCode: "media-recorder-stop-failed" });
    }
  };
  stopRecordingRef.current = stopRecording;

  const saveSession = () => void persistSession(videoBlobRef.current);

  const currentNonverbalMetrics = useMemo(() => computeNonverbalMetrics(visualObservations), [visualObservations]);
  const guide = conversationGuide(sessionType, activeDeck.id);
  const visibleSegments = phase === "ready" && lastCompletedSession ? lastCompletedSession.segments : segments;
  const visibleTranscriptTags = phase === "ready" && lastCompletedSession ? lastCompletedSession.analysis.tags : [];
  const visibleTranscriptWords = visibleSegments.reduce(
    (sum, segment) => sum + (segment.wordCount ?? spokenWordCount(segment.text)),
    0
  );
  const canSaveDraft = Boolean(manualText.trim() || segments.length || cues.length);
  const leftPartner: PartnerId = profile.visualCalibration?.A === "right" ? "B" : "A";
  const rightPartner = otherPartner(leftPartner);
  const capturedWordsFor = (partner: PartnerId) =>
    segments.filter((segment) => segment.speaker === partner).reduce((sum, segment) => sum + (segment.wordCount ?? spokenWordCount(segment.text)), 0);

  const selectActiveSpeaker = (partner: PartnerId) => {
    activeSpeakerRef.current = partner;
    setActiveSpeaker(partner);
    setTurnMessage(`${partnerName(profile, partner)} עונה עכשיו; ${partnerName(profile, otherPartner(partner))} מקשיב/ה.`);
  };

  const completeCurrentAnswer = () => {
    const speaker = activeSpeakerRef.current;
    const listener = otherPartner(speaker);
    const words = capturedWordsFor(speaker);
    const nextCompleted = Array.from(new Set([...completedAnswerers, speaker])) as PartnerId[];
    setCompletedAnswerers(nextCompleted);

    if (!nextCompleted.includes(listener)) {
      selectActiveSpeaker(listener);
      setTurnMessage(
        words > 0
          ? `קלטנו ${words} מילים מ${partnerName(profile, speaker)}. ${partnerName(profile, listener)}, לפני התשובה שלך אמר/י: “מה ששמעתי הוא… הבנתי נכון?” ואז השב/י לאותה שאלה.`
          : `לא נקלט עדיין תמלול מ${partnerName(profile, speaker)}. אפשר להשלים ידנית; ${partnerName(profile, listener)}, שקפ/י קודם מה שמעת ואז השב/י לאותה שאלה.`
      );
      return;
    }

    setTurnMessage(`שתי התשובות נשמרו. כל אחד אומר עכשיו דבר אחד ששמע ודבר אחד שהוא מעריך בתשובת השני.`);
  };

  const requestCalmingBreak = () => {
    const returnAt = new Date(Date.now() + 20 * 60 * 1000).toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit"
    });
    if (recordingRef.current) {
      const pauseCue: LiveCue = {
        id: nowId("cue"),
        speaker: activeSpeakerRef.current,
        tone: "pause",
        seconds: elapsedRef.current
      };
      const nextCues = [...cuesRef.current, pauseCue];
      cuesRef.current = nextCues;
      setCues(nextCues);
    }
    setBreakPlan(`עוצרים עכשיו וחוזרים בשעה ${returnAt}. בזמן ההפסקה לא ממשיכים את הוויכוח.`);
    setTurnMessage(`${partnerName(profile, activeSpeakerRef.current)} ביקש/ה הפסקה. קובעים חזרה לשיחה בשעה ${returnAt}.`);
    if (recordingRef.current) window.setTimeout(() => stopRecordingRef.current(), 0);
  };

  const saveClosingReflection = () => {
    if (!lastCompletedSession || !closingNextStep.trim()) return;
    const closingReflection = {
      feltGood: closingFeltGood.trim(),
      remember: closingRemember.trim(),
      nextStep: closingNextStep.trim(),
      completedAt: new Date().toISOString()
    };
    const updated = { ...lastCompletedSession, closingReflection };
    setLastCompletedSession(updated);
    setSessions((current) => current.map((session) => session.id === updated.id ? updated : session));
    setClosingSaved(true);
    void logDiagnostic({ name: "session.closing_completed", status: "success", sessionId: updated.id, itemCount: 3 });
  };

  const recordFollowUp = (outcome: NonNullable<SessionRecord["followUp"]>["outcome"]) => {
    if (!pendingFollowUp) return;
    const followUp = { outcome, checkedAt: new Date().toISOString() };
    setSessions((current) => current.map((session) => session.id === pendingFollowUp.id ? { ...session, followUp } : session));
    void logDiagnostic({ name: "session.follow_up_completed", status: "success", sessionId: pendingFollowUp.id, phase: outcome });
  };

  const busyPhase = ["requesting-permission", "finalizing", "saving", "analyzing"].includes(phase);
  const controlsPinned = recording || ["finalizing", "saving", "analyzing"].includes(phase);
  const primaryActionLabel = recording
    ? "סיום ושמירה"
    : phase === "finalizing"
      ? "מסיימים את ההקלטה…"
      : phase === "saving"
        ? "שומרים במכשיר…"
        : phase === "analyzing"
          ? "מכינים את הסיכום…"
          : phase === "ready"
            ? "התחלת שיחה חדשה"
            : "התחלת השיחה";
  const openManualCorrection = () => {
    if (manualCorrectionRef.current) manualCorrectionRef.current.open = true;
    window.setTimeout(() => manualCorrectionRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 0);
  };

  useEffect(() => {
    if (phase !== "ready" || !lastCompletedSession) return;
    const frame = window.requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      transcriptPanelRef.current?.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
      transcriptPanelRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase, lastCompletedSession]);

  return (
    <section className={`practice-grid phase-${phase}`}>
      {pendingFollowUp && phase === "setup" && (
        <section className="practice-follow-up" aria-labelledby="practice-follow-up-title">
          <div>
            <h2 id="practice-follow-up-title">לפני שמתחילים — איך הלך הצעד שבחרתם?</h2>
            <p>“{pendingFollowUp.closingReflection?.nextStep}”</p>
          </div>
          <div className="follow-up-actions" role="group" aria-label="איך הלך הצעד הקודם">
            <button className="secondary" onClick={() => recordFollowUp("helped")}>עזר לנו</button>
            <button className="secondary" onClick={() => recordFollowUp("partly")}>קצת</button>
            <button className="secondary" onClick={() => recordFollowUp("not-yet")}>עוד לא יצא</button>
            <button className="text-button" onClick={() => recordFollowUp("not-fit")}>לא התאים לנו</button>
          </div>
        </section>
      )}
      <div className="prompt-stage studio-prompt">
        <div className="prompt-meta">
          <strong>{activeDeck.title}</strong>
          <p>{activeDeck.lens} · {activeDeck.purpose}</p>
        </div>
        <blockquote dir="auto">{activeDeck.cards[cardIndex]}</blockquote>
        <details className="conversation-protocol contextual-guide">
          <summary aria-label={`${guide.title} — פתיחה או סגירה של הנחיות קצרות`}>
            <span className="guide-summary-copy">
              <strong>{guide.title}</strong>
              <span className="guide-hint-default">{guide.intro}</span>
              <span className="guide-hint-action" aria-hidden="true">לחצו לפתיחת 3 הנחיות קצרות</span>
              <span className="guide-hint-close" aria-hidden="true">לחצו לסגירת ההנחיות</span>
            </span>
            <ChevronDown className="guide-chevron" size={19} aria-hidden="true" />
          </summary>
          <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </details>
        <div className="prompt-actions">
          <label className="visually-hidden" htmlFor="practice-topic">בחירת נושא לשיחה</label>
          <select
            id="practice-topic"
            name="practice-topic"
            aria-label="בחירת נושא לשיחה"
            value={activeDeck.id}
            onChange={(event) => {
              const deck = decks.find((item) => item.id === event.target.value) ?? decks[0];
              setActiveDeck(deck);
              setSessionType(sessionTypeForDeck(deck.id));
              setCardIndex(nextQuestionIndex(deck.cards.length, questionHistory[deck.id] ?? []));
              setCompletedAnswerers([]);
              setTurnMessage("");
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
            שאלה אחרת
          </button>
        </div>
      </div>

      <div className="camera-stack">
        <div className="lab-stage">
          {safetyFlag && (
            <div className="safety-banner">
              <ShieldCheck size={18} />
              התרגול מושהה עד להשלמת בדיקת הבטיחות.
            </div>
          )}
          {phaseError && <div className="status-banner error" role="alert">{phaseError}</div>}
          <video ref={videoRef} autoPlay playsInline muted className="video-preview" />
          {!cameraReady && (
            <div className="video-placeholder">
              <Camera size={42} />
              <span>{phase === "requesting-permission" ? "פותחים את המצלמה והמיקרופון…" : "המצלמה אינה זמינה כרגע"}</span>
            </div>
          )}
          {cameraReady && lightingHint && !recording && (
            <div className="status-banner lighting-hint" role="status">{lightingHint}</div>
          )}
          {cameraReady && profile.visualCalibration && (
            <div className="video-identity-overlay" aria-label="מיפוי בני הזוג בווידאו">
              <span className={activeSpeaker === leftPartner ? "active" : ""}>{partnerName(profile, leftPartner)}</span>
              <span className={activeSpeaker === rightPartner ? "active" : ""}>{partnerName(profile, rightPartner)}</span>
            </div>
          )}
        </div>

        <div className={`camera-primary-controls ${controlsPinned ? "is-active" : ""}`}>
          {phase === "setup" && !profile.recordingConsent && (
            <label className="recording-consent check-row">
              <input
                name="recording-consent"
                type="checkbox"
                checked={recordingConsent}
                onChange={(event) => {
                  setRecordingConsent(event.target.checked);
                  if (event.target.checked) {
                    setProfile({
                      ...profile,
                      recordingConsent: {
                        version: 1,
                        grantedAt: new Date().toISOString(),
                        scope: "all-local-practice-recordings"
                      }
                    });
                    setPhaseError("");
                  }
                }}
              />
              <span>
                <strong>שנינו מסכימים לשמירת שיחות התרגול במכשיר הזה</strong>
                <small>זו הסכמה חד־פעמית לכל השיחות המקומיות עד שתבטלו אותה בהגדרות. ההקלטות אינן נשלחות לענן וניתן למחוק אותן.</small>
              </span>
            </label>
          )}

          <div className="lab-controls">
            <button
              className={`primary ${recording ? "recording-action" : ""}`}
              onClick={recording ? stopRecording : startRecording}
              disabled={safetyFlag || (!recording && !profile.recordingConsent) || busyPhase}
            >
              {recording || busyPhase ? <Square size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
              {primaryActionLabel}
            </button>
            <button className="secondary calming-break" onClick={requestCalmingBreak} disabled={busyPhase} aria-label="אני צריך או צריכה הפסקה">
              <ShieldCheck size={17} aria-hidden="true" />
              <span className="break-label-full">אני צריך/ה הפסקה</span>
              <span className="break-label-short" aria-hidden="true">הפסקה</span>
            </button>
            <span className="timer" dir="ltr" aria-label={`משך השיחה ${formatTime(elapsed)}`}>{formatTime(elapsed)}</span>
          </div>
        </div>

        <div className="recording-dock">
          <div className={`automatic-attribution-card ${incompleteIdentity.length > 0 ? "identity-incomplete" : "identity-ready"}`}>
            <div className="identity-status-copy">
              <strong>{recording ? `נראה ש${partnerName(profile, activeSpeaker)} מדבר/ת עכשיו` : "הזיהוי יתחיל עם השיחה"}</strong>
              <small>{identityStatus}</small>
              {recording && liveVocalTone && (
                <div className="live-tone-row" aria-live="polite">
                  <span className="live-tone-label">טון הקול עכשיו:</span>
                  <VocalToneTag observation={liveVocalTone} profile={profile} live />
                </div>
              )}
            </div>
            {incompleteIdentity.length > 0 ? (
              <div className="identity-setup-actions">
                <button className="secondary identity-setup-button" onClick={() => void openIdentitySetup()} disabled={identitySetupBusy || busyPhase}>
                  <Fingerprint size={17} aria-hidden="true" />
                  {identitySetupBusy
                    ? "מכינים…"
                    : incompleteIdentity.length === 1
                      ? `נלמד לזהות את ${partnerName(profile, incompleteIdentity[0])}`
                      : "נלמד לזהות אתכם"}
                </button>
                <button className="text-button" onClick={openManualCorrection}>המשך בלי זיהוי ותיקון ידני</button>
              </div>
            ) : (
              <div className="identity-correction">
                <span>לא מדויק?</span>
                <button className="text-button" onClick={openManualCorrection}>תקנו כאן</button>
                <small>{speakerStatus}</small>
              </div>
            )}
          </div>
          {identitySetupError && <p className="identity-setup-error" role="alert">{identitySetupError}</p>}
          <div className={`transcription-rail ${transcriptionStatusKind}`} role="status" aria-live="polite" aria-atomic="true">
            <Mic size={17} aria-hidden="true" />
            <div><strong>תמלול</strong><span>{speechStatus}</span></div>
            {transcriptionStatusKind === "error" && !window.coupleLabDesktop && recording && (
              <button className="text-button" onClick={startSpeech}>נסו להפעיל שוב</button>
            )}
            {transcriptionStatusKind === "error" && <button className="text-button" onClick={openManualCorrection}>הוספת טקסט ידנית</button>}
          </div>
          {breakPlan && <div className="practice-break-plan" role="status"><strong>תוכנית הפסקה</strong><span>{breakPlan}</span></div>}
          <p className="privacy-note"><Lock size={16} aria-hidden="true" /> הכניסה לתרגול מפעילה תצוגת מצלמה מקומית. הקלטה נשמרת רק לאחר הסכמה ואינה נשלחת לענן.</p>
          {videoUrl && (
            <a className="download-link" href={videoUrl} download="couple-lab-session.webm">
              <Download size={16} aria-hidden="true" /> הורדת עותק של ההקלטה
            </a>
          )}
        </div>
      </div>

      {phase === "ready" && lastCompletedSession && lastCompletedSession.visualObservations.length > 0 && (
        <details className="advanced-panel">
          <summary>רמזים חזותיים אפשריים</summary>
          <NonverbalPanel
            profile={profile}
            metrics={lastCompletedSession.nonverbalMetrics ?? currentNonverbalMetrics}
            observations={lastCompletedSession.visualObservations}
            calibrationText={calibrationText}
            visualStatus={visualStatus}
            vocalStatus={vocalStatus}
          />
        </details>
      )}

      {phase === "ready" && lastCompletedSession && (lastCompletedSession.vocalObservations?.length ?? 0) > 0 && (
        <details className="advanced-panel">
          <summary>טון הקול שנשמע</summary>
          <VocalTonePanel profile={profile} observations={lastCompletedSession.vocalObservations ?? []} />
        </details>
      )}

      <details ref={manualCorrectionRef} className="panel lab-side advanced-options">
        <summary>לא זיהינו נכון? תיקון ידני</summary>
        <div className="field-row compact-fields">
          <button className="secondary" onClick={cameraReady ? stopCamera : startCamera} disabled={recording}>
            <Camera size={17} /> {cameraReady ? "כיבוי מצלמה" : "הפעלת מצלמה"}
          </button>
          <button aria-pressed={activeSpeaker === "A"} className={activeSpeaker === "A" ? "secondary selected" : "secondary"} onClick={() => selectActiveSpeaker("A")}>{partnerName(profile, "A")} מדבר/ת</button>
          <button aria-pressed={activeSpeaker === "B"} className={activeSpeaker === "B" ? "secondary selected" : "secondary"} onClick={() => selectActiveSpeaker("B")}>{partnerName(profile, "B")} מדבר/ת</button>
          <button className="secondary" onClick={() => calibrateVisualIdentity("left")} disabled={recording}>תיקון: {partnerName(profile, "A")} משמאל</button>
          <button className="secondary" onClick={() => calibrateVisualIdentity("right")} disabled={recording}>תיקון: {partnerName(profile, "A")} מימין</button>
        </div>

        <label className="manual-entry">
          <strong>השלמת תמלול</strong>
          <span>כתבו משפט שלא נקלט</span>
          <textarea name="manual-transcript" value={manualText} onChange={(event) => setManualText(event.target.value)} />
        </label>
        <button
          className="secondary"
          disabled={!manualText.trim()}
          onClick={() => {
            appendSegment(manualText, "manual");
            setManualText("");
          }}
        >
          <FileText size={17} />
          הוספה לתמלול
        </button>

        <details className="secondary-disclosure">
          <summary>הוספת סימון לשיחה</summary>
          <div className="cue-grid">
            {cueOptions.map((cue) => (
              <button
                key={cue.tone}
                className="cue-button"
                onClick={() => setCues((current) => [...current, { id: nowId("cue"), speaker: activeSpeaker, tone: cue.tone, seconds: elapsedRef.current }])}
              >
                {cue.label}
              </button>
            ))}
          </div>
        </details>
      </details>

      <div className="panel transcript-panel" ref={transcriptPanelRef} tabIndex={-1}>
        <div className="panel-heading">
          <div>
            <h2 tabIndex={-1}>{phase === "ready" ? "התמלול מהשיחה" : "תמלול"}</h2>
            {phase === "ready" && visibleSegments.length > 0 && <small>{visibleTranscriptWords} מילים שנשמרו במחשב הזה</small>}
          </div>
          {phase !== "ready" && (segments.length > 0 || interimTranscript) && <button className="text-button" onClick={() => {
            if (!window.confirm("למחוק את הטקסט שנקלט בשיחה הזו? ההקלטה לא תימחק.")) return;
            setSegments([]);
            segmentsRef.current = [];
            interimTranscriptRef.current = "";
            setInterimTranscript("");
          }}>
            <Trash2 size={15} aria-hidden="true" />
            מחיקת התמלול
          </button>}
        </div>
        <div className="transcript-list" role="log" aria-live="polite" aria-relevant="additions">
          {visibleSegments.length === 0 && !interimTranscript && <p className="muted">{phase === "ready" ? "לא נקלט דיבור ברור בשיחה הזו. ההקלטה נשמרה ואפשר להוסיף טקסט ידנית בשיחה הבאה." : window.coupleLabDesktop ? "התמלול יופיע כאן אחרי סיום השיחה." : "התמלול יופיע כאן בזמן השיחה. אם הוא נעצר, אפשר להשלים טקסט ידנית."}</p>}
          {interimTranscript && (
            <article className={`segment interim speaker-${activeSpeaker.toLowerCase()}`}>
              <span>{partnerName(profile, activeSpeaker)} · נקלט עכשיו…</span>
              <p dir="auto">{interimTranscript}</p>
              {liveVocalTone && (
                <div className="segment-tags" aria-label="טון הקול בתור הזה">
                  <VocalToneTag observation={liveVocalTone} profile={profile} live />
                </div>
              )}
            </article>
          )}
          <TranscriptSegments profile={profile} segments={visibleSegments} tags={visibleTranscriptTags} />
        </div>
      </div>

      <div className="panel analysis-panel">
        <div className="panel-heading">
          <h2>{phase === "ready" ? "מה זוהה בתמלול" : "מצב השיחה"}</h2>
          <Activity size={18} aria-hidden="true" />
        </div>
        {phase === "recording" ? (
          <div className="focus-mode-message">
            <HeartHandshake size={20} />
            <div>
              <strong>עכשיו נשארים עם השיחה</strong>
              <p>לא נציג ציונים או מסקנות בזמן ההקלטה.</p>
            </div>
          </div>
        ) : ["finalizing", "saving", "analyzing"].includes(phase) ? (
          <div className="processing-steps" aria-live="polite">
            <div className={phase !== "finalizing" ? "done" : "active"}><Check size={17} /> שומרים את ההקלטה</div>
            <div className={phase === "analyzing" ? "done" : phase === "saving" ? "active" : ""}><Mic size={17} /> משלימים את התמלול</div>
            <div className={phase === "analyzing" ? "active" : ""}><Activity size={17} /> מארגנים תובנות לתרגול</div>
            <p>אפשר לעזוב לאחר שנאשר שהשמירה המקומית הושלמה.</p>
          </div>
        ) : phase === "ready" && lastCompletedSession ? (
          <div className="result-ready">
            <div className="result-ready-summary">
              <span className="success-mark"><Check size={20} aria-hidden="true" /></span>
              <div>
                <strong>{lastCompletedSession.processingStatus === "insufficient-data" ? "ההקלטה והתמלול נשמרו" : "הסיכום מוכן"}</strong>
                <p dir="auto">{lastCompletedSession.analysis.summary}</p>
                <small className="analysis-source-note">
                  {lastCompletedSession.segments.length > 0
                    ? "הסיכום נבנה מהתמלול שמופיע לצד הכרטיס. זהו כלי לתרגול, לא קביעה על רגשות או כוונות."
                    : "לא היה מספיק תמלול לניתוח. הסיכום אינו מסיק דבר על רגשות או כוונות."}
                </small>
              </div>
            </div>
            <GoldenMomentsReel session={lastCompletedSession} />
            {!closingSaved && !lastCompletedSession.closingReflection ? (
              <div className="closing-ritual">
                <div className="closing-heading">
                  <h2>מה לוקחים מהשיחה?</h2>
                  <p>שלושה משפטים קצרים, יחד. רק הצעד האחרון נדרש כדי להמשיך.</p>
                </div>
                <label>
                  מה הרגיש טוב בשיחה?
                  <input value={closingFeltGood} onChange={(event) => setClosingFeltGood(event.target.value)} placeholder="למשל: הצלחנו להקשיב בלי למהר לענות" />
                </label>
                <label>
                  מה חשוב שנזכור?
                  <input value={closingRemember} onChange={(event) => setClosingRemember(event.target.value)} placeholder="משפט או רגע שתרצו לשמור" />
                </label>
                <label>
                  מהו הצעד הקטן שננסה עד הפעם הבאה? <span aria-hidden="true">*</span>
                  <input required value={closingNextStep} onChange={(event) => setClosingNextStep(event.target.value)} placeholder="למשל: לשאול שאלה לפני שמציעים פתרון" />
                </label>
                <button className="primary" disabled={!closingNextStep.trim()} onClick={saveClosingReflection}>
                  <HeartHandshake size={17} /> שמירת הצעד שלנו
                </button>
              </div>
            ) : (
              <div className="closing-confirmation" role="status">
                <HeartHandshake size={20} />
                <div><strong>זה הצעד שבחרתם</strong><p>{lastCompletedSession.closingReflection?.nextStep || closingNextStep}</p></div>
              </div>
            )}
            {(closingSaved || lastCompletedSession.closingReflection) && <div className="result-actions">
              {lastCompletedSession.processingStatus === "ready" && (
                <button className="primary" onClick={onViewResults}>לתובנות מהשיחה</button>
              )}
              <button className="secondary" onClick={() => {
                setPhase("setup");
                setLastCompletedSession(null);
                setClosingFeltGood("");
                setClosingRemember("");
                setClosingNextStep("");
                setClosingSaved(false);
                setRecordingConsent(Boolean(profile.recordingConsent));
                setElapsed(0);
                elapsedRef.current = 0;
                setCompletedAnswerers([]);
                setTurnMessage("");
                interimTranscriptRef.current = "";
                setInterimTranscript("");
              }}>תרגול נוסף</button>
            </div>}
          </div>
        ) : phase === "error" ? (
          <div className="state-panel error">
            <strong>דרושה פעולה</strong>
            <p>{phaseError || "אירעה תקלה. הנתונים שכבר נשמרו לא יימחקו."}</p>
            <button className="secondary" onClick={() => { setPhase("setup"); setPhaseError(""); }}>חזרה להכנה</button>
          </div>
        ) : (
          <div className="state-panel">
            <strong>מכינים את השיחה</strong>
            <p>בחרו שאלה והתחילו כששניכם מוכנים. אפשר להמשיך גם בלי מצלמה ולכתוב הערה ידנית.</p>
          </div>
        )}
        {phase === "setup" && (
          <button className="secondary full" onClick={saveSession} disabled={!canSaveDraft || recording}>
            <Check size={17} /> שמירת תרגול ידני ויצירת סיכום
          </button>
        )}
      </div>
      {identitySetupOpen && (
        <BiometricEnrollmentWizard
          profile={profile}
          assessment={assessment}
          initialPartnerId={incompleteIdentity[0] ?? "A"}
          singlePartner={incompleteIdentity.length === 1}
          onProfilePhotoCaptured={(partnerId, dataUrl) => setProfile({
            ...profile,
            partnerPhotos: { ...profile.partnerPhotos, [partnerId]: dataUrl }
          })}
          onClose={closeIdentitySetup}
          onSaved={refreshBiometricEnrollment}
          completionActionLabel="חזרה לשיחה"
        />
      )}
    </section>
  );
}

function tagFamilyLabel(family: InteractionTag["family"]) {
  const labels: Record<InteractionTag["family"], string> = {
    "four-horsemen": "דפוס מכאיב",
    repair: "תיקון",
    strength: "חוזקה",
    flooding: "הצפה",
    "turn-taking": "תורות דיבור",
    nonverbal: "לא־מילולי",
    desire: "תשוקה וחיות",
    "conversation-structure": "מבנה השיחה"
  };

  return labels[family];
}

function tagParticipantLine(profile: CoupleProfile, tag: InteractionTag) {
  if (tag.speaker && tag.target) {
    return `${partnerName(profile, tag.speaker)} אל ${partnerName(profile, tag.target)}`;
  }
  if (tag.speaker) {
    return partnerName(profile, tag.speaker);
  }
  return "רגע זוגי";
}

function TaggedTimeline({ profile, tags, title }: { profile: CoupleProfile; tags: InteractionTag[]; title: string }) {
  return (
    <div className="tagged-timeline">
      <strong>{title}</strong>
      {tags.length === 0 && <span className="muted">עדיין אין רגעים מסומנים.</span>}
      {tags.map((tag) => (
        <article key={tag.id} className={`timeline-tag ${tag.family}`}>
          <div>
            <span>{formatTime(tag.seconds)}</span>
            <b>{tag.label}</b>
            <small>
              {tagParticipantLine(profile, tag)} · {tag.source === "transcript" ? "מהתמלול" : tag.source === "visual" ? "מהמצלמה" : tag.source === "manual-cue" ? "סימון ידני" : "ממספר מקורות יחד"} · {tagFamilyLabel(tag.family)}
            </small>
          </div>
          <p>{tag.evidence}</p>
          {tag.suggestion && <small>{tag.suggestion}</small>}
        </article>
      ))}
    </div>
  );
}

function AdvancedEnginesPanel({ visualStatus, vocalStatus }: { visualStatus: string; vocalStatus: string }) {
  return (
    <div className="advanced-engines">
      <div className="mini-heading">
        <strong>העיבוד המקומי</strong>
      </div>
      <div className="engine-grid">
        <div className="engine-card active">
          <span>מצלמה</span>
          <small>{visualStatus}</small>
          <b>פנים, גוף ואיכות כיסוי</b>
        </div>
        <div className="engine-card active">
          <span>קול</span>
          <small>{vocalStatus}</small>
          <b>טון, גובה צליל, עוצמה ושתיקות</b>
        </div>
      </div>
      <small className="muted">כאן מוצג רק עיבוד שפועל בפועל במחשב. כל מדד מתאר את מה שנקלט ואינו קובע רגש או כוונה.</small>
    </div>
  );
}

function NonverbalPanel({
  profile,
  metrics,
  observations,
  calibrationText,
  visualStatus,
  vocalStatus = "טון הקול נותח מההקלטה"
}: {
  profile: CoupleProfile;
  metrics: NonverbalMetrics;
  observations: VisualObservation[];
  calibrationText: string;
  visualStatus: string;
  vocalStatus?: string;
}) {
  const recent = observations.filter((observation) => observation.label !== "capture-quality").slice(-8).reverse();

  return (
    <div className="panel nonverbal-panel">
      <div className="panel-heading">
        <h2>רמזים לא־מילוליים</h2>
        <Eye size={18} />
      </div>
      <p className="muted">{calibrationText}. המצלמה מתארת כיסוי ותנועה גאומטרית בלבד; היא אינה קובעת רגש או כוונה.</p>
      <div className="nonverbal-grid">
        <MiniMetric label="זמן שנדגם" value={metrics.analyzedSeconds ?? 0} raw />
        <MiniMetric label="לפחות פנים אחת נראתה" value={metrics.faceCoverageSeconds ?? 0} raw />
        <MiniMetric label="שתי פנים נראו" value={metrics.twoFaceCoverageSeconds ?? metrics.sharedFrameSeconds} raw />
        <MiniMetric label="לפחות גוף אחד נראה" value={metrics.poseCoverageSeconds ?? 0} raw />
      </div>
      <div className="nonverbal-summary">
        <span>
          תנועת גוף של {partnerName(profile, "A")}: <b>{formatDuration(metrics.bodyMovementSecondsA ?? 0)}</b>
        </span>
        <span>
          תנועת גוף של {partnerName(profile, "B")}: <b>{formatDuration(metrics.bodyMovementSecondsB ?? 0)}</b>
        </span>
        <span>
          שינויי כיוון ראש של {partnerName(profile, "A")}: <b>{formatDuration(metrics.headOrientationChangeSecondsA ?? 0)}</b>
        </span>
        <span>
          שינויי כיוון ראש של {partnerName(profile, "B")}: <b>{formatDuration(metrics.headOrientationChangeSecondsB ?? 0)}</b>
        </span>
        <span>
          זמן שבו הכיסוי לא הספיק למדידה מלאה: <b>{formatDuration(metrics.lowQualitySeconds ?? 0)}</b>
        </span>
      </div>
      <AdvancedEnginesPanel visualStatus={visualStatus} vocalStatus={vocalStatus} />
      <div className="visual-feed">
        {recent.length === 0 && <span>עדיין לא נדגמו רמזים לא־מילוליים.</span>}
        {recent.map((observation) => (
          <article key={observation.id}>
            <strong>{visualSignalLabel(observation.label)}</strong>
            <span>
              {observation.subject ? `${partnerName(profile, observation.subject)} · ` : ""}
              {formatTime(observation.seconds)}
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
  setView,
  onStartPractice
}: {
  profile: CoupleProfile;
  assessment: AssessmentState;
  sessions: SessionRecord[];
  safety: SafetyState;
  setView: (view: View) => void;
  onStartPractice: (launch: PracticeLaunch) => void;
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
  const todaySkill = resolveAdviserRecommendation({
    safetyFlag,
    floodingHigh,
    hasContemptRisk: risks.includes(CONTEMPT_RISK_LABEL),
    hasRepair,
    hasLatestSession: Boolean(latest),
    focusKey: focus?.key,
    focusLabel: focus?.label,
    focusPractice: focus?.practice
  });

  const modules = [
    {
      title: "זיהוי דפוסים מכאיבים",
      purpose: "מזהים ביקורת, זלזול, התגוננות והיסגרות לפני שהם משתלטים על השיחה.",
      detect: ["את/ה תמיד או אף פעם", "לעג או עליונות", "מתקפת נגד או תירוץ", "סגירות או התרחקות ממושכת"],
      doInstead: ["פתיחה רכה", "אמירת הערכה", "לקיחת אחריות על חלק קטן", "הפסקה מתוזמנת להרגעה"]
    },
    {
      title: "איפוס אחרי הצפה",
      purpose: "שומרים על היכולת לחשוב ולדבר כאשר הגוף והמערכת העצבית בעומס.",
      detect: ["דופק מהיר", "לחץ בחזה", "דחף לברוח", "קושי לחשוב בבהירות", "שינוי בקול או בתנוחה"],
      doInstead: ["הפסקה של 20 דקות", "הרגעה בלי לשחזר את המריבה", "חזרה עם משפט אכפתי אחד"]
    },
    {
      title: "החשבון הרגשי",
      purpose: "יוצרים מאגר של רגעים חיוביים שאפשר להישען עליו גם בזמן לחץ.",
      detect: ["פניות לקרבה שלא נענו", "מעט הערכה", "ייחוס כוונה רעה", "פחות מתן קרדיט"],
      doInstead: ["להיענות לפנייה קטנה", "לבצע היום חמש הפקדות", "לשים לב למאמץ סמוי", "לתקן רגע של התרחקות"]
    },
    {
      title: "חיבה והערכה",
      purpose: "מחדשים כבוד, אכפתיות, רומנטיקה ורצון טוב.",
      detect: ["מעט חום", "מעט מחמאות", "רואים בעיקר בעיות", "הרומנטיקה נעשתה טכנית"],
      doInstead: ["מחמאה מסוימת", "לשים לב למשהו שבן או בת הזוג עשו טוב", "לשתף זיכרון מעורר גאווה", "להודות בקול על מאמץ"]
    },
    {
      title: "שש מיומנויות למחלוקת",
      purpose: "עוברים ממחלוקת תקועה לשיחה שאפשר לעבוד איתה.",
      detect: ["הנושא חוזר שוב ושוב", "שניכם מתווכחים רק על עמדות", "אין בקשה ברורה", "ניסיון התיקון לא נקלט"],
      doInstead: [
        "פתיחה רכה",
        "בקשה אחת ברורה",
        "הקשבה וסיכום",
        "קבלת השפעה",
        "תיקון מוקדם",
        "הסכמה מסוימת אחת"
      ]
    },
    {
      title: "מתקיעות לחלומות שמתחתיה",
      purpose: "מגלים את הערך, הפחד, הזהות או החלום שנמצאים מתחת לנושא התקוע.",
      detect: ["אותה מריבה חוזרת", "הנושא מרגיש סמלי", "פשרה מרגישה כבגידה בעצמי"],
      doInstead: ["לשאול מה המשמעות", "לתת שם לחלום שמתחת", "להפריד בין גמיש למקודש", "לשמור קודם על הכבוד"]
    }
  ];

  return (
    <section className="stack">
      <div className="advisor-hero panel">
        <div>
          <h2>{todaySkill.title}</h2>
          <p>{todaySkill.body}</p>
        </div>
        <button className="primary" onClick={() => {
          if (todaySkill.destination === "safety") {
            setView("export");
            return;
          }
          onStartPractice({ deckId: todaySkill.deckId, cardIndex: todaySkill.cardIndex, source: "adviser" });
        }}>
          <Sparkles size={17} />
          {todaySkill.action}
        </button>
      </div>

      <section className="advisor-practice-picker" aria-labelledby="advisor-practice-picker-title">
        <div>
          <h2 id="advisor-practice-picker-title">בחרו את התרגול שמתאים לכם עכשיו</h2>
          <p>כל בחירה פותחת את השאלה והמצלמה באותו מסך.</p>
        </div>
        <div className="advisor-deck-list">
          {decks.map((deck) => (
            <button key={deck.id} onClick={() => onStartPractice({ deckId: deck.id, source: "adviser" })}>
              <span>{deck.title}</span>
              <small>{deck.purpose}</small>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <div className="two-col">
        <div className="panel">
          <div className="panel-heading">
            <h2>החוזקות הנוכחיות בקשר</h2>
            <HeartHandshake size={18} />
          </div>
          <ul className="plain-list">
            {(latest?.analysis.strengths ?? [
              "השלימו תרגול שיחה אחד כדי לזהות חוזקות מתוך השיחה.",
              `הפרופיל הזוגי של ${profile.partnerAName} ו${profile.partnerBName} שמור במכשיר.`,
              "האפליקציה מוכנה לעקוב לאורך זמן אחר תיקון, חום והקשבה."
            ]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>תרגול של עשר דקות להיום</h2>
            <BookOpenCheck size={18} />
          </div>
          <ol className="ordered-list">
            <li>אחד מעלה נושא מסוים בפתיחה רכה וללא האשמה.</li>
            <li>השני מסכם מה שמע לפני שהוא מגיב.</li>
            <li>שניכם אומרים דבר מסוים שהערכתם היום.</li>
            <li>מסיימים במשפט תיקון אחד שתוכלו להשתמש בו בפעם הבאה.</li>
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
              <strong>מה מזהים</strong>
              <div className="tag-cloud compact">
                {module.detect.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
            <div>
              <strong>מה עושים במקום</strong>
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

/**
 * Search across every saved conversation. All transcripts are local, so this is
 * a plain text match — it surfaces the couple's own words with a timestamp so
 * they can open the moment instead of relying on memory.
 */
function TranscriptSearchPanel({
  sessions,
  profile,
  onOpenMoment
}: {
  sessions: SessionRecord[];
  profile: CoupleProfile;
  onOpenMoment: (sessionId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchTranscripts(sessions, query, { limit: 12 }), [sessions, query]);
  const hasQuery = query.trim().length >= 2;

  return (
    <div className="transcript-search">
      <label className="transcript-search-field">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="מה אמרנו על…"
          aria-label="חיפוש בשיחות שנשמרו"
        />
      </label>
      {hasQuery && hits.length === 0 && <p className="muted transcript-search-empty">לא מצאנו את זה בשיחות שנשמרו.</p>}
      {hits.length > 0 && (
        <ul className="transcript-search-results">
          {hits.map((hit) => (
            <li key={`${hit.sessionId}-${hit.segmentId}`}>
              <button type="button" onClick={() => onOpenMoment(hit.sessionId)}>
                <span className="transcript-search-meta">
                  {hit.speakerKnown ? partnerName(profile, hit.speaker) : "לא ידוע מי אמר"}
                  {" · "}
                  <span dir="ltr">{formatTime(hit.seconds)}</span>
                  {" · "}
                  {hit.sessionTitle}
                </span>
                <span className="transcript-search-text" dir="auto">
                  {highlightPieces(hit.text, hit.ranges).map((piece, index) =>
                    piece.match ? <mark key={index}>{piece.text}</mark> : <span key={index}>{piece.text}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightsView({
  sessions,
  profile,
  setSessions
}: {
  sessions: SessionRecord[];
  profile: CoupleProfile;
  setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>>;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(sessions[0]?.id);
  const [correctionModel, setCorrectionModel] = useLocalState(storageKeys.ollamaModel, "gemma3:4b");
  const [correctionStatus, setCorrectionStatus] = useState("");
  const [correctionProposal, setCorrectionProposal] = useState<ReadonlyMap<string, string> | null>(null);
  const [correctionPending, setCorrectionPending] = useState(false);
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  const scoredSessions = sessions.filter((session) => session.analysis.dataQuality?.status !== "insufficient" && session.processingStatus !== "insufficient-data");
  const trend = scoredSessions.length
    ? Math.round(average(scoredSessions.map((session) => session.analysis.metrics.connectionPracticeScore)))
    : 0;

  useEffect(() => {
    if (!selectedId && sessions[0]) setSelectedId(sessions[0].id);
  }, [selectedId, sessions]);

  useEffect(() => {
    setCorrectionProposal(null);
    setCorrectionStatus("");
  }, [selected?.id]);

  const requestTranscriptCorrection = async () => {
    if (!selected?.segments.length || correctionPending) return;
    const sourceSegments = selected.segments.map((segment) => ({
      id: segment.id,
      text: segment.originalText ?? segment.text
    }));
    setCorrectionPending(true);
    setCorrectionProposal(null);
    setCorrectionStatus("בודקים את הניסוח במודל המקומי…");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: correctionModel,
          stream: false,
          format: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, text: { type: "string" } },
              required: ["id", "text"],
              additionalProperties: false
            },
            minItems: sourceSegments.length,
            maxItems: sourceSegments.length
          },
          options: { temperature: 0, num_predict: 900 },
          prompt: buildTranscriptCorrectionPrompt(sourceSegments)
        })
      });
      if (!response.ok) throw new Error("local-correction-unavailable");
      const data = (await response.json()) as { response?: string };
      const proposed = parseTranscriptCorrectionResponse(data.response ?? "", sourceSegments);
      const changed = new Map(
        [...proposed].filter(([id, text]) => text !== sourceSegments.find((segment) => segment.id === id)?.text)
      );
      if (changed.size === 0) {
        setCorrectionStatus("המודל המקומי לא הציע שינוי בטוח.");
        return;
      }
      setCorrectionProposal(changed);
      setCorrectionStatus(`${changed.size} תיקונים מוצעים לבדיקה. דבר לא ישתנה לפני אישור שלכם.`);
      void logDiagnostic({ name: "transcription.correction_proposed", status: "success", sessionId: selected.id, itemCount: changed.size });
    } catch (error) {
      const code = error instanceof TranscriptCorrectionError
        ? error.code
        : error instanceof DOMException && error.name === "AbortError"
          ? "timeout"
          : "local-model-unavailable";
      setCorrectionStatus(
        code === "timeout"
          ? "הבדיקה המקומית ארכה יותר מדי. אפשר לנסות שוב."
          : error instanceof TranscriptCorrectionError
            ? "ההצעה נדחתה כי היא שינתה יותר מדי או לא שמרה על משמעות הטקסט."
            : "הבדיקה המקומית אינה זמינה כרגע. ודאו ש־Ollama פועל ונסו שוב."
      );
      void logDiagnostic({ name: "transcription.correction_rejected", status: "error", sessionId: selected.id, errorCode: code });
    } finally {
      window.clearTimeout(timeoutId);
      setCorrectionPending(false);
    }
  };

  const acceptTranscriptCorrection = () => {
    if (!selected || !correctionProposal) return;
    const correctedSegments = selected.segments.map((segment) => {
      const correctedText = correctionProposal.get(segment.id);
      if (!correctedText || correctedText === segment.text) return segment;
      return {
        ...segment,
        originalText: segment.originalText ?? segment.text,
        text: correctedText,
        wordCount: spokenWordCount(correctedText),
        correction: {
          provider: "ollama-local" as const,
          modelId: correctionModel,
          correctedAt: new Date().toISOString(),
          reviewedByPartners: true as const
        }
      };
    });
    const analysis = analyzeSession(
      correctedSegments,
      selected.signals,
      selected.cues,
      selected.type,
      selected.visualObservations ?? [],
      selected.vocalObservations ?? []
    );
    setSessions((current) => current.map((session) => session.id === selected.id
      ? {
          ...session,
          segments: correctedSegments,
          analysis,
          processingStatus: analysis.dataQuality?.status === "insufficient" ? "insufficient-data" : "ready"
        }
      : session));
    setCorrectionProposal(null);
    setCorrectionStatus("התיקונים שאישרתם נשמרו, והסיכום חושב מחדש. התמלול המקורי נשמר לצפייה.");
    void logDiagnostic({ name: "transcription.correction_accepted", status: "success", sessionId: selected.id, itemCount: correctionProposal.size });
  };

  if (!sessions.length) {
    return (
      <div className="empty-large">
        <Activity size={44} />
        <h2>עדיין אין תובנות</h2>
        <p>שיחות שנשמרו יופיעו כאן לאחר שיהיה מספיק מידע לסיכום.</p>
      </div>
    );
  }

  return (
    <section className="insights-grid">
      <aside className="session-list">
        <div className="trend-card">
          <span>מדד תרגול ממוצע</span>
          <strong>{scoredSessions.length ? `${trend}%` : "—"}</strong>
        </div>
        <TranscriptSearchPanel
          sessions={sessions}
          profile={profile}
          onOpenMoment={(sessionId) => setSelectedId(sessionId)}
        />
        {sessions.map((session) => (
          <button
            className={`session-button ${selected?.id === session.id ? "active" : ""}`}
            key={session.id}
            onClick={() => setSelectedId(session.id)}
          >
            <strong>{session.title}</strong>
            <span>{formatTime(session.durationSeconds)} · {session.processingStatus === "insufficient-data" ? "אין מספיק מידע" : `${session.analysis.metrics.connectionPracticeScore}%`}</span>
          </button>
        ))}
      </aside>

      {selected && (
        <div className="stack">
          <div className="panel">
            <div className="panel-heading">
              <h2>{selected.title}</h2>
              {selected.processingStatus !== "insufficient-data" && <span className="score-chip">{selected.analysis.metrics.connectionPracticeScore}%</span>}
            </div>
            <GoldenMomentsReel session={selected} />
            {selected.media && (
              <div className="saved-media-block">
                <SessionMediaPlayer mediaKey={selected.media.key} title={selected.title} />
                <button
                  className="danger"
                  onClick={async () => {
                    if (!window.confirm("למחוק את הקלטת השיחה? התמלול והסיכום יישארו זמינים.")) return;
                    await deleteSessionMedia(selected.media!.key);
                    setSessions((current) => current.map((session) => session.id === selected.id ? { ...session, media: undefined } : session));
                    void logDiagnostic({ name: "recording.deleted", status: "success", sessionId: selected.id });
                  }}
                >
                  <Trash2 size={16} /> מחיקת ההקלטה
                </button>
              </div>
            )}
            <section className="saved-transcript-block" aria-labelledby={`saved-transcript-${selected.id}`}>
              <div className="saved-transcript-heading">
                <div>
                  <h3 id={`saved-transcript-${selected.id}`}>התמלול שנשמר</h3>
                  {selected.segments.length > 0 && (
                    <small>{selected.segments.reduce((sum, segment) => sum + (segment.wordCount ?? spokenWordCount(segment.text)), 0)} מילים</small>
                  )}
                </div>
                <Mic size={18} aria-hidden="true" />
              </div>
              <div className="transcript-list saved-transcript-list">
                {selected.segments.length > 0
                  ? <TranscriptSegments profile={profile} segments={selected.segments} tags={selected.analysis.tags} />
                  : <p className="muted">לא נשמר תמלול לשיחה הזו.</p>}
              </div>
              {selected.segments.length > 0 && (
                <div className="transcript-correction">
                  <div>
                    <strong>רוצים לבדוק את ניסוח התמלול?</strong>
                    <small>מודל מקומי יכול להציע תיקוני כתיב ופיסוק. הוא אינו משנה דבר בלי שתעברו על ההצעה ותאשרו אותה.</small>
                  </div>
                  <button className="secondary" onClick={requestTranscriptCorrection} disabled={correctionPending}>
                    <Sparkles size={16} aria-hidden="true" />
                    {correctionPending ? "בודקים…" : "הצעת תיקון מקומית"}
                  </button>
                  <details className="desktop-advanced">
                    <summary>בחירת מודל מקומי</summary>
                    <label>
                      מודל
                      <select value={correctionModel} onChange={(event) => setCorrectionModel(event.target.value)}>
                        {OLLAMA_MODEL_OPTIONS.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                    </label>
                  </details>
                  {correctionStatus && <p className="transcript-correction-status" role="status">{correctionStatus}</p>}
                  {correctionProposal && correctionProposal.size > 0 && (
                    <div className="transcript-correction-review" aria-label="תיקוני תמלול מוצעים">
                      {[...correctionProposal].map(([id, text]) => {
                        const original = selected.segments.find((segment) => segment.id === id);
                        if (!original) return null;
                        return (
                          <article key={id}>
                            <small>לפני</small>
                            <p dir="auto">{original.originalText ?? original.text}</p>
                            <small>מוצע</small>
                            <p dir="auto">{text}</p>
                          </article>
                        );
                      })}
                      <div className="transcript-correction-actions">
                        <button className="primary" onClick={acceptTranscriptCorrection}><Check size={16} aria-hidden="true" /> אישור התיקונים</button>
                        <button className="text-button" onClick={() => {
                          setCorrectionProposal(null);
                          setCorrectionStatus("ההצעה בוטלה; התמלול לא השתנה.");
                        }}>השארת התמלול כפי שהוא</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
            <section className="saved-analysis-block" aria-labelledby={`saved-analysis-${selected.id}`}>
              <h3 id={`saved-analysis-${selected.id}`}>מה זוהה בתמלול</h3>
              <p>{selected.analysis.summary}</p>
              <small>זהו סיכום לתרגול המבוסס על המידע שנשמר, לא קביעה על רגשות או כוונות.</small>
            </section>
            {selected.acousticMetrics && <section className="saved-analysis-block" aria-labelledby={`saved-acoustic-${selected.id}`}>
              <h3 id={`saved-acoustic-${selected.id}`}>קצב והפסקות שנמדדו</h3>
              <div className="metric-row wide">
                <MiniMetric label="דיבור שנקלט" value={Math.round(selected.acousticMetrics.speechSeconds)} raw />
                <MiniMetric label="הפסקות ארוכות" value={selected.acousticMetrics.longPauseCount} raw />
                <MiniMetric label="שינויי עוצמה יחסיים" value={selected.acousticMetrics.relativeLevelShiftCount} raw />
                {selected.acousticMetrics.estimatedWordsPerMinute && <MiniMetric label="מילים לדקה — הערכה" value={selected.acousticMetrics.estimatedWordsPerMinute} raw />}
              </div>
              <small>המדדים מתארים קול שנקלט במיקרופון; הם אינם מסיקים רגש או כוונה.</small>
            </section>}
            {(selected.vocalObservations?.length ?? 0) > 0 && (
              <section className="saved-analysis-block" aria-labelledby={`saved-vocal-${selected.id}`}>
                <h3 id={`saved-vocal-${selected.id}`}>טון הקול שנשמע</h3>
                <VocalTonePanel profile={profile} observations={selected.vocalObservations ?? []} />
              </section>
            )}
            {selected.closingReflection && (
              <section className="session-shared-step" aria-labelledby={`shared-step-${selected.id}`}>
                <HeartHandshake size={20} />
                <div>
                  <h3 id={`shared-step-${selected.id}`}>מה בחרתם יחד</h3>
                  {selected.closingReflection.feltGood && <p><strong>מה הרגיש טוב:</strong> {selected.closingReflection.feltGood}</p>}
                  {selected.closingReflection.remember && <p><strong>מה לזכור:</strong> {selected.closingReflection.remember}</p>}
                  <p><strong>הצעד הבא:</strong> {selected.closingReflection.nextStep}</p>
                  <small>{selected.followUp ? `בדקתם את הצעד בשיחה הבאה: ${followUpOutcomeLabel(selected.followUp.outcome)}.` : "נבדוק יחד איך הלך בתחילת השיחה הבאה."}</small>
                </div>
              </section>
            )}
            {selected.processingStatus !== "insufficient-data" && <div className="metric-row wide">
              {selected.analysis.metrics.speakerAttributionReliable !== false ? <>
                <MiniMetric label={`מילים — ${partnerName(profile, "A")}`} value={selected.analysis.metrics.wordsA} raw />
                <MiniMetric label={`מילים — ${partnerName(profile, "B")}`} value={selected.analysis.metrics.wordsB} raw />
              </> : <div className="speaker-attribution-note"><strong>שיוך הדוברים לא הושלם</strong><small>התמלול נשמר במלואו, אך לא נציג חלוקת מילים או איזון תורות בלי שיוך אמין.</small></div>}
              <MiniMetric label="ניסיונות תיקון" value={selected.analysis.metrics.repairSignals} raw />
              <MiniMetric label="דפוסים מכאיבים" value={selected.analysis.metrics.fourHorsemenSignals ?? 0} raw invert />
            </div>}
            {selected.processingStatus !== "insufficient-data" && <div className="metric-row wide">
              <MiniMetric label="פתיחות רכות" value={selected.analysis.metrics.softStartups ?? 0} raw />
              <MiniMetric label="רגעי תיקוף" value={selected.analysis.metrics.validationSignals ?? 0} raw />
              <MiniMetric label="פניות שנענו" value={selected.analysis.metrics.bidsOrTurningToward ?? 0} raw />
              {selected.analysis.metrics.speakerAttributionReliable !== false && <MiniMetric label="איזון תורות" value={selected.analysis.metrics.turnBalance} />}
            </div>}
          </div>

          {selected.processingStatus !== "insufficient-data" && <div className="two-col">
            <InsightList title="חוזקות שנצפו" items={selected.analysis.strengths} />
            <InsightList title="נקודות שכדאי לבדוק" items={selected.analysis.risks} />
          </div>}

          <div className="panel">
            <div className="panel-heading">
              <h2>רגעים המקושרים לראיות</h2>
              <ShieldCheck size={18} />
            </div>
            <div className="hit-list">
              {selected.analysis.hits.map((hit) => (
                <article key={hit.id} className={`hit ${hit.family}`}>
                  <span>{hit.label}</span>
                  <p>{hit.evidence}</p>
                  <small>{hit.suggestion}</small>
                </article>
              ))}
            </div>
          </div>

          <div className="panel">
            <TaggedTimeline profile={profile} tags={(selected.analysis.tags ?? []).slice(0, 24)} title="ציר זמן מסומן של השיחה" />
          </div>

          <div className="panel script-panel">
            <h2>נוסח מוצע לתרגול הבא</h2>
            <p>{selected.analysis.suggestedScript}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function SessionMediaPlayer({ mediaKey, title }: { mediaKey: string; title: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [status, setStatus] = useState("טוענים את ההקלטה המקומית…");

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    loadSessionMedia(mediaKey)
      .then((blob) => {
        if (!active) return;
        if (!blob) {
          setStatus("ההקלטה אינה זמינה עוד במכשיר הזה.");
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
        setStatus("");
      })
      .catch(() => active && setStatus("לא הצלחנו לפתוח את ההקלטה המקומית."));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaKey]);

  if (!source) return <p className="muted">{status}</p>;
  return <video className="saved-session-media" src={source} controls preload="metadata" aria-label={`הקלטת השיחה ${title}`} />;
}

/**
 * Replays the warm moments of a saved conversation. Nothing is re-encoded: the
 * clip is a seek window inside the recording that is already on the device, and
 * playback stops itself at the end of the window.
 */
function GoldenMomentsReel({ session }: { session: SessionRecord }) {
  const moments = useMemo(() => goldenMomentsForSession(session), [session]);
  const [source, setSource] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const mediaKey = session.media?.key;

  useEffect(() => {
    if (!mediaKey || moments.length === 0) return;
    let active = true;
    let objectUrl: string | null = null;
    loadSessionMedia(mediaKey)
      .then((blob) => {
        if (!active) return;
        if (!blob) {
          setStatus("ההקלטה כבר לא נמצאת במכשיר, אז אי אפשר להריץ את הרגעים.");
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => active && setStatus("לא הצלחנו לפתוח את ההקלטה."));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaKey, moments.length]);

  const playMoment = (moment: GoldenMoment) => {
    const video = videoRef.current;
    if (!video) return;
    stopAtRef.current = moment.endSeconds;
    setActiveId(moment.id);
    video.currentTime = moment.startSeconds;
    void video.play().catch(() => setStatus("הדפדפן לא הצליח להפעיל את הקטע."));
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || stopAtRef.current === null) return;
    if (video.currentTime >= stopAtRef.current) {
      video.pause();
      stopAtRef.current = null;
      setActiveId(null);
    }
  };

  if (moments.length === 0 || !mediaKey) return null;

  return (
    <section className="golden-moments" aria-label="רגעים טובים מהשיחה">
      <div className="golden-heading">
        <Sparkles size={18} aria-hidden="true" />
        <div>
          <strong>רגעים ששווה לראות שוב</strong>
          <small>קטעים קצרים מתוך ההקלטה שלכם, סביב מה שנשמע טוב בשיחה.</small>
        </div>
      </div>
      {source ? (
        <video
          ref={videoRef}
          className="golden-video"
          src={source}
          preload="metadata"
          playsInline
          controls
          onTimeUpdate={handleTimeUpdate}
          aria-label="נגן הרגעים הטובים"
        />
      ) : (
        <p className="muted">{status || "טוענים את ההקלטה…"}</p>
      )}
      <ul className="golden-list">
        {moments.map((moment) => (
          <li key={moment.id}>
            <button
              type="button"
              className={`golden-chip ${activeId === moment.id ? "is-playing" : ""}`}
              onClick={() => playMoment(moment)}
              disabled={!source}
            >
              <Play size={15} aria-hidden="true" />
              <span className="golden-chip-copy">
                <b>{moment.title}</b>
                <span className="golden-time" dir="ltr">{formatTime(moment.anchorSeconds)}</span>
              </span>
            </button>
            {moment.quote && <p className="golden-quote" dir="auto">“{moment.quote}”</p>}
          </li>
        ))}
      </ul>
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
    { key: "fearOrCoercion", label: "אחד מאיתנו מרגיש פחד או כפייה." },
    { key: "violenceOrThreats", label: "יש אלימות, איומים, מעקב או הפחדה." },
    { key: "pressuredToParticipate", label: "אחד מאיתנו מרגיש לחץ להקליט או לשתף." },
    { key: "seriousDepressionOrAddiction", label: "יש משבר פעיל, התמכרות או דיכאון חמור." }
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
      "סיכום Couple Lab לאיש או אשת מקצוע",
      `נוצר בתאריך: ${new Date().toLocaleString("he-IL")}`,
      `בני הזוג: ${profile.partnerAName} ו${profile.partnerBName}`,
      `מיקוד: ${profile.relationshipGoal}`,
      "",
      "בטיחות",
      safetyFlag ? "סומנה לפחות דאגת בטיחות אחת." : "לא סומנה דאגה בבדיקת הבטיחות.",
      "",
      "השיחה האחרונה",
      latest ? latest.title : "אין שיחות שמורות.",
      latest ? latest.analysis.summary : "",
      "",
      "חוזקות",
      ...(latest?.analysis.strengths ?? ["עדיין אין חוזקות מתוך שיחה שמורה."]),
      "",
      "נקודות שכדאי לבדוק",
      ...(latest?.analysis.risks ?? ["עדיין אין נקודות לבדיקה מתוך שיחה שמורה."]),
      "",
      "צעדים הבאים",
      ...(latest?.analysis.nextSteps ?? ["השלימו תרגול שיחה מודרך אחד."])
    ].join("\n");
    downloadBlob(`couple-lab-summary-${new Date().toISOString().slice(0, 10)}.txt`, content, "text/plain");
  };

  return (
    <section className="stack">
      <div className={`safety-review ${safetyFlag ? "alert" : ""}`}>
        <ShieldCheck size={22} />
        <div>
          <strong>{safetyFlag ? "התרגול הזוגי אינו מתאים כרגע." : safety.checkedAt ? "בדיקת הבטיחות הושלמה." : "בדיקת הבטיחות טרם הושלמה."}</strong>
          <p>
            כשיש פחד, כפייה, איום או משבר פעיל, עדיף לא להקליט או לקיים תרגול קונפליקט ולפנות לתמיכה מתאימה.
          </p>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-heading">
            <h2>המידע נשאר במחשב הזה</h2>
            <Lock size={18} />
          </div>
          <ul className="plain-list">
            <li>אתם בוחרים מתי לאפשר מצלמה ומיקרופון.</li>
            <li>הפרופיל, השיחות והתוצאות נשמרים רק במחשב הזה.</li>
            <li>שום דבר אינו יוצא מהמחשב בלי פעולה שלכם.</li>
          </ul>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>בדיקת בטיחות קצרה</h2>
            <ShieldCheck size={18} />
          </div>
          {safetyItems.map((item) => (
            <label className="check-row" key={item.key}>
              <input
                name={`safety-${item.key}`}
                type="checkbox"
                checked={Boolean(safety[item.key])}
                onChange={(event) => setSafety({ ...safety, [item.key]: event.target.checked, checkedAt: undefined })}
              />
              {item.label}
            </label>
          ))}
          <button className="primary full" onClick={() => setSafety({ ...safety, checkedAt: new Date().toISOString() })}>
            <Check size={17} /> שמירת בדיקת הבטיחות
          </button>
        </div>
      </div>

      <div className="panel export-panel">
        <div className="panel-heading">
          <h2>הנתונים שלי</h2>
          <FileDown size={18} />
        </div>
        <div className="export-actions">
          <button className="primary" onClick={exportJson}>
            <Download size={17} />
            הורדת עותק מלא
          </button>
          <button className="secondary" onClick={exportSummary}>
            <FileDown size={17} />
            הורדת סיכום טקסט
          </button>
          <button className="danger" onClick={clearAll}>
            <Trash2 size={17} />
            מחיקת כל המידע המקומי
          </button>
        </div>
      </div>
    </section>
  );
}

function DiagnosticsView() {
  const [events, setEvents] = useState<DiagnosticEventRecord[]>([]);
  const [status, setStatus] = useState("טוענים את היסטוריית הפעילות…");

  const refresh = async () => {
    try {
      const next = await getDiagnostics();
      setEvents(next);
      setStatus(next.length ? `${next.length} אירועים טכניים שמורים` : "עדיין אין אירועים טכניים");
    } catch {
      setStatus("האבחון המקומי אינו זמין בדפדפן הזה");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="stack diagnostics-view">
      <div className="panel diagnostics-intro">
        <div>
          <h2>היסטוריית פעילות טכנית</h2>
          <p>כאן מוצגים שלבי הפעילות, זמני ביצוע ושגיאות. תוכן השיחה, ההקלטה והתמלול אינם נכללים בלוג.</p>
        </div>
        <span className="status-dot">{status}</span>
      </div>
      <div className="panel diagnostic-timeline">
        {events.length === 0 && <div className="empty-state"><p>לא נאספו עדיין אירועים. התחילו תרגול בדיקה וחזרו לכאן.</p></div>}
        {events.map((event) => (
          <article className={`diagnostic-event ${event.status}`} key={event.id}>
            <span aria-hidden="true" />
            <div>
              <strong>{diagnosticEventLabel(event.name)}</strong>
              <small dir="ltr">{new Date(event.timestamp).toLocaleString("he-IL")}</small>
            </div>
            <em>
              {diagnosticDetailLabel(event.phase ?? event.errorCode ?? event.status)}
              {event.durationMs !== undefined ? ` · ${event.durationMs}ms` : ""}
              {event.itemCount !== undefined ? ` · ${event.itemCount} פריטים` : ""}
              {event.language ? ` · ${diagnosticDetailLabel(event.language)}` : ""}
            </em>
          </article>
        ))}
      </div>
      <div className="panel export-actions">
        <button className="secondary" onClick={() => downloadBlob(`couple-lab-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(events, null, 2))} disabled={!events.length}>
          <Download size={17} /> ייצוא לוג מסונן
        </button>
        <button className="secondary" onClick={() => void refresh()}><RefreshCw size={17} /> רענון</button>
        <button className="danger" onClick={async () => { await clearDiagnostics(); await refresh(); }} disabled={!events.length}>
          <Trash2 size={17} /> מחיקת הלוגים
        </button>
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
