export type PartnerId = "A" | "B";

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
  | "possible-withdrawal"
  | "capture-quality"
  | "smile-configuration"
  | "brow-movement"
  | "mouth-press"
  | "eyes-turned-sideways"
  | "head-orientation-offset"
  | "head-orientation-change"
  | "wrists-near-opposite-shoulders"
  | "body-near-frame-edge"
  | "body-movement";

export interface CoupleProfile {
  partnerAName: string;
  partnerBName: string;
  relationshipGoal: string;
  partnerPhotos?: Partial<Record<PartnerId, string>>;
  visualCalibration?: {
    A: "left" | "right";
    B: "left" | "right";
    calibratedAt: string;
    note: string;
    snapshotDataUrl?: string;
  };
  recordingConsent?: {
    version: 1;
    grantedAt: string;
    scope: "all-local-practice-recordings";
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
  completedBy?: Partial<Record<PartnerId, string>>;
  schemaVersion?: 2;
}

export interface Deck {
  id: string;
  title: string;
  lens: string;
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
  speakerAttribution?: "automatic" | "manual" | "unknown";
  detectedLanguage?: "he-IL" | "en-US" | "unknown";
  wordCount?: number;
  transcriptionMetadata?: TranscriptTranscriptionMetadata;
  /** Immutable first ASR/manual text retained when a reviewed correction is accepted. */
  originalText?: string;
  correction?: {
    provider: "ollama-local" | "cloud-anthropic";
    modelId: string;
    correctedAt: string;
    reviewedByPartners: true;
  };
}

export type TranscriptionConfidenceLevel = "high" | "medium" | "low" | "unknown";

export interface TranscriptionQualityMetadata {
  /** A token-probability proxy from the ASR model, not calibrated accuracy. */
  confidenceProxy?: number;
  confidenceLevel: TranscriptionConfidenceLevel;
  averageLogProbability?: number;
  tokenCount: number;
  timestampCount?: number;
}

export interface TranscriptTranscriptionMetadata extends TranscriptionQualityMetadata {
  modelId: string;
  vadModelId?: string;
  segmentation: "silero-vad" | "full-audio-fallback";
}

export interface TranscriptionSpeechSegment {
  startSeconds: number;
  endSeconds: number;
}

export interface LocalTranscriptionSegment extends TranscriptionSpeechSegment {
  text: string;
  language: "he-IL" | "en-US";
  quality: TranscriptionQualityMetadata;
}

export interface LocalTranscriptionMetadata {
  modelId: string;
  vadModelId?: string;
  segmentation: "silero-vad" | "full-audio-fallback";
  vadApplied: boolean;
  fallbackReason?: string;
  audioDurationSeconds: number;
  speechSeconds: number | null;
  silenceSeconds: number | null;
  speechCoverage: number | null;
  detectedSpeechSegmentCount: number;
  transcriptSegmentCount: number;
  quality: TranscriptionQualityMetadata;
}

export interface LocalTranscriptionResult {
  text: string;
  language: "he-IL" | "en-US";
  /** Optional for compatibility with desktop builds that return only text/language. */
  segments?: LocalTranscriptionSegment[];
  speechSegments?: TranscriptionSpeechSegment[];
  metadata?: LocalTranscriptionMetadata;
}

export interface StoredTranscriptionMetadata extends LocalTranscriptionMetadata {
  speechSegments: TranscriptionSpeechSegment[];
}

export interface AcousticInterval {
  startSeconds: number;
  endSeconds: number;
}

export interface AcousticMetrics {
  provider: "local-energy-v1";
  durationSeconds: number;
  speechSeconds: number;
  silenceSeconds: number;
  speechCoverage: number;
  speechIntervalCount: number;
  longPauseCount: number;
  medianPauseSeconds: number;
  longestPauseSeconds: number;
  relativeLevelShiftCount: number;
  estimatedWordsPerMinute?: number;
  quality: {
    status: "usable" | "limited" | "insufficient";
    noiseFloorDb: number;
    medianSpeechLevelDb?: number;
    levelRangeDb?: number;
    clippingRatio: number;
  };
  longPauses: AcousticInterval[];
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

/**
 * Live vocal (prosody) states, read from the audio signal itself rather than
 * the words. Each maps to an interaction family the way visual signals do.
 */
export type VocalStateLabel =
  | "raised-voice"
  | "tense-voice"
  | "flat-withdrawn"
  | "warm-engaged"
  | "long-pause";

export interface VocalObservation {
  id: string;
  seconds: number;
  label: VocalStateLabel;
  subject?: PartnerId;
  score: number;
  evidence: string;
  provider?: "local-prosody-v1";
  metadata?: Record<string, string | number | boolean>;
}

/**
 * A Gottman-informed written reflection produced by an opt-in cloud model on
 * the corrected transcript text. It is an aid for practice, framed as
 * observations and never as a verdict on emotion, intent, or the relationship.
 */
export interface CloudReflection {
  summary: string;
  strengths: string[];
  risks: string[];
  nextSteps: string[];
  provider: string;
  model: string;
  createdAt: string;
}

export interface NonverbalMetrics {
  sampleCount: number;
  analyzedSeconds?: number;
  faceCoverageSeconds?: number;
  twoFaceCoverageSeconds?: number;
  poseCoverageSeconds?: number;
  lowQualitySeconds?: number;
  headOrientationChangeSecondsA?: number;
  headOrientationChangeSecondsB?: number;
  bodyMovementSecondsA?: number;
  bodyMovementSecondsB?: number;
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
  source?: "transcript" | "manual-cue" | "visual" | "vocal" | "derived";
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
  source: "transcript" | "manual-cue" | "visual" | "vocal" | "derived";
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
  speakerAttributionReliable?: boolean;
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
  dataQuality?: {
    status: "insufficient" | "sufficient";
    reasons: string[];
    evidenceCount: number;
  };
}

export interface SessionMediaRef {
  storage: "indexeddb";
  key: string;
  mimeType: string;
  sizeBytes: number;
  savedAt: string;
}

export interface SessionRecord {
  schemaVersion?: 2;
  id: string;
  title: string;
  type: SessionType;
  startedAt: string;
  durationSeconds: number;
  segments: TranscriptSegment[];
  transcriptionMetadata?: StoredTranscriptionMetadata;
  acousticMetrics?: AcousticMetrics;
  cues: LiveCue[];
  visualObservations: VisualObservation[];
  vocalObservations?: VocalObservation[];
  cloudReflection?: CloudReflection;
  nonverbalMetrics?: NonverbalMetrics;
  signals: BodySignals;
  analysis: SessionAnalysis;
  media?: SessionMediaRef;
  processingStatus?: "ready" | "insufficient-data";
  closingReflection?: {
    feltGood: string;
    remember: string;
    nextStep: string;
    completedAt: string;
  };
  followUp?: {
    outcome: "helped" | "partly" | "not-yet" | "not-fit";
    checkedAt: string;
  };
}

export interface SafetyState {
  fearOrCoercion: boolean;
  violenceOrThreats: boolean;
  pressuredToParticipate: boolean;
  seriousDepressionOrAddiction: boolean;
  checkedAt?: string;
}

export interface BiometricTemplate {
  modelId: string;
  vector: number[];
  capturedAt: string;
  quality?: number;
}

export interface PartnerBiometricEnrollment {
  partnerId: PartnerId;
  displayName: string;
  faceTemplates: BiometricTemplate[];
  voiceTemplates: BiometricTemplate[];
  updatedAt: string;
}

export interface BiometricEnrollmentState {
  schemaVersion: 1;
  partners: Partial<Record<PartnerId, PartnerBiometricEnrollment>>;
}

export interface PartnerBiometricSummary {
  displayName: string;
  faceTemplateCount: number;
  voiceTemplateCount: number;
  updatedAt: string;
}

export interface BiometricEnrollmentSummary {
  schemaVersion: 1;
  partners: Partial<Record<PartnerId, PartnerBiometricSummary>>;
}

export interface DesktopRuntimeInfo {
  isDesktop: true;
  isPackaged: boolean;
  platform: string;
  version: string;
  dataDirectory: string;
  biometricEncryption: "os" | "unavailable";
}

export interface VoiceModelStatus {
  ready: boolean;
  dimensions: number;
  modelId: string;
  error?: string;
}

export interface TranscriptionModelStatus {
  ready: boolean;
  modelId: string;
  vadReady?: boolean;
  vadModelId?: string;
  error?: string;
}

export interface CoupleLabDesktopBridge {
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  getBiometricEnrollmentSummary: () => Promise<BiometricEnrollmentSummary>;
  loadBiometricEnrollment: () => Promise<BiometricEnrollmentState>;
  saveBiometricEnrollment: (state: BiometricEnrollmentState) => Promise<BiometricEnrollmentSummary>;
  clearBiometricEnrollment: (partnerId?: PartnerId) => Promise<BiometricEnrollmentState>;
  getVoiceModelStatus: () => Promise<VoiceModelStatus>;
  extractVoiceEmbedding: (samples: Float32Array) => Promise<{ vector: number[]; dimensions: number }>;
  getTranscriptionModelStatus: () => Promise<TranscriptionModelStatus>;
  transcribeAudio: (samples: Float32Array, language: "he-IL" | "en-US") => Promise<LocalTranscriptionResult>;
  /** Downloads and activates a stronger local transcription pack. Desktop only. */
  installTranscriptionModel?: (model: "turbo" | "small") => Promise<{ ok: boolean; modelId: string }>;
  /** Subscribes to install progress. Returns an unsubscribe function. */
  onTranscriptionModelProgress?: (
    listener: (progress: TranscriptionModelInstallProgress) => void
  ) => () => void;
  /**
   * Optional cloud (bring-your-own-key) text analysis, routed through the
   * Electron main process. Desktop only, opt-in, text-only — never recordings.
   */
  saveCloudKey?: (provider: "anthropic", key: string) => Promise<CloudKeyStatus>;
  getCloudKeyStatus?: () => Promise<CloudKeyStatus>;
  clearCloudKey?: () => Promise<CloudKeyStatus>;
  cloudComplete?: (request: CloudCompletionRequest) => Promise<CloudCompletionResult>;
}

export interface CloudKeyStatus {
  hasKey: boolean;
  provider?: string;
  error?: string;
}

export interface CloudCompletionRequest {
  system?: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

export interface CloudCompletionResult {
  text: string;
  model: string;
}

export interface TranscriptionModelInstallProgress {
  stage: string;
  receivedBytes: number;
  totalBytes: number;
  skipped?: boolean;
}

export interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
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
    coupleLabDesktop?: CoupleLabDesktopBridge;
  }
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
