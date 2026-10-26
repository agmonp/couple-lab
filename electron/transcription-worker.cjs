const { parentPort, workerData } = require("node:worker_threads");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const {
  SEGMENTATION_PRESET,
  aggregateRecognitionQuality,
  isHallucination,
  recognitionQuality,
  removeRepeatedPrefix,
  uncoveredGaps,
  vadCoverage,
  vadSegmentsToDecodeRanges,
  vadSegmentsToWordWindows,
  vadView,
  whisperWindowsToSegments
} = require("./transcription-pipeline.cjs");
const { WhisperCppEngine } = require("./whispercpp-engine.cjs");

if (!parentPort) throw new Error("transcription-worker-missing-parent-port");

const SAMPLE_RATE = 16000;
const MODEL_ID = workerData.modelId || "whisper-tiny-multilingual-int8";
const VAD_MODEL_ID = "silero-vad";
const VAD_WINDOW_SAMPLES = 512;
const recognizers = new Map();
let vad = null;
let workQueue = Promise.resolve();
let whisperEngine = null;
let whisperEngineRequestId = 0;
let whisperEngineModelId = null;
let whisperEngineError = null;
let whisperCpp = null;
const WHISPER_CPP_MODEL_ID = "ivrit-ai-whisper-large-v3-turbo-q5";

function usesWhisperCpp() {
  return workerData.whisperEngine?.kind === "whispercpp";
}

function getWhisperCpp() {
  if (!whisperCpp) {
    const config = workerData.whisperEngine;
    whisperCpp = new WhisperCppEngine({
      server: config.server,
      model: config.model,
      threads: config.threads,
      // The main process kills this pid when the worker goes away.
      onSpawn: (pid) => parentPort.postMessage({ enginePid: pid })
    });
  }
  return whisperCpp;
}

function languageCode(language) {
  return language === "en-US" ? "en" : "he";
}

function resultLanguage(result, requestedLanguage) {
  return result?.lang === "en" || languageCode(requestedLanguage) === "en" ? "en-US" : "he-IL";
}

function seconds(sample) {
  return Math.round((sample / SAMPLE_RATE) * 1000) / 1000;
}

function getRecognizer(language) {
  const code = languageCode(language);
  if (recognizers.has(code)) return recognizers.get(code);
  const { OfflineRecognizer } = require("sherpa-onnx-node");
  const recognizer = new OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: workerData.encoderPath,
        decoder: workerData.decoderPath,
        language: code,
        task: "transcribe"
      },
      tokens: workerData.tokensPath,
      numThreads: 2,
      debug: false,
      provider: "cpu"
    }
  });
  recognizers.set(code, recognizer);
  return recognizer;
}

function getVad() {
  if (vad) return vad;
  const { Vad } = require("sherpa-onnx-node");
  vad = new Vad({
    sileroVad: {
      model: workerData.vadPath,
      threshold: 0.5,
      minSpeechDuration: 0.25,
      minSilenceDuration: 0.55,
      maxSpeechDuration: 24,
      windowSize: VAD_WINDOW_SAMPLES
    },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    provider: "cpu",
    debug: false
  }, 60);
  return vad;
}

function collectVadSegments(detector, target) {
  while (!detector.isEmpty()) {
    // `front(enableExternalBuffer)` defaults to true, which makes sherpa-onnx
    // hand back a Float32Array backed by external memory. Electron rejects that
    // with "External buffers are not allowed", the whole VAD pass throws, and
    // every transcript silently degrades to one un-segmented blob. Pass false
    // so the samples are copied — the same reason voice-embedding-worker.cjs
    // calls compute(stream, false).
    const segment = detector.front(false);
    target.push({ start: segment.start, sampleCount: segment.samples.length });
    detector.pop();
  }
}

function detectSpeech(samples) {
  const detector = getVad();
  const detected = [];
  detector.reset();
  try {
    for (let offset = 0; offset < samples.length; offset += VAD_WINDOW_SAMPLES) {
      const available = Math.min(VAD_WINDOW_SAMPLES, samples.length - offset);
      if (available === VAD_WINDOW_SAMPLES) {
        // Copy, never a subarray view: Electron forbids passing an external
        // (shared) ArrayBuffer into a native module, so handing sherpa-onnx a
        // view of the parent buffer throws and silently drops the whole
        // pipeline to the full-audio fallback.
        detector.acceptWaveform(new Float32Array(samples.subarray(offset, offset + VAD_WINDOW_SAMPLES)));
      } else {
        const finalWindow = new Float32Array(VAD_WINDOW_SAMPLES);
        finalWindow.set(samples.subarray(offset));
        detector.acceptWaveform(finalWindow);
      }
      collectVadSegments(detector, detected);
    }
    detector.flush();
    collectVadSegments(detector, detected);
    return detected;
  } finally {
    detector.reset();
  }
}

/**
 * VAD on the whole-file normalised view, then once more on every stretch it
 * called silent, each raised to its own peak (up to 40 dB), so a quiet partner
 * next to a loud one is still heard. Whisper always gets the original audio.
 */
function detectSpeechBothLevels(samples) {
  const detected = detectSpeech(vadView(samples));
  for (const gap of uncoveredGaps(detected, samples.length, SAMPLE_RATE)) {
    const slice = samples.subarray(gap.startSample, gap.endSample);
    const local = vadView(slice, 0.5, 40);
    if (local === slice) continue;
    for (const segment of detectSpeech(local)) {
      detected.push({ start: segment.start + gap.startSample, sampleCount: segment.sampleCount });
    }
  }
  return detected.sort((left, right) => left.start - right.start);
}

async function decodeSamples(recognizer, samples, requestedLanguage) {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  const result = await recognizer.decodeAsync(stream);
  return {
    text: String(result.text || "").trim(),
    language: resultLanguage(result, requestedLanguage),
    quality: recognitionQuality(result)
  };
}

function timelineSegments(detected, totalSamples) {
  return detected
    .map((segment) => {
      const startSample = Math.max(0, Math.min(totalSamples, Math.floor(Number(segment.start) || 0)));
      const endSample = Math.max(startSample, Math.min(totalSamples, startSample + segment.sampleCount));
      return { startSeconds: seconds(startSample), endSeconds: seconds(endSample) };
    })
    .filter((segment) => segment.endSeconds > segment.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds);
}

/**
 * The local GPU engine (electron/whisper-engine.py, faster-whisper with the
 * ivrit-ai Hebrew turbo model). One long-lived Python process; requests are
 * JSON lines. Started lazily; if it is missing or dies, the worker keeps using
 * sherpa-onnx and reports why.
 */
function startWhisperEngine() {
  const config = workerData.whisperEngine;
  if (!config) throw new Error("whisper-engine-not-configured");
  const child = spawn(config.python, ["-I", config.script], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_HUB_OFFLINE: "1", ...(config.env || {}) }
  });
  const engine = { child, pending: new Map(), stderr: "" };
  const fail = (error) => {
    for (const request of engine.pending.values()) request.reject(error);
    engine.pending.clear();
    if (whisperEngine === engine) whisperEngine = null;
  };
  child.on("error", fail);
  child.on("exit", (code) => fail(new Error(`whisper-engine-exited-${code}: ${engine.stderr.slice(-300).trim()}`)));
  child.stderr.on("data", (chunk) => {
    engine.stderr = (engine.stderr + chunk.toString("utf8")).slice(-4000);
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      return;
    }
    const request = engine.pending.get(reply.id);
    if (!request) return;
    engine.pending.delete(reply.id);
    if (reply.ok) request.resolve(reply.result);
    else request.reject(new Error(reply.error || "whisper-engine-failed"));
  });
  return engine;
}

function requestWhisperEngine(message) {
  if (!whisperEngine) whisperEngine = startWhisperEngine();
  const engine = whisperEngine;
  return new Promise((resolve, reject) => {
    const id = ++whisperEngineRequestId;
    engine.pending.set(id, { resolve, reject });
    engine.child.stdin.write(`${JSON.stringify({ id, ...message })}\n`, "utf8", (error) => {
      if (error) {
        engine.pending.delete(id);
        reject(error);
      }
    });
  });
}

async function whisperEngineStatus() {
  if (!workerData.whisperEngine) return null;
  if (whisperEngineModelId) return { modelId: whisperEngineModelId };
  // whisper.cpp starts (and loads ~600 MB) only when there is audio to decode.
  if (usesWhisperCpp()) return { modelId: WHISPER_CPP_MODEL_ID };
  try {
    const status = await requestWhisperEngine({ type: "status" });
    whisperEngineModelId = `${status.modelId}${status.device === "cuda" ? "" : `-${status.device}`}`;
    whisperEngineError = null;
    return { modelId: whisperEngineModelId };
  } catch (error) {
    whisperEngineError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

async function transcribeWithWhisperEngine(samples, language) {
  const detected = detectSpeechBothLevels(samples);
  const coverage = vadCoverage(detected, samples.length, SAMPLE_RATE);
  const windows = vadSegmentsToWordWindows(detected, samples.length, { sampleRate: SAMPLE_RATE });
  let decoded = { windows: [] };
  if (windows.length && usesWhisperCpp()) {
    decoded = await getWhisperCpp().transcribe(samples, windows, languageCode(language));
  } else if (windows.length) {
    const audioPath = path.join(os.tmpdir(), `couple-lab-asr-${process.pid}-${Date.now()}.f32`);
    try {
      // The recording only touches disk for the duration of this call.
      await fs.writeFile(audioPath, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
      decoded = await requestWhisperEngine({
        type: "transcribe",
        audioPath,
        language: languageCode(language),
        windows: windows.map((window) => ({ a0: window.startSample, b0: window.endSample }))
      });
    } finally {
      await fs.rm(audioPath, { force: true }).catch(() => undefined);
    }
  }
  const lineLanguage = language === "en-US" ? "en-US" : "he-IL";
  const segments = whisperWindowsToSegments(windows, decoded.windows)
    .map((segment) => ({ ...segment, language: lineLanguage }));
  return {
    text: segments.map((segment) => segment.text).join(" ").trim(),
    language: lineLanguage,
    segments,
    speechSegments: timelineSegments(detected, samples.length),
    metadata: {
      modelId: usesWhisperCpp()
        ? `${WHISPER_CPP_MODEL_ID}-${decoded.device || "cpu"}`
        : whisperEngineModelId || "ivrit-ai-whisper-large-v3-turbo",
      vadModelId: VAD_MODEL_ID,
      segmentation: "silero-vad",
      segmentationPreset: SEGMENTATION_PRESET,
      engine: usesWhisperCpp() ? `whisper.cpp-${decoded.device || "cpu"}` : `faster-whisper-${decoded.device || "cuda"}`,
      vadApplied: true,
      ...coverage,
      detectedSpeechSegmentCount: detected.length,
      decodeWindowCount: windows.length,
      transcriptSegmentCount: segments.length,
      quality: aggregateRecognitionQuality(segments.map((segment) => segment.quality))
    }
  };
}

async function transcribeWithVad(samples, language) {
  const recognizer = getRecognizer(language);
  // Same VAD as the GPU engine: quiet speakers are not lost before decoding.
  const detected = detectSpeechBothLevels(samples);
  const coverage = vadCoverage(detected, samples.length, SAMPLE_RATE);
  const ranges = vadSegmentsToDecodeRanges(detected, samples.length, {
    sampleRate: SAMPLE_RATE,
    paddingSeconds: 0.2,
    maxDecodeSeconds: 28
  });
  const segments = [];
  let previousText = "";

  for (const range of ranges) {
    const decoded = await decodeSamples(
      recognizer,
      // Copy for the same reason as the VAD windows above.
      new Float32Array(samples.subarray(range.startSample, range.endSample)),
      language
    );
    if (isHallucination(decoded.text)) continue;
    const text = removeRepeatedPrefix(previousText, decoded.text);
    if (!text) continue;
    const speechStartSample = Math.max(range.startSample, range.speechStartSample);
    const speechEndSample = Math.max(speechStartSample, Math.min(range.endSample, range.speechEndSample));
    segments.push({
      text,
      language: decoded.language,
      startSeconds: seconds(speechStartSample),
      endSeconds: seconds(speechEndSample),
      quality: decoded.quality
    });
    previousText = `${previousText} ${text}`.trim();
  }

  const aggregateQuality = aggregateRecognitionQuality(segments.map((segment) => segment.quality));
  return {
    text: segments.map((segment) => segment.text).join(" ").trim(),
    // Whisper is explicitly configured with the requested language. Keep the
    // aggregate stable even if an individual result reports an unexpected lang.
    language: language === "en-US" ? "en-US" : "he-IL",
    segments,
    speechSegments: timelineSegments(detected, samples.length),
    metadata: {
      modelId: MODEL_ID,
      vadModelId: VAD_MODEL_ID,
      segmentation: "silero-vad",
      vadApplied: true,
      ...coverage,
      detectedSpeechSegmentCount: detected.length,
      transcriptSegmentCount: segments.length,
      quality: aggregateQuality
    }
  };
}

async function transcribeLegacy(samples, language, fallbackReason) {
  const decoded = await decodeSamples(getRecognizer(language), samples, language);
  const durationSeconds = seconds(samples.length);
  const segments = decoded.text ? [{
    text: decoded.text,
    language: decoded.language,
    startSeconds: 0,
    endSeconds: durationSeconds,
    quality: decoded.quality
  }] : [];
  return {
    text: decoded.text,
    language: decoded.language,
    segments,
    speechSegments: [],
    metadata: {
      modelId: MODEL_ID,
      vadModelId: VAD_MODEL_ID,
      segmentation: "full-audio-fallback",
      vadApplied: false,
      fallbackReason,
      audioDurationSeconds: durationSeconds,
      speechSeconds: null,
      silenceSeconds: null,
      speechCoverage: null,
      detectedSpeechSegmentCount: 0,
      transcriptSegmentCount: segments.length,
      quality: decoded.quality
    }
  };
}

async function transcribe(samplesBuffer, language) {
  const samples = new Float32Array(samplesBuffer);
  let engineFallbackReason;
  if (workerData.whisperEngine) {
    try {
      await whisperEngineStatus();
      return await transcribeWithWhisperEngine(samples, language);
    } catch (error) {
      engineFallbackReason = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    const result = await transcribeWithVad(samples, language);
    if (engineFallbackReason) result.metadata.engineFallbackReason = engineFallbackReason;
    return result;
  } catch (error) {
    // VAD and segmented decoding are an enhancement. Preserve the previous full-audio
    // behavior if that layer cannot initialize or decode on a supported installation.
    // Carry the real reason out: a silent fallback degrades every transcript and
    // every downstream metric with nothing in the log to explain it.
    const reason = error instanceof Error ? error.message : String(error);
    return transcribeLegacy(samples, language, `vad-or-segmented-decode-failed: ${reason}`);
  }
}

async function handleMessage({ id, type, samples, language }) {
  try {
    if (type === "status") {
      getRecognizer("he-IL");
      let vadReady = false;
      try {
        getVad();
        vadReady = true;
      } catch {
        vadReady = false;
      }
      const engine = await whisperEngineStatus();
      parentPort.postMessage({
        id,
        ok: true,
        result: {
          ready: true,
          vadReady,
          modelId: engine?.modelId ?? MODEL_ID,
          vadModelId: VAD_MODEL_ID,
          ...(workerData.whisperEngine && !engine ? { engineError: whisperEngineError } : {})
        }
      });
      return;
    }
    if (type !== "transcribe") throw new Error("unsupported-transcription-worker-request");
    const result = await transcribe(samples, language);
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

parentPort.on("message", (message) => {
  workQueue = workQueue.then(() => handleMessage(message), () => handleMessage(message));
});
