import {
  Activity,
  Camera,
  Check,
  Download,
  Mic,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdvancedEnginesPanel } from "../components/AdvancedEnginesPanel";
import { NonverbalPanel } from "../components/NonverbalPanel";
import { MiniMetric } from "../components/primitives";
import { TaggedTimeline } from "../components/TaggedTimeline";
import { decks } from "../data";
import { CameraEmptyArt } from "../illustrations";
import { formatTime } from "../lib/format";
import {
  chooseInitialSpeechLanguage,
  detectScriptLanguage,
  estimateSpeechDuration
} from "../lib/language";
import { computeNonverbalMetrics } from "../lib/nonverbal";
import { otherPartner, partnerName, slotName } from "../lib/partners";
import { useLocalState } from "../lib/storage";
import { countWords, nowId } from "../lib/utils";
import {
  countVisibleFaces,
  detectFrameObservations,
  deriveVisualWindowObservations,
  loadVisionModels,
  VisionModels
} from "../lib/vision";
import { analyzeSession } from "../relationshipEngine";
import {
  BodySignals,
  CoupleProfile,
  Deck,
  InteractionTag,
  LiveCue,
  PartnerId,
  SessionRecord,
  SessionType,
  SpeechLanguage,
  SpeechRecognitionLike,
  TranscriptSegment,
  VisualObservation
} from "../types";

export const sessionTypes: { id: SessionType; label: string }[] = [
  { id: "daily-check-in", label: "Daily check-in" },
  { id: "conflict", label: "Conflict" },
  { id: "repair", label: "Repair" },
  { id: "intimacy", label: "Intimacy" },
  { id: "shared-meaning", label: "Shared meaning" }
];

export const transcriptLanguages: { id: "auto" | SpeechLanguage; label: string }[] = [
  { id: "auto", label: "Auto Hebrew / English" },
  { id: "he-IL", label: "Hebrew" },
  { id: "en-US", label: "English" }
];

export const cueOptions: { tone: LiveCue["tone"]; label: string }[] = [
  { tone: "warmth", label: "Warmth" },
  { tone: "repair", label: "Repair" },
  { tone: "humor", label: "Humor" },
  { tone: "softening", label: "Softening" },
  { tone: "look-away", label: "Look away" },
  { tone: "overwhelm", label: "Overwhelm" },
  { tone: "pause", label: "Pause" }
];

export function PracticeStudio({
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
  const visionModelsRef = useRef<VisionModels | null>(null);
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
      wordCount: countWords(clean)
    };
  };

  const appendSegment = (text: string, source: TranscriptSegment["source"]) => {
    const clean = text.trim();
    if (!clean) return;
    const segment = buildSegment(clean, source);
    setSegments((current) => [...current, segment]);
  };

  const loadVisualModels = async () => {
    if (visionModelsRef.current) return visionModelsRef.current;
    setVisualStatus("Loading face/body models");
    visionModelsRef.current = await loadVisionModels();
    setVisualStatus("Visual AI active");
    return visionModelsRef.current;
  };

  const collectVisualObservations = () => {
    const video = videoRef.current;
    const models = visionModelsRef.current;
    if (!recordingRef.current) {
      setVisualStatus("Visual AI ready; record to tag cues");
      return;
    }
    if (!video || video.readyState < 2 || !models) return;

    const sampleSeconds = elapsedRef.current;
    const observations = detectFrameObservations(models, video, profile, sampleSeconds, calibrationText);
    if (observations.length === 0) return;

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
  };

  const calibrateVisualIdentity = async (aSlot: "left" | "right") => {
    if (!streamRef.current) {
      await startCamera();
    }
    const models = await loadVisualModels();
    const video = videoRef.current;
    const faceCount = video && video.readyState >= 2 ? countVisibleFaces(models, video) : 0;
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
