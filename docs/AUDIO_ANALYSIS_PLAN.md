# Vocal (sound) analysis — approach and plan

Goal: read *how* something was said, not only *what* — tone, tension, raised
voices, withdrawal — straight from the microphone, alongside the transcript.

## What the research settled

Lightweight, in-browser prosody analysis with the **Web Audio API** is the right
default. It is what established voice toolkits (openSMILE, Essentia.js, Meyda)
compute under the hood, and it needs no model download, no server, and no new
dependency. A heavier neural option (DistilHuBERT / emotion2vec exported to ONNX
Runtime Web + WASM) exists and could be added later behind a toggle, but it is
not needed for the first version and would work against "keep it light."

This matches the app's existing design: the Practice Studio already reserves a
`voice stress` engine slot (the offline openSMILE card). This is its in-browser
fill-in.

## The engine (built: `src/audioAnalysis.ts`, tested in `test/audioAnalysis.test.ts`)

Four prosodic cues, all from plain signal maths on short frames:

| Cue | From | Reads as |
| --- | --- | --- |
| Energy (RMS) | mean square amplitude | raised voice / shouting |
| Pitch (F0) | autocorrelation | tension, escalation |
| Pitch variability | std-dev of F0 | monotone → withdrawal; lively → engagement |
| Silence fraction | frames below a floor | pauses, hesitation, stonewalling |

Every judgement is made **relative to each speaker's own rolling baseline**, because
absolute microphone levels mean nothing across setups. Output labels
(`raised-voice`, `tense-voice`, `flat-withdrawn`, `warm-engaged`, `long-pause`)
map onto the app's existing interaction families (flooding, four-horsemen,
nonverbal, strength). The classifier is deliberately conservative: an ordinary,
level sentence produces nothing.

## Wiring (pending the current local version)

The engine is standalone and dependency-free on purpose, so it merges cleanly on
top of the most recent app version. Wiring, once that version is in:

1. In the Practice Studio, start a `VocalAnalyser` on the same `MediaStream` the
   camera/recorder already opens; stop it with recording.
2. Feed its observations into the session the way visual cues already flow, so the
   live reflection and the saved report pick them up with no analyser changes.
3. Light up the `voice stress` engine card instead of showing it offline.
4. Show the current vocal state next to the transcript (e.g. a small "raised
   voice" / "flat" tag on the active turn).

No new npm dependency, so `package.json` is untouched.
