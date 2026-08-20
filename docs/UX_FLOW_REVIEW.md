# CoupleLab UX Flow Review

## What Is Strong Now

- The app has one main work surface: Practice Studio.
- The Dashboard now shows process state and a next action.
- The Report turns saved sessions into coaching output instead of raw data only.
- Local-first use is simple: open the app, practice, review, report.

## Necessary Optimizations

1. Make the first run calmer
   - Show one large action: Start Assessment or Start Practice.
   - Keep editing couple names behind Edit/Switch Couple.

2. Improve Practice Studio flow
   - Add a clear pre-session checklist: prompt, conversation type, camera ready, recording ready.
   - Add a 10-minute default timer with a soft end state.
   - Keep manual transcript entry visible as fallback, but prioritize live transcript.

3. Make nonverbal analysis understandable
   - Label gaze metrics as probable cues.
   - Show "shared frame", "mutual attention", "partner gaze", "look away", "warmth", and "tension" as review prompts.
   - Avoid implying the app knows intent or emotional truth.

4. Make reports action-first
   - Lead with 1 to 3 exercises.
   - Then show evidence-linked details.
   - Keep raw pattern counts lower on the page.

5. Add session accuracy feedback loop
   - Store whether the couple marked the analysis as accurate, partly accurate, or needing correction.
   - Later use this to tune thresholds and wording.

6. Add local AI carefully
   - Use Ollama as optional local coach.
   - Keep deterministic prompts and short outputs.
   - Never let the model diagnose, rank blame, or invent facts not in the session data.

7. Prepare real transcription upgrade
   - Browser SpeechRecognition is useful but inconsistent.
   - Next upgrade should be Whisper/whisper.cpp or Transformers.js with a worker.

8. Prepare speaker diarization upgrade
   - Current speaker selection is manual.
   - True diarization should be added before serious report claims about turn-taking.

9. Make camera calibration more explicit
   - Current calibration is left/right position and new calibrations do not retain a face snapshot.
   - Future face identity should use opt-in embeddings and a visible recalibrate button.

10. Keep safety routing simple
   - If safety flags are active, do not suggest conflict exercises.
   - Suggest individual/professional support instead.
