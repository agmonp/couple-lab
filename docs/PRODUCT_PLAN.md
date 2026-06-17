# Couple Lab: Connection Practice

## Product Promise

Couple Lab is a private desktop-ready practice app that helps couples build respect, affection, calm conflict skills, intimacy, and shared meaning. It is inspired by leading relationship practice, including Gottman-style friendship and conflict research and Esther Perel-style attention to desire, separateness, play, and aliveness.

It is not a therapist, diagnostic system, official Gottman product, or divorce predictor. Its job is to make better conversations more likely and easier to repeat.

## Seven Phases

1. Product spec and data model
   - Profiles, relationship goals, assessment domains, sessions, transcripts, live cues, visual observations, exports, and safety flags.

2. Practice Studio
   - One couple workspace that combines question decks, camera, recording, transcription, manual notes, live cues, face/body visual analysis, and session saving.

3. Local desktop MVP
   - Vite/React app that runs locally in a browser and includes an Electron entry point for desktop packaging.

4. Recording and transcription
   - Browser-level camera/microphone permission.
   - Auto-start webcam preview when the Practice Studio opens.
   - MediaRecorder video capture.
   - Browser speech-recognition transcript capture where available.
   - Automatic Hebrew/English speech-recognition mode with manual `he-IL` / `en-US` overrides.
   - Tagged transcript data: speaker, target partner, start/end timestamp, source, detected language, and word count.
   - Manual transcript fallback.

5. Relationship analysis engine
   - Detects practice signals such as validation, fondness, curiosity, soft startup, repair attempts, and ownership.
   - Flags risk patterns such as criticism-like startup, defensiveness-risk language, contempt-risk language, stonewalling/shutdown language, and global blame.
   - Tags Four Horsemen-style signals with matching antidotes: gentle startup, fondness/admiration, responsibility, and physiological self-soothing.
   - Tags emotional-bank deposits, bids/turning toward, repair acceptance, interruption/overlap risk, escalation clusters, and desire/aliveness cues.
   - Measures speaking balance, positive/risk/repair counts, Four Horsemen signals, flooding-risk score, and practice score.
   - Computes a non-diagnostic emotional-state estimate: warmth, engagement, tension, flooding, withdrawal, and repair readiness.
   - Produces strengths, risks, next steps, scripts, and evidence-linked moments.

6. Visual analysis
   - MediaPipe Face Landmarker with face landmarks and blendshape-based cues.
   - MediaPipe Pose Landmarker with body/posture cues.
   - Probable shared frame, mutual attention, partner gaze, look-away, warmth, and tension metrics.
   - Visual observations are tagged with timestamp, subject when calibrated, confidence, and a nearby transcript segment when available.
   - Short-window smoothing derives sustained warmth, sustained tension, possible engagement, and possible withdrawal cues.
   - Advanced connector layer is prepared for local OpenFace/LibreFace-style Action Units, gaze, and expression logits.
   - No external body sensors in this phase.
   - Live cue labels for warmth, repair, humor, softening, look-away, overwhelm, and pause.

7. Export and safety layer
   - JSON export.
   - Coaching Report screen with Print / Save PDF.
   - Therapist-ready text summary.
   - Optional local Ollama coach for a short non-diagnostic coaching note.
   - Safety checklist for fear, coercion, violence, pressure to participate, serious depression, addiction, or crisis.

## Assessment Domains

- Friendship map
- Respect and fondness
- Turning toward
- Emotional safety
- Calm conflict
- Repair
- Intimacy and desire
- Shared meaning
- Flooding recovery
- Life teamwork

## Accuracy Principles

- The app should say "possible pattern" instead of "you are."
- Every flagged moment should link to evidence from transcript, cue, or signal.
- Users must be able to relabel or reject the app's interpretation.
- Relationship risk should be tracked as a trend over time, not a single-session verdict.
- Facial expression and posture inference should be treated as weak signals unless supported by transcript context and partner confirmation.
- Abuse, coercion, or intimidation should stop couples-practice mode and route toward professional support.

## Build Next

- Add authenticated encrypted storage.
- Add local Whisper transcription for offline accuracy.
- Add speaker diarization.
- Add user correction loops for pattern labels.
- Add local Whisper or Transformers.js transcription for stronger speech-to-text.
- Add couple-specific calibration for MediaPipe face/body cues.
- Add local sidecar services for Whisper, OpenFace/LibreFace, and openSMILE so the app can consume richer local signals through health-checked endpoints.
- Add printable PDF relationship report.
- Add therapist collaboration mode with explicit sharing consent.
