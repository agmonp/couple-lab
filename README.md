# Couple Lab

A local, desktop-ready couples practice app for assessments, a unified Practice Studio, question prompts, guided conversation recording, tagged transcript reflection, MediaPipe face/body observations, safety checks, and exports.

## Run the Windows desktop app

Use the `Couple Lab` desktop shortcut to launch Electron directly from the already-built local bundle and the private `couple-lab://app` origin. It does not open a browser, a command window, or a web server. Double-click `Open Couple Lab.cmd` only when you want to rebuild the local bundle before launching. A page at `127.0.0.1:5173` is a development server, not the Windows app.

Create or repair the desktop shortcut with:

```bash
npm run desktop:shortcut
```

The shortcut uses the Couple Lab icon and points directly to the local Electron executable with this project as its app. Opening it again focuses the existing app window instead of creating another copy.

For development with hot reload:

```bash
npm install
npm run desktop
```

For a production-mode local run or a portable Windows executable:

```bash
npm run desktop:run
npm run desktop:smoke
npm run desktop:shortcut
npm run desktop:dist
```

Portable build artifacts are written to `release-desktop/`. The build uses store compression so local test packages are produced quickly; code signing and release-grade compression are still deferred.

The desktop renderer is sandboxed and loads the packaged `dist` bundle from the private `couple-lab://app` origin. Camera and microphone permissions are restricted to that origin. A narrow preload bridge exposes runtime information, background speaker-embedding inference, and encrypted biometric-template storage; it does not expose Node.js or arbitrary filesystem access to React.

## Browser development

```bash
npm run dev
```

Open `http://127.0.0.1:5173`.

## Hosted phone build

The `sites-app/` wrapper publishes the same React UI to ChatGPT Sites over HTTPS:

```bash
npm --prefix sites-app run dev
npm --prefix sites-app run build
```

Reports and couple data remain in browser `localStorage` on the device that created them. The hosted site does not currently use a server database or synchronize data between devices.

## Verify

```bash
npm run build
npm audit
```

## Product Plan

See `docs/PRODUCT_PLAN.md` for the seven-phase roadmap, measurement model, accuracy stance, and next build steps.

## Architecture

Developers and AI coding agents must read `AGENTS.md` and `docs/ARCHITECTURE.md` before making structural changes. Update the architecture document in the same change whenever data flow, storage, integrations, safety, privacy, build/run behavior, or module responsibilities change.

For the researched realtime video stack, calm gamification rules, PWA delivery, and the path to a native Android package, see `docs/REALTIME_ANDROID_ROADMAP.md`.

## Notes

- Camera and microphone access are controlled by the browser permission prompt.
- On Windows desktop, the enrollment wizard captures four face angles and two eight-second voice samples for each partner. Raw frames/audio are discarded; the resulting face geometry descriptors and 192-dimensional CAM++ voice vectors are stored in a versioned file encrypted through Electron `safeStorage`.
- First-time registration runs one person at a time: name, private ten-item assessment, optional guided face/voice enrollment, save, then the next person. A completed person remains saved if the app is closed before the partner is present.
- The enrollment separation result is a pilot-readiness check, not a measured accuracy percentage. Live VAD/diarization and automatic identity matching during sessions are the next stage; manual turns and left/right calibration remain authoritative today.
- Practice Studio uses automatic Hebrew/English browser speech transcription by default, with manual `he-IL` / `en-US` overrides if needed.
- Transcript segments store speaker, target partner, estimated start/end time, source, detected language, and word count.
- Relationship analysis produces tagged moments for Four Horsemen-style risks, repairs, validation, emotional-bank deposits, bids/turning toward, turn-taking, flooding, desire/aliveness, and nonverbal cues.
- Face/body analysis uses MediaPipe Tasks Vision WASM and models packaged with the app, links visual cues to nearby transcript moments where possible, and derives cautious smoothed cues for interaction patterns. Windows calibration and visual analysis do not need a CDN connection.
- Advanced local-engine connectors are prepared for Whisper, OpenFace/LibreFace-style facial analysis, and openSMILE-style voice features.
- Optional local coaching uses Ollama at `http://127.0.0.1:11434` when Ollama is running.
- External body sensors and polished generated PDF files are intentionally deferred; the Report screen supports browser Print / Save PDF.
- See `docs/UX_FLOW_REVIEW.md` for product-flow optimization notes.
