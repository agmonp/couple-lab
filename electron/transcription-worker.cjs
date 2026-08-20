const { parentPort, workerData } = require("node:worker_threads");
const {
  aggregateRecognitionQuality,
  recognitionQuality,
  removeRepeatedPrefix,
  vadCoverage,
  vadSegmentsToDecodeRanges
} = require("./transcription-pipeline.cjs");

if (!parentPort) throw new Error("transcription-worker-missing-parent-port");

const SAMPLE_RATE = 16000;
const MODEL_ID = workerData.modelId || "whisper-tiny-multilingual-int8";
const VAD_MODEL_ID = "silero-vad";
const VAD_WINDOW_SAMPLES = 512;
const recognizers = new Map();
let vad = null;
let workQueue = Promise.resolve();

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

async function transcribeWithVad(samples, language) {
  const recognizer = getRecognizer(language);
  const detected = detectSpeech(samples);
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
  try {
    return await transcribeWithVad(samples, language);
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
      parentPort.postMessage({
        id,
        ok: true,
        result: { ready: true, vadReady, modelId: MODEL_ID, vadModelId: VAD_MODEL_ID }
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
