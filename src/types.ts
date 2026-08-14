export type PartnerId = "A" | "B";

export type SpeechLanguage = "he-IL" | "en-US";

export type SessionType =
  | "daily-check-in"
  | "conflict"
  | "repair"
  | "intimacy"
  | "shared-meaning";

export type CueTone =
  | "warmth"
  | "repair"
  | "humor"
  | "look-away"
  | "overwhelm"
  | "pause"
  | "softening";

export type VisualSignalLabel =
  | "face-visible"
  | "warm-expression"
  | "brow-tension"
  | "mouth-tension"
  | "looking-away"
  | "partner-gaze"
  | "mutual-attention"
  | "shared-frame"
  | "body-visible"
  | "closed-posture"
  | "leaning-away"
  | "head-turned-away"
  | "sustained-warmth"
  | "sustained-tension"
  | "possible-engagement"
  | "possible-withdrawal";

export interface CoupleProfile {
  partnerAName: string;
  partnerBName: string;
  relationshipGoal: string;
  visualCalibration?: {
    A: "left" | "right";
    B: "left" | "right";
    calibratedAt: string;
    note: string;
  };
  createdAt: string;
}

export interface AssessmentDomain {
  key: string;
  label: string;
  description: string;
  practice: string;
}

export interface PartnerAssessment {
  [domainKey: string]: number;
}

export interface AssessmentState {
  A: PartnerAssessment;
  B: PartnerAssessment;
  updatedAt?: string;
}

export interface Deck {
  id: string;
  title: string;
  lens: "Gottman-inspired" | "Perel-inspired" | "Practice";
  purpose: string;
  cards: string[];
}

export interface TranscriptSegment {
  id: string;
  speaker: PartnerId;
  target?: PartnerId;
  text: string;
  seconds: number;
  endSeconds?: number;
  source: "speech" | "manual";
  detectedLanguage?: SpeechLanguage | "unknown";
  wordCount?: number;
}

export interface LiveCue {
  id: string;
  speaker: PartnerId;
  tone: CueTone;
  seconds: number;
}

export interface VisualObservation {
  id: string;
  seconds: number;
  label: VisualSignalLabel;
  subject?: PartnerId;
  score: number;
  evidence: string;
  provider?: "mediapipe" | "openface" | "libreface" | "emotieff" | "derived";
  metadata?: Record<string, string | number | boolean>;
}

export interface NonverbalMetrics {
  sampleCount: number;
  sharedFrameSeconds: number;
  mutualAttentionSeconds: number;
  partnerGazeSecondsA: number;
  partnerGazeSecondsB: number;
  lookAwaySecondsA: number;
  lookAwaySecondsB: number;
  warmExpressionSeconds: number;
  tensionSeconds: number;
  engagementSeconds: number;
  withdrawalSeconds: number;
}

export interface EmotionalStateScores {
  warmth: number;
  engagement: number;
  tension: number;
  flooding: number;
  withdrawal: number;
  repairReadiness: number;
}

export interface BodySignals {
  A: {
    stress: number;
    heartRate?: number;
    relaxed: number;
  };
  B: {
    stress: number;
    heartRate?: number;
    relaxed: number;
  };
}

export interface PatternHit {
  id: string;
  label: string;
  family: "strength" | "risk" | "repair" | "body";
  speaker?: PartnerId;
  target?: PartnerId;
  seconds?: number;
  endSeconds?: number;
  source?: "transcript" | "manual-cue" | "visual" | "derived";
  segmentId?: string;
  cueId?: string;
  observationId?: string;
  evidence: string;
  suggestion: string;
  confidence: number;
}

export type InteractionTagFamily =
  | "four-horsemen"
  | "repair"
  | "strength"
  | "flooding"
  | "turn-taking"
  | "nonverbal"
  | "desire"
  | "conversation-structure";

export interface InteractionTag {
  id: string;
  label: string;
  family: InteractionTagFamily;
  source: "transcript" | "manual-cue" | "visual" | "derived";
  seconds: number;
  endSeconds?: number;
  speaker?: PartnerId;
  target?: PartnerId;
  segmentId?: string;
  cueId?: string;
  observationId?: string;
  evidence: string;
  suggestion?: string;
  confidence: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface SessionMetrics {
  wordsA: number;
  wordsB: number;
  turnBalance: number;
  positiveSignals: number;
  riskSignals: number;
  repairSignals: number;
  floodingRisk: number;
  connectionPracticeScore: number;
  emotionalState: EmotionalStateScores;
  fourHorsemenSignals: number;
  contemptSignals: number;
  softStartups: number;
  validationSignals: number;
  emotionalBankDeposits: number;
  bidsOrTurningToward: number;
  interruptionRisks: number;
  nonverbalStressSignals: number;
}

export interface SessionAnalysis {
  summary: string;
  metrics: SessionMetrics;
  strengths: string[];
  risks: string[];
  nextSteps: string[];
  suggestedScript: string;
  hits: PatternHit[];
  tags: InteractionTag[];
}

export interface SessionRecord {
  id: string;
  title: string;
  type: SessionType;
  startedAt: string;
  durationSeconds: number;
  segments: TranscriptSegment[];
  cues: LiveCue[];
  visualObservations: VisualObservation[];
  nonverbalMetrics?: NonverbalMetrics;
  signals: BodySignals;
  analysis: SessionAnalysis;
}

export interface SafetyState {
  fearOrCoercion: boolean;
  violenceOrThreats: boolean;
  pressuredToParticipate: boolean;
  seriousDepressionOrAddiction: boolean;
  checkedAt?: string;
}

export interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
