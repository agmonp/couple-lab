import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Camera, CheckCircle2, Mic, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { inspectAudioQuality, resampleAudio } from "./biometricQuality";
import {
  appendCalibrationSample,
  calibrationMessage,
  evaluateCalibrationSample
} from "./transcriptionCalibration";
import { incompleteBiometricPartners } from "./biometricReadiness";
import { domains } from "./data";
import { logDiagnostic } from "./localStore";
import { createFaceDescriptor, FACE_DESCRIPTOR_MODEL_ID, faceCaptureQuality } from "./faceDescriptor";
import { getVisionAssetUrls } from "./visionAssets";
import type {
  AssessmentDomain,
  AssessmentState,
  BiometricEnrollmentState,
  BiometricTemplate,
  CoupleProfile,
  PartnerBiometricEnrollment,
  PartnerId
} from "./types";

const FACE_POSES = [
  "הביטו ישר למצלמה",
  "סובבו מעט את הראש שמאלה",
  "סובבו מעט את הראש ימינה",
  "חזרו להביט ישר למצלמה"
] as const;
const VOICE_SECONDS = 8;
const FACE_HOLD_MS = 1200;

/**
 * Builds the two sentences a person reads aloud during enrollment.
 *
 * These do double duty: they train the voice template *and*, because the text
 * is known in advance, they measure transcription accuracy automatically. So
 * they are written from what the app already knows — both partners' names and
 * the domains this person scored lowest and highest on the relationship map.
 * That makes the read personal and relevant instead of generic boilerplate,
 * and it exercises exactly the vocabulary these two actually use in practice.
 *
 * Everything stays fully Hebrew: a Latin word would be scored as an error by
 * the calibration and would distort the measurement.
 */
function voicePrompts(
  profile: CoupleProfile,
  assessment: AssessmentState | undefined,
  partnerId: PartnerId
): string[] {
  const name = partnerName(profile, partnerId);
  const partner = partnerId === "A" ? "B" : "A";
  const otherName = partnerName(profile, partner);
  const hasNames = Boolean(profile.partnerAName && profile.partnerBName);
  const opening = hasNames
    ? `שמי ${name}, ואני מתרגל או מתרגלת שיחה זוגית יחד עם ${otherName}.`
    : `שמי ${name}, ואני מתרגל או מתרגלת שיחה זוגית רגועה.`;

  const scores = assessment?.[partnerId] ?? {};
  const answered = domains
    .map((domain) => ({ domain, score: scores[domain.key] }))
    .filter((entry): entry is { domain: AssessmentDomain; score: number } => typeof entry.score === "number");

  if (answered.length < 2) {
    return [
      opening,
      "כשאני רוצה שיקשיבו לי, עוזר לי לדבר בקצב רגוע, להסביר מה חשוב לי ולתת מקום גם לאדם שמולי."
    ];
  }

  const sorted = [...answered].sort((first, second) => first.score - second.score);
  const weakest = sorted[0].domain;
  const strongest = sorted[sorted.length - 1].domain;

  return [
    opening,
    `בשאלון סימנתי ש${strongest.label} עובד אצלנו טוב, ושהייתי רוצה לחזק את הנושא של ${weakest.label}.`
  ];
}

function mediaPermissionMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return "לא הצלחנו לפתוח את המצלמה והמיקרופון. בדקו שהם מחוברים ונסו שוב.";
  }
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "הגישה למצלמה או למיקרופון נחסמה. אשרו אותה בהגדרות הפרטיות של המחשב ונסו שוב.";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "לא נמצאו מצלמה ומיקרופון זמינים במחשב.";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "המצלמה או המיקרופון בשימוש באפליקציה אחרת. סגרו אותה ונסו שוב.";
  }
  return "לא הצלחנו לפתוח את המצלמה והמיקרופון. בדקו שהם מחוברים ונסו שוב.";
}

function partnerName(profile: CoupleProfile, partnerId: PartnerId) {
  return partnerId === "A" ? profile.partnerAName || "שותף/ה א׳" : profile.partnerBName || "שותף/ה ב׳";
}

function joinAudio(chunks: Float32Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Float32Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export function BiometricEnrollmentWizard({
  profile,
  assessment,
  initialPartnerId = "A",
  singlePartner = false,
  onProfilePhotoCaptured,
  onClose,
  onSaved,
  onComplete,
  completionActionLabel
}: {
  profile: CoupleProfile;
  assessment?: AssessmentState;
  initialPartnerId?: PartnerId;
  singlePartner?: boolean;
  onProfilePhotoCaptured?: (partnerId: PartnerId, dataUrl: string) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onComplete?: () => void;
  completionActionLabel?: string;
}) {
  const [phase, setPhase] = useState<"preparing" | "face" | "voice" | "complete" | "error">("preparing");
  const [partnerId, setPartnerId] = useState<PartnerId>(initialPartnerId);
  const [faceTemplates, setFaceTemplates] = useState<BiometricTemplate[]>([]);
  const [voiceTemplates, setVoiceTemplates] = useState<BiometricTemplate[]>([]);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [faceCaptureProgress, setFaceCaptureProgress] = useState(0);
  const [faceCapturedPulse, setFaceCapturedPulse] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const profilePhotoRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const preparationPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      faceLandmarkerRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (singlePartner || !window.coupleLabDesktop) return;
    void window.coupleLabDesktop.loadBiometricEnrollment().then((enrollment) => {
      if (!mountedRef.current) return;
      const incomplete = incompleteBiometricPartners(enrollment);
      if (!incomplete.includes(initialPartnerId) && incomplete[0]) setPartnerId(incomplete[0]);
    }).catch(() => undefined);
  }, [initialPartnerId, singlePartner]);

  useEffect(() => {
    if (!videoRef.current || !mediaStream) return;
    videoRef.current.srcObject = mediaStream;
    void videoRef.current.play();
  }, [mediaStream, phase]);

  const prepare = async () => {
    if (preparationPromiseRef.current) return preparationPromiseRef.current;
    const preparation = (async () => {
    setPhase("preparing");
    setMessage("פותח את המצלמה והמיקרופון…");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
    } catch (error) {
      setPhase("error");
      setMessage(mediaPermissionMessage(error));
      preparationPromiseRef.current = null;
      return;
    }

    setMessage("עוד רגע מתחילים…");
    try {
      const assets = getVisionAssetUrls();
      const vision = await FilesetResolver.forVisionTasks(assets.wasmRoot);
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          delegate: "CPU",
          modelAssetPath: assets.faceModel
        },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFaceBlendshapes: false
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        landmarker.close();
        return;
      }
      faceLandmarkerRef.current = landmarker;
      streamRef.current = stream;
      setMediaStream(stream);
      setPhase("voice");
      setMessage("");
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      setPhase("error");
      setMessage("לא הצלחנו להכין את הזיהוי. סגרו ופתחו מחדש את האפליקציה ונסו שוב.");
      preparationPromiseRef.current = null;
    }
    })();
    preparationPromiseRef.current = preparation;
    void preparation.finally(() => {
      if (!streamRef.current) preparationPromiseRef.current = null;
    });
    return preparation;
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void prepare(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const createProfilePhoto = (video: HTMLVideoElement) => {
    const size = Math.min(video.videoWidth, video.videoHeight);
    if (!size) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const sourceX = (video.videoWidth - size) / 2;
    const sourceY = (video.videoHeight - size) / 2;
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, sourceX, sourceY, size, size, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  };

  const captureFace = async () => {
    const video = videoRef.current;
    const landmarker = faceLandmarkerRef.current;
    if (working) return;
    if (!video || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setMessage("המצלמה עדיין מתכוננת. נסו שוב בעוד רגע.");
      return;
    }
    setWorking(true);
    setFaceCaptureProgress(0);
    setMessage("הישארו בתנוחה והביטו לפי ההנחיה…");
    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      setFaceCaptureProgress(Math.min(96, ((performance.now() - startedAt) / FACE_HOLD_MS) * 100));
    }, 80);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, FACE_HOLD_MS));
      const result = landmarker.detect(video);
      if (result.faceLandmarks.length !== 1) {
        setMessage("צריך פנים ברורות של אדם אחד בלבד במסגרת.");
        return;
      }
      const landmarks = result.faceLandmarks[0];
      const quality = faceCaptureQuality(landmarks);
      if (quality < 0.58) {
        setMessage("הפנים קטנות או רחוקות מהמרכז. התקרבו מעט ונסו שוב.");
        return;
      }
      const template: BiometricTemplate = {
        modelId: FACE_DESCRIPTOR_MODEL_ID,
        vector: createFaceDescriptor(landmarks),
        capturedAt: new Date().toISOString(),
        quality
      };
      const nextFaceTemplates = [...faceTemplates, template];
      setFaceTemplates(nextFaceTemplates);
      const profilePhoto = profilePhotoRef.current || createProfilePhoto(video);
      profilePhotoRef.current = profilePhoto;
      setFaceCaptureProgress(100);
      setFaceCapturedPulse(true);
      const nextIndex = nextFaceTemplates.length;
      if (nextIndex < FACE_POSES.length) {
        setMessage(`התמונה נקלטה. עכשיו: ${FACE_POSES[nextIndex]}.`);
      } else {
        setMessage("הכול נקלט. שומרים את הזיהוי…");
        await savePartner(nextFaceTemplates, voiceTemplates, profilePhoto);
      }
      window.setTimeout(() => mountedRef.current && setFaceCapturedPulse(false), 900);
    } catch {
      setMessage("התמונה לא נקלטה היטב. נסו שוב בתאורה אחידה.");
    } finally {
      window.clearInterval(interval);
      window.setTimeout(() => mountedRef.current && setFaceCaptureProgress(0), 450);
      if (mountedRef.current) setWorking(false);
    }
  };

  const recordVoice = async () => {
    if (!mediaStream || working || !window.coupleLabDesktop) return;
    setWorking(true);
    setMessage("קראו את המשפט בקול טבעי עד שההקלטה מסתיימת.");
    // 16kHz capture lets the browser do properly band-limited resampling and
    // makes the fallback linear resampler a no-op.
    let audioContext: AudioContext;
    try {
      audioContext = new AudioContext({ sampleRate: 16000 });
    } catch {
      audioContext = new AudioContext();
    }
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentOutput = audioContext.createGain();
    const chunks: Float32Array[] = [];
    silentOutput.gain.value = 0;
    processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    setRecordingSeconds(VOICE_SECONDS);
    const interval = window.setInterval(() => setRecordingSeconds((value) => Math.max(0, value - 1)), 1000);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, VOICE_SECONDS * 1000));
      const inputRate = audioContext.sampleRate;
      const samples = resampleAudio(joinAudio(chunks), inputRate, 16000);
      const quality = inspectAudioQuality(samples, 16000);
      if (!quality.acceptable) {
        setMessage("הדוגמה הייתה קצרה, חלשה או כללה יותר מדי שקט. דברו קרוב יותר למיקרופון ונסו שוב.");
        return;
      }
      setMessage("בודק שהקול נקלט היטב…");
      const result = await window.coupleLabDesktop.extractVoiceEmbedding(samples);
      const nextVoiceTemplates = [...voiceTemplates, {
        modelId: "3dspeaker-campplus-common-16k-v1",
        vector: result.vector,
        capturedAt: new Date().toISOString(),
        quality: quality.score
      }];
      setVoiceTemplates(nextVoiceTemplates);

      // Automatic transcription calibration: the sentence just read aloud is
      // known in advance, so transcribing the same recording yields a WER
      // baseline for this person and model — no manual transcription needed.
      let calibrationNote = "";
      try {
        setMessage("בודקים גם את איכות התמלול…");
        const promptText = prompts[Math.min(voiceTemplates.length, prompts.length - 1)];
        const transcription = await window.coupleLabDesktop.transcribeAudio(samples, "he-IL");
        const evaluation = evaluateCalibrationSample(promptText, transcription.text);
        appendCalibrationSample({
          partnerId,
          ...evaluation,
          capturedAt: new Date().toISOString(),
          modelId: transcription.metadata?.modelId
        });
        calibrationNote = ` ${calibrationMessage(evaluation)}`;
        void logDiagnostic({
          name: "transcription.calibrated",
          status: "success",
          phase: transcription.metadata?.modelId ?? "unknown",
          // Word error rate as a percentage; no transcript content is logged.
          itemCount: Math.round(evaluation.wer * 100)
        });
      } catch (error) {
        // Calibration is best-effort; enrollment continues without it.
        void logDiagnostic({
          name: "transcription.calibration_failed",
          status: "error",
          errorCode: error instanceof Error ? error.message : "calibration-failed"
        });
      }

      if (nextVoiceTemplates.length >= 2) {
        setPhase("face");
        setMessage(`הקול נקלט מצוין.${calibrationNote} עכשיו נצלם כמה תמונות קצרות.`);
      } else {
        setMessage(`הקול נקלט.${calibrationNote} עכשיו נקרא משפט נוסף.`);
      }
    } catch {
      setMessage("הקול לא נקלט היטב. התקרבו מעט למיקרופון ונסו שוב.");
    } finally {
      window.clearInterval(interval);
      setRecordingSeconds(0);
      processor.disconnect();
      source.disconnect();
      silentOutput.disconnect();
      await audioContext.close();
      if (mountedRef.current) setWorking(false);
    }
  };

  const savePartner = async (
    nextFaceTemplates = faceTemplates,
    nextVoiceTemplates = voiceTemplates,
    profilePhoto = profilePhotoRef.current
  ) => {
    const bridge = window.coupleLabDesktop;
    if (!bridge || nextFaceTemplates.length < FACE_POSES.length || nextVoiceTemplates.length < 2) return;
    setWorking(true);
    setMessage("שומרים את הזיהוי במחשב…");
    try {
      const current = await bridge.loadBiometricEnrollment();
      const now = new Date().toISOString();
      const enrollment: PartnerBiometricEnrollment = {
        partnerId,
        displayName: partnerName(profile, partnerId),
        faceTemplates: nextFaceTemplates,
        voiceTemplates: nextVoiceTemplates,
        updatedAt: now
      };
      const next: BiometricEnrollmentState = {
        schemaVersion: 1,
        partners: { ...current.partners, [partnerId]: enrollment }
      };
      await bridge.saveBiometricEnrollment(next);
      if (profilePhoto) onProfilePhotoCaptured?.(partnerId, profilePhoto);
      await onSaved();
      if (!singlePartner && partnerId === "A") {
        setPartnerId("B");
        setFaceTemplates([]);
        setVoiceTemplates([]);
        profilePhotoRef.current = null;
        setPhase("voice");
        setMessage(`${partnerName(profile, "A")} מוכן/ה. עכשיו נכיר את ${partnerName(profile, "B")}.`);
      } else {
        setPhase("complete");
        setMessage("");
      }
    } catch {
      setMessage("לא הצלחנו לשמור את הזיהוי. נסו שוב.");
    } finally {
      setWorking(false);
    }
  };

  const currentName = partnerName(profile, partnerId);
  const prompts = voicePrompts(profile, assessment, partnerId);
  const overallFaceProgress = Math.min(
    100,
    ((faceTemplates.length + faceCaptureProgress / 100) / FACE_POSES.length) * 100
  );
  return (
    <div className="enrollment-backdrop" role="dialog" aria-modal="true" aria-labelledby="enrollment-title">
      <div className="enrollment-dialog">
        <button className="enrollment-close" onClick={onClose} disabled={working} aria-label="סגירת הזיהוי">
          <X size={20} />
        </button>
        <h2 id="enrollment-title" className="visually-hidden">זיהוי של {currentName}</h2>

        {phase === "preparing" && <div className="enrollment-loading">מכינים הכול…</div>}

        {phase === "error" && (
          <div className="enrollment-error" role="alert">
            <Camera size={36} aria-hidden="true" />
            <h3>לא הצלחנו לפתוח את המצלמה והמיקרופון</h3>
            <p>{message}</p>
            <div>
              <button className="primary" onClick={() => void prepare()}>ניסיון נוסף</button>
              <button className="text-button" onClick={onClose}>עכשיו לא</button>
            </div>
          </div>
        )}

        {(phase === "face" || phase === "voice") && (
          <div className="enrollment-workspace">
            <div className="enrollment-preview-column">
              <div className="enrollment-preview">
                <video ref={videoRef} muted playsInline />
                {phase === "face" && (
                  <div
                    className={`face-guide-ring ${working ? "collecting" : ""} ${faceCapturedPulse ? "captured" : ""}`}
                    style={{ "--face-progress": `${overallFaceProgress * 3.6}deg` } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    <div className="face-guide-window" />
                    <strong>{faceCapturedPulse ? <CheckCircle2 size={42} /> : `${faceTemplates.length}/${FACE_POSES.length}`}</strong>
                  </div>
                )}
                {working && recordingSeconds > 0 && <strong className="recording-countdown">{recordingSeconds}</strong>}
              </div>
              <p className="enrollment-privacy-note">
                <ShieldCheck size={17} aria-hidden="true" />
                נתוני הזיהוי ותמונת פרופיל קטנה נשמרים רק במחשב הזה. דגימות הקול והתמונות האחרות אינן נשמרות. הזיהוי נועד רק לשייך את הדיבור לאדם הנכון, לא לקבוע מה אתם מרגישים.
              </p>
            </div>
            {phase === "face" ? (
              <div className="enrollment-instructions">
                <Camera size={26} />
                <span>כמה תמונות קצרות · {faceTemplates.length + 1} מתוך {FACE_POSES.length}</span>
                <h3>{FACE_POSES[Math.min(faceTemplates.length, FACE_POSES.length - 1)]}</h3>
                <p>{working ? "החזיקו את הראש יציב עד שהטבעת מתקדמת." : "מקמו את הפנים בתוך הטבעת. לאחר אישור ירוק תופיע התנוחה הבאה."}</p>
                {faceTemplates.length < FACE_POSES.length ? (
                  <button className="primary" disabled={working} onClick={() => void captureFace()}>{working ? "מצלם…" : "צילום"}</button>
                ) : (
                  <button className="primary" disabled={working} onClick={() => void savePartner()}>{working ? "שומר…" : "שמירה וסיום"}</button>
                )}
              </div>
            ) : (
              <div className="enrollment-instructions">
                <Mic size={26} />
                <span>שני משפטים קצרים · {voiceTemplates.length + 1} מתוך 2</span>
                <h3>לחצו על הקלטה וקראו בקול טבעי</h3>
                <blockquote className="voice-reading-prompt">“{prompts[Math.min(voiceTemplates.length, prompts.length - 1)]}”</blockquote>
                <div className="voice-sample-progress" aria-hidden="true">
                  <i style={{ width: working ? `${((VOICE_SECONDS - recordingSeconds) / VOICE_SECONDS) * 100}%` : "0%" }} />
                </div>
                <p>דברו בקצב רגיל. בסיום נבדוק אוטומטית שהקול נקלט היטב.</p>
                {voiceTemplates.length < 2 ? (
                  <button className="recording-action" disabled={working} onClick={() => void recordVoice()}>
                    {working ? "מקליט…" : "התחלת הקלטה"}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        )}

        {phase === "complete" && (
          <div className="enrollment-complete">
            <CheckCircle2 size={44} />
            <h3>{singlePartner ? `זהו, עכשיו המערכת מכירה את ${currentName}` : "זהו, עכשיו המערכת מכירה את שניכם"}</h3>
            <button className="primary" onClick={() => {
              onClose();
              onComplete?.();
            }}>{completionActionLabel || "סיום"}</button>
          </div>
        )}

        {message && phase !== "error" && <p className="enrollment-message">{message}</p>}
      </div>
    </div>
  );
}
