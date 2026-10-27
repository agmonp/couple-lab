# Couple Lab

A local, desktop-ready couples practice app for assessments, a unified Practice Studio, question prompts, guided conversation recording, tagged transcript reflection, MediaPipe face/body observations, safety checks, and exports.

**Download (Windows):** https://agmonp.github.io/couple-lab/ — or grab `Couple-Lab-Windows.exe` from [the latest release](https://github.com/agmonp/couple-lab/releases/latest). It is a portable exe: no install, double-click to run. See the [Code signing policy](#code-signing-policy).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

The Windows exe is built from this repository's source by [`.github/workflows/release-windows.yml`](.github/workflows/release-windows.yml) on GitHub-hosted runners, and only that build is signed. The bundled third-party binaries (Electron, whisper.cpp, sherpa-onnx, MediaPipe) come unchanged from their upstream open-source releases.

Team roles:

- Committers and reviewers: [agmonp](https://github.com/agmonp)
- Approvers: [agmonp](https://github.com/agmonp)

Every signing request is approved by hand. The maintainer uses multi-factor authentication on GitHub and SignPath.

Privacy: this program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. The two network features are both started by the user: downloading the Hebrew transcription model (from this repository's GitHub releases, [GitHub privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)), and the optional bring-your-own-key cloud text analysis, which sends transcript text only to Anthropic ([Anthropic privacy policy](https://www.anthropic.com/legal/privacy)).

## Accurate Hebrew transcription

The app starts with a small built-in engine (whisper-tiny), which is weak in Hebrew. From version 0.3.0, Settings has a **Download accurate Hebrew transcription** button: it downloads the [ivrit.ai](https://huggingface.co/ivrit-ai) Hebrew model once (~550 MB, `whisper-large-v3-turbo` quantized to q5_0, Apache-2.0) into your user folder, checks its SHA-256 and resumes if the connection drops. It runs in the bundled [whisper.cpp](https://github.com/ggml-org/whisper.cpp) engine: on the GPU through Vulkan when available (NVIDIA, AMD or Intel), otherwise on the CPU. Recordings never leave the computer.

Measured on 20 FLEURS Hebrew sentences (181 s of read speech) through the app's own pipeline (`scripts/bench-hebrew-asr.cjs`):

| Engine | WER | Compute time per second of audio |
|---|---|---|
| whisper-tiny (built in) | 88.8% | 0.05 s |
| ivrit.ai q5_0, whisper.cpp, CPU (16 threads available, 8 used) | 25.8% | 1.36 s |
| ivrit.ai q5_0, whisper.cpp, Vulkan (RTX 5070 Ti) | 25.5% | 0.07 s |
| ivrit.ai fp16, faster-whisper, CUDA (run from source) | 26.1% | 0.04 s |

Much of the remaining WER is the reference spelling numbers and abbreviations differently ("10 000" vs "עשרת אלפים"). Read speech is easier than a real conversation, so take these as a direction, not a promise.

The engine and the quantized model are built by `.github/workflows/build-asr-engine.yml` and published to the `asr-engine-v1` release. Before packaging, run `scripts/fetch-asr-engine.ps1` to place the engine in `vendor/whisper-engine`.

Running from source can also use the faster-whisper engine (`scripts/install-hebrew-asr.ps1`, needs Python 3.10–3.12; delete `.venv-asr` to roll back).

The small bundled models in `models/` are not in git. Fetch them once from the official sherpa-onnx releases (~140 MB), before `npm run desktop:run`:

```powershell
New-Item -ItemType Directory -Force models\asr\whisper-tiny, models\speaker, models\vad | Out-Null
$rel = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
Invoke-WebRequest "$rel/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx" -OutFile models\speaker\3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx
Invoke-WebRequest "$rel/asr-models/silero_vad.onnx" -OutFile models\vad\silero_vad.onnx
Invoke-WebRequest "$rel/asr-models/sherpa-onnx-whisper-tiny.tar.bz2" -OutFile whisper-tiny.tar.bz2
tar -xjf whisper-tiny.tar.bz2
Copy-Item sherpa-onnx-whisper-tiny\tiny-encoder.int8.onnx, sherpa-onnx-whisper-tiny\tiny-decoder.int8.onnx, sherpa-onnx-whisper-tiny\tiny-tokens.txt models\asr\whisper-tiny\
```

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
