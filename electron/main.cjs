const { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session, shell } = require("electron");
const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Worker } = require("node:worker_threads");
const {
  emptyEnrollmentState,
  enrollmentSummary,
  validateEnrollmentState
} = require("./biometric-validation.cjs");
const cloudAi = require("./cloud-ai.cjs");

const APP_SCHEME = "couple-lab";
const APP_ORIGIN = `${APP_SCHEME}://app`;
const DEVELOPMENT_ORIGIN = "http://127.0.0.1:5173";
const ENROLLMENT_FILE = "biometric-enrollment.clb";
const ENROLLMENT_HEADER = Buffer.from("CLB1");
const SPEAKER_MODEL_FILE = "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx";
const DEFAULT_TRANSCRIPTION_MODEL_DIRECTORY = "whisper-tiny";
const DEFAULT_TRANSCRIPTION_MODEL_ID = "whisper-tiny-multilingual-int8";
let resolvedTranscriptionModel = null;
const VAD_MODEL_FILE = "silero_vad.onnx";
let voiceWorker = null;
let voiceRequestId = 0;
const voiceRequests = new Map();
let transcriptionWorker = null;
let transcriptionWorkerStarting = null;
let transcriptionRequestId = 0;
let transcriptionEnginePid = null;
const transcriptionRequests = new Map();
let mainWindow = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

function isDevelopment() {
  return process.argv.includes("--dev");
}

function isSmokeTest() {
  return process.argv.includes("--smoke-test");
}

function isTrustedUrl(value) {
  try {
    const url = new URL(value);
    const isLocalApp = url.protocol === `${APP_SCHEME}:` && url.host === "app";
    return isLocalApp || (isDevelopment() && url.origin === DEVELOPMENT_ORIGIN);
  } catch {
    return false;
  }
}

function validateIpcSender(event) {
  if (!isTrustedUrl(event.senderFrame?.url ?? "")) {
    throw new Error("untrusted-ipc-sender");
  }
}

function enrollmentPath() {
  return path.join(app.getPath("userData"), ENROLLMENT_FILE);
}

function speakerModelPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "models", "speaker", SPEAKER_MODEL_FILE)
    : path.resolve(__dirname, "..", "models", "speaker", SPEAKER_MODEL_FILE);
}

function transcriptionModelsRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "models", "asr")
    : path.resolve(__dirname, "..", "models", "asr");
}

/**
 * Discovers ASR model packs under models/asr. A valid pack directory contains
 * an encoder .onnx, a decoder .onnx and a tokens .txt. Any non-default pack
 * (for example an ivrit.ai Hebrew finetune exported for sherpa-onnx) is
 * preferred over the packaged whisper-tiny, so upgrading transcription
 * quality is a drop-in: place the exported pack in a sibling directory and
 * relaunch. No code change and no manual configuration are required.
 */
async function resolveTranscriptionModel() {
  if (resolvedTranscriptionModel) return resolvedTranscriptionModel;
  const root = transcriptionModelsRoot();
  const packs = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directoryPath = path.join(root, entry.name);
      try {
        const files = await fs.readdir(directoryPath);
        // Prefer the int8 build when a pack ships both: the plain encoder in
        // official sherpa-onnx Whisper packs is a small stub that needs a
        // separate multi-GB .weights file, while the int8 build is self-contained.
        const pick = (pattern) =>
          files.find((file) => pattern.test(file) && /\.int8\.onnx$/i.test(file)) ??
          files.find((file) => pattern.test(file));
        const encoder = pick(/encoder.*\.onnx$/i);
        const decoder = pick(/decoder.*\.onnx$/i);
        const tokens = files.find((file) => /tokens.*\.txt$/i.test(file));
        if (!encoder || !decoder || !tokens) continue;
        const decoderStats = await fs.stat(path.join(directoryPath, decoder));
        packs.push({
          directory: entry.name,
          modelId: entry.name === DEFAULT_TRANSCRIPTION_MODEL_DIRECTORY
            ? DEFAULT_TRANSCRIPTION_MODEL_ID
            : entry.name,
          encoderPath: path.join(directoryPath, encoder),
          decoderPath: path.join(directoryPath, decoder),
          tokensPath: path.join(directoryPath, tokens),
          decoderBytes: decoderStats.size
        });
      } catch {
        // An unreadable pack directory is skipped; other packs remain usable.
      }
    }
  } catch {
    // Missing asr root falls through to the default paths below.
  }
  const upgraded = packs
    .filter((pack) => pack.directory !== DEFAULT_TRANSCRIPTION_MODEL_DIRECTORY)
    .sort((first, second) => second.decoderBytes - first.decoderBytes)[0];
  const fallback = packs.find((pack) => pack.directory === DEFAULT_TRANSCRIPTION_MODEL_DIRECTORY);
  resolvedTranscriptionModel = upgraded ?? fallback ?? {
    directory: DEFAULT_TRANSCRIPTION_MODEL_DIRECTORY,
    modelId: DEFAULT_TRANSCRIPTION_MODEL_ID,
    encoderPath: path.join(root, DEFAULT_TRANSCRIPTION_MODEL_DIRECTORY, "tiny-encoder.int8.onnx"),
    decoderPath: path.join(root, DEFAULT_TRANSCRIPTION_MODEL_DIRECTORY, "tiny-decoder.int8.onnx"),
    tokensPath: path.join(root, DEFAULT_TRANSCRIPTION_MODEL_DIRECTORY, "tiny-tokens.txt")
  };
  return resolvedTranscriptionModel;
}

/**
 * In-app Hebrew transcription model.
 *
 * Packaged whisper-tiny measures ~80% word error rate on Hebrew, which makes
 * every downstream signal unreliable. The ivrit-ai turbo model (Apache-2.0),
 * quantized to q5_0 by .github/workflows/build-asr-engine.yml, runs in the
 * bundled whisper.cpp engine. It is saved under userData, not the app folder:
 * the portable exe unpacks to a fresh temp folder on every launch.
 */
const ASR_RELEASE_BASE = "https://github.com/agmonp/couple-lab/releases/download/asr-engine-v1";
const HEBREW_MODEL = {
  file: "ggml-ivrit-large-v3-turbo-q5_0.bin",
  sha256: "6c1da92e8e41dd64b8cc402eee7eb7a433d2152567e1a4d9cf181fefcc67a572",
  bytes: 574041195
};

let modelInstallInProgress = false;

function hebrewModelPath() {
  return path.join(app.getPath("userData"), "models", "asr", HEBREW_MODEL.file);
}

function whisperServerPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "whisper-engine", "whisper-server.exe")
    : path.resolve(__dirname, "..", "vendor", "whisper-engine", "whisper-server.exe");
}

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fsSync.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

/**
 * Streams to `${destination}.part` and resumes it with a Range request after a
 * dropped connection or an app restart, so 550 MB never sits in memory.
 */
async function downloadResumable(url, destination, onProgress) {
  const partial = `${destination}.part`;
  let existing = 0;
  try {
    existing = (await fs.stat(partial)).size;
  } catch {
    existing = 0;
  }
  await new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "follow" });
    if (existing > 0) request.setHeader("Range", `bytes=${existing}-`);
    request.on("response", (response) => {
      const resumed = response.statusCode === 206;
      if (response.statusCode !== 200 && !resumed) {
        response.on("data", () => {});
        reject(new Error(`download-failed-${response.statusCode}`));
        return;
      }
      if (!resumed) existing = 0;
      const total = existing + (Number(response.headers["content-length"]) || 0);
      const out = fsSync.createWriteStream(partial, { flags: resumed ? "a" : "w" });
      let received = existing;
      response.on("data", (chunk) => {
        out.write(chunk);
        received += chunk.length;
        onProgress(received, total);
      });
      response.on("end", () => out.end(resolve));
      response.on("error", (error) => out.end(() => reject(error)));
      out.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
  return partial;
}

async function installTranscriptionModel(onProgress) {
  if (modelInstallInProgress) throw new Error("transcription-model-install-in-progress");
  modelInstallInProgress = true;
  const destination = hebrewModelPath();
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    let ready = false;
    try {
      ready = (await fs.stat(destination)).size === HEBREW_MODEL.bytes;
    } catch {
      ready = false;
    }
    if (!ready) {
      const partial = await downloadResumable(`${ASR_RELEASE_BASE}/${HEBREW_MODEL.file}`, destination, (received, total) => {
        onProgress({ stage: "model", receivedBytes: received, totalBytes: total || HEBREW_MODEL.bytes });
      });
      onProgress({ stage: "verify", receivedBytes: HEBREW_MODEL.bytes, totalBytes: HEBREW_MODEL.bytes });
      const digest = await sha256OfFile(partial);
      if (digest !== HEBREW_MODEL.sha256) {
        await fs.rm(partial, { force: true });
        throw new Error("download-checksum-mismatch");
      }
      await fs.rename(partial, destination);
    }
    // Drop the worker (and its engine process) so the next transcription
    // loads the Hebrew engine without an app restart.
    await stopTranscriptionWorker();
    const status = await requestTranscriptionWorker("status");
    return { ok: true, modelId: status.modelId };
  } finally {
    modelInstallInProgress = false;
  }
}

/**
 * Opt-in part of --smoke-test (COUPLE_LAB_SMOKE_INSTALL=1): installs the Hebrew
 * model through the real download path and, with COUPLE_LAB_SMOKE_AUDIO set to
 * a raw float32 16 kHz file, transcribes it with the packaged engine.
 */
async function smokeHebrewEngine() {
  if (process.env.COUPLE_LAB_SMOKE_INSTALL !== "1") return undefined;
  const started = Date.now();
  const installed = await installTranscriptionModel(() => {});
  const check = { installedModelId: installed.modelId, installSeconds: Math.round((Date.now() - started) / 1000) };
  if (!process.env.COUPLE_LAB_SMOKE_AUDIO) return check;
  const audio = await fs.readFile(process.env.COUPLE_LAB_SMOKE_AUDIO);
  const samples = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
  const result = await requestTranscriptionWorker("transcribe", samples, "he-IL");
  return {
    ...check,
    modelId: result.metadata.modelId,
    engine: result.metadata.engine,
    fallback: result.metadata.engineFallbackReason ?? null,
    text: result.text
  };
}

async function removeTranscriptionModel() {
  await stopTranscriptionWorker();
  await fs.rm(hebrewModelPath(), { force: true });
  await fs.rm(`${hebrewModelPath()}.part`, { force: true });
  return { ok: true };
}

function vadModelPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "models", "vad", VAD_MODEL_FILE)
    : path.resolve(__dirname, "..", "models", "vad", VAD_MODEL_FILE);
}

function rejectVoiceRequests(error) {
  for (const request of voiceRequests.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  voiceRequests.clear();
}

function getVoiceWorker() {
  if (voiceWorker) return voiceWorker;
  voiceWorker = new Worker(path.join(__dirname, "voice-embedding-worker.cjs"), {
    workerData: { modelPath: speakerModelPath() }
  });
  voiceWorker.on("message", ({ id, ok, result, error }) => {
    const request = voiceRequests.get(id);
    if (!request) return;
    clearTimeout(request.timeout);
    voiceRequests.delete(id);
    if (ok) request.resolve(result);
    else request.reject(new Error(error || "voice-inference-failed"));
  });
  voiceWorker.on("error", (error) => {
    rejectVoiceRequests(error);
    voiceWorker = null;
  });
  voiceWorker.on("exit", (code) => {
    if (code !== 0) rejectVoiceRequests(new Error(`voice-worker-exited-${code}`));
    voiceWorker = null;
  });
  return voiceWorker;
}

function requestVoiceWorker(type, samples) {
  return new Promise((resolve, reject) => {
    const id = ++voiceRequestId;
    const timeout = setTimeout(() => {
      voiceRequests.delete(id);
      reject(new Error("voice-inference-timeout"));
    }, 45000);
    voiceRequests.set(id, { resolve, reject, timeout });
    const message = { id, type, ...(samples ? { samples } : {}) };
    if (samples) getVoiceWorker().postMessage(message, [samples]);
    else getVoiceWorker().postMessage(message);
  });
}

function rejectTranscriptionRequests(error) {
  for (const request of transcriptionRequests.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  transcriptionRequests.clear();
}

async function getTranscriptionWorker() {
  if (transcriptionWorker) return transcriptionWorker;
  // Resolving the model is async, so two concurrent callers could both get past
  // the check above and spawn a second worker that orphans the first. Await a
  // shared promise instead.
  if (transcriptionWorkerStarting) return transcriptionWorkerStarting;
  transcriptionWorkerStarting = startTranscriptionWorker().finally(() => {
    transcriptionWorkerStarting = null;
  });
  return transcriptionWorkerStarting;
}

/**
 * The Hebrew GPU engine: faster-whisper with ivrit-ai whisper-large-v3-turbo,
 * run by electron/whisper-engine.py from the project's .venv-asr
 * (scripts/install-hebrew-asr.ps1 creates it). Only for the unpackaged app,
 * where the script is a real file. COUPLE_LAB_ASR_PYTHON points at another
 * Python that has faster-whisper; COUPLE_LAB_ASR_ENGINE=off disables it.
 */
async function resolveWhisperEngine() {
  if (process.env.COUPLE_LAB_ASR_ENGINE === "off") return null;
  return (app.isPackaged ? null : await resolvePythonEngine()) ?? resolveWhisperCppEngine();
}

/**
 * The bundled engine: whisper.cpp (Vulkan GPU when the driver has it, CPU
 * otherwise) with the downloaded ivrit-ai model. Null until the model exists.
 */
async function resolveWhisperCppEngine() {
  const server = whisperServerPath();
  const model = hebrewModelPath();
  try {
    await Promise.all([fs.access(server), fs.access(model)]);
  } catch {
    return null;
  }
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return { kind: "whispercpp", server, model, threads: Math.max(2, Math.min(8, cores - 2)) };
}

async function resolvePythonEngine() {
  const venv = path.resolve(__dirname, "..", ".venv-asr");
  const python = process.env.COUPLE_LAB_ASR_PYTHON
    || (process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python"));
  const script = path.join(__dirname, "whisper-engine.py");
  try {
    await Promise.all([fs.access(python), fs.access(script)]);
    return { kind: "python", python, script };
  } catch {
    return null;
  }
}

async function startTranscriptionWorker() {
  const model = await resolveTranscriptionModel();
  transcriptionWorker = new Worker(path.join(__dirname, "transcription-worker.cjs"), {
    workerData: {
      encoderPath: model.encoderPath,
      decoderPath: model.decoderPath,
      tokensPath: model.tokensPath,
      modelId: model.modelId,
      vadPath: vadModelPath(),
      whisperEngine: await resolveWhisperEngine()
    }
  });
  transcriptionWorker.on("message", ({ id, ok, result, error, enginePid }) => {
    if (enginePid) {
      transcriptionEnginePid = enginePid;
      return;
    }
    const request = transcriptionRequests.get(id);
    if (!request) return;
    clearTimeout(request.timeout);
    transcriptionRequests.delete(id);
    if (ok) request.resolve(result);
    else request.reject(new Error(error || "transcription-inference-failed"));
  });
  transcriptionWorker.on("error", (error) => {
    rejectTranscriptionRequests(error);
    transcriptionWorker = null;
  });
  transcriptionWorker.on("exit", (code) => {
    if (code !== 0) rejectTranscriptionRequests(new Error(`transcription-worker-exited-${code}`));
    transcriptionWorker = null;
    killTranscriptionEngine();
  });
  return transcriptionWorker;
}

/** The whisper.cpp server is a separate process; it must not outlive its worker. */
function killTranscriptionEngine() {
  if (!transcriptionEnginePid) return;
  try {
    process.kill(transcriptionEnginePid);
  } catch {
    // Already gone.
  }
  transcriptionEnginePid = null;
}

async function stopTranscriptionWorker() {
  resolvedTranscriptionModel = null;
  if (transcriptionWorker) await transcriptionWorker.terminate().catch(() => undefined);
  transcriptionWorker = null;
  killTranscriptionEngine();
}

async function requestTranscriptionWorker(type, samples, language) {
  const worker = await getTranscriptionWorker();
  return new Promise((resolve, reject) => {
    const id = ++transcriptionRequestId;
    const timeout = setTimeout(() => {
      transcriptionRequests.delete(id);
      reject(new Error("transcription-inference-timeout"));
    }, type === "status" ? 180000 : Math.max(10 * 60 * 1000, (samples ? samples.byteLength / 4 / 16000 : 0) * 4 * 1000));
    transcriptionRequests.set(id, { resolve, reject, timeout });
    const message = { id, type, ...(samples ? { samples } : {}), ...(language ? { language } : {}) };
    if (samples) worker.postMessage(message, [samples]);
    else worker.postMessage(message);
  });
}

function validateVoiceSamples(payload) {
  if (!payload || payload.sampleRate !== 16000) throw new Error("voice-sample-rate-must-be-16000");
  const source = payload.samples;
  const samples = source instanceof Float32Array
    ? new Float32Array(source)
    : source instanceof ArrayBuffer
      ? new Float32Array(source.slice(0))
      : Array.isArray(source)
        ? Float32Array.from(source)
        : null;
  if (!samples || samples.length < 48000 || samples.length > 320000) {
    throw new Error("invalid-voice-sample-length");
  }
  for (const value of samples) {
    if (!Number.isFinite(value) || value < -1.01 || value > 1.01) throw new Error("invalid-voice-sample-value");
  }
  return samples.buffer;
}

function validateTranscriptionPayload(payload) {
  if (!payload || payload.sampleRate !== 16000) throw new Error("transcription-sample-rate-must-be-16000");
  if (payload.language !== "he-IL" && payload.language !== "en-US") throw new Error("invalid-transcription-language");
  const source = payload.samples;
  const samples = source instanceof Float32Array
    ? new Float32Array(source)
    : source instanceof ArrayBuffer
      ? new Float32Array(source.slice(0))
      : Array.isArray(source)
        ? Float32Array.from(source)
        : null;
  if (!samples || samples.length < 8000 || samples.length > 16000 * 60 * 30) {
    throw new Error("invalid-transcription-sample-length");
  }
  // Sanitize rather than reject. The native model only needs finite samples in
  // [-1, 1]; throwing away an entire recorded conversation because one sample
  // drifted out of range loses the couple's data for no safety benefit.
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    if (!Number.isFinite(value)) samples[index] = 0;
    else if (value > 1) samples[index] = 1;
    else if (value < -1) samples[index] = -1;
  }
  return { samples: samples.buffer, language: payload.language };
}

async function loadEnrollmentState() {
  try {
    const encrypted = await fs.readFile(enrollmentPath());
    if (!encrypted.subarray(0, ENROLLMENT_HEADER.length).equals(ENROLLMENT_HEADER)) {
      throw new Error("unsupported-enrollment-file");
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("os-encryption-unavailable");
    const json = safeStorage.decryptString(encrypted.subarray(ENROLLMENT_HEADER.length));
    return validateEnrollmentState(JSON.parse(json));
  } catch (error) {
    if (error && error.code === "ENOENT") return emptyEnrollmentState();
    throw error;
  }
}

async function saveEnrollmentState(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("os-encryption-unavailable");
  const state = validateEnrollmentState(value);
  const encrypted = safeStorage.encryptString(JSON.stringify(state));
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(enrollmentPath(), Buffer.concat([ENROLLMENT_HEADER, encrypted]));
  return enrollmentSummary(state);
}

async function clearEnrollment(partnerId) {
  if (partnerId === undefined) {
    try {
      await fs.unlink(enrollmentPath());
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
    return emptyEnrollmentState();
  }
  if (partnerId !== "A" && partnerId !== "B") throw new Error("invalid-partner-id");
  const state = await loadEnrollmentState();
  delete state.partners[partnerId];
  if (Object.keys(state.partners).length === 0) {
    return clearEnrollment();
  }
  await saveEnrollmentState(state);
  return state;
}

function registerAppProtocol() {
  const distRoot = path.resolve(__dirname, "..", "dist");
  protocol.handle(APP_SCHEME, async (request) => {
    const requestUrl = new URL(request.url);
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "") || "index.html";
    const targetPath = path.resolve(distRoot, relativePath);
    if (targetPath !== distRoot && !targetPath.startsWith(`${distRoot}${path.sep}`)) {
      return new Response("Not found", { status: 404 });
    }
    try {
      return await net.fetch(pathToFileURL(targetPath).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function registerIpcHandlers() {
  ipcMain.handle("desktop:get-runtime-info", (event) => {
    validateIpcSender(event);
    return {
      isDesktop: true,
      isPackaged: app.isPackaged,
      platform: process.platform,
      version: app.getVersion(),
      dataDirectory: app.getPath("userData"),
      biometricEncryption: safeStorage.isEncryptionAvailable() ? "os" : "unavailable"
    };
  });
  ipcMain.handle("desktop:load-biometric-enrollment", async (event) => {
    validateIpcSender(event);
    return loadEnrollmentState();
  });
  ipcMain.handle("desktop:get-biometric-enrollment-summary", async (event) => {
    validateIpcSender(event);
    return enrollmentSummary(await loadEnrollmentState());
  });
  ipcMain.handle("desktop:save-biometric-enrollment", async (event, value) => {
    validateIpcSender(event);
    return saveEnrollmentState(value);
  });
  ipcMain.handle("desktop:clear-biometric-enrollment", async (event, partnerId) => {
    validateIpcSender(event);
    return clearEnrollment(partnerId);
  });
  ipcMain.handle("desktop:get-voice-model-status", async (event) => {
    validateIpcSender(event);
    try {
      await fs.access(speakerModelPath());
      const status = await requestVoiceWorker("status");
      return { ...status, modelId: "3dspeaker-campplus-common-16k-v1" };
    } catch (error) {
      return {
        ready: false,
        dimensions: 0,
        modelId: "3dspeaker-campplus-common-16k-v1",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  ipcMain.handle("desktop:extract-voice-embedding", async (event, payload) => {
    validateIpcSender(event);
    const samples = validateVoiceSamples(payload);
    return requestVoiceWorker("extract", samples);
  });
  ipcMain.handle("desktop:get-transcription-model-status", async (event) => {
    validateIpcSender(event);
    try {
      const model = await resolveTranscriptionModel();
      await Promise.all([
        fs.access(model.encoderPath),
        fs.access(model.decoderPath),
        fs.access(model.tokensPath)
      ]);
      const status = await requestTranscriptionWorker("status");
      let vadFileReady = true;
      try {
        await fs.access(vadModelPath());
      } catch {
        vadFileReady = false;
      }
      return {
        ...status,
        modelId: status.modelId || model.modelId,
        vadReady: Boolean(status.vadReady && vadFileReady),
        vadModelId: "silero-vad"
      };
    } catch (error) {
      return {
        ready: false,
        modelId: DEFAULT_TRANSCRIPTION_MODEL_ID,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  ipcMain.handle("desktop:transcribe-audio", async (event, payload) => {
    validateIpcSender(event);
    const { samples, language } = validateTranscriptionPayload(payload);
    return requestTranscriptionWorker("transcribe", samples, language);
  });
  ipcMain.handle("desktop:install-transcription-model", async (event, payload) => {
    validateIpcSender(event);
    const sender = event.sender;
    return installTranscriptionModel((progress) => {
      if (!sender.isDestroyed()) sender.send("desktop:transcription-model-progress", progress);
    });
  });
  ipcMain.handle("desktop:remove-transcription-model", async (event) => {
    validateIpcSender(event);
    return removeTranscriptionModel();
  });
  ipcMain.handle("desktop:cloud-save-key", async (event, payload) => {
    validateIpcSender(event);
    return cloudAi.saveCloudKey(payload);
  });
  ipcMain.handle("desktop:cloud-key-status", async (event) => {
    validateIpcSender(event);
    return cloudAi.cloudKeyStatus();
  });
  ipcMain.handle("desktop:cloud-clear-key", async (event) => {
    validateIpcSender(event);
    return cloudAi.clearCloudKey();
  });
  ipcMain.handle("desktop:cloud-complete", async (event, payload) => {
    validateIpcSender(event);
    return cloudAi.cloudComplete(payload);
  });
}

function configurePermissions() {
  const allowedPermissions = new Set(["media"]);
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const sourceUrl = requestingOrigin || webContents?.getURL() || "";
    return allowedPermissions.has(permission) && isTrustedUrl(sourceUrl);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.has(permission) && isTrustedUrl(webContents.getURL()));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    title: "Couple Lab",
    icon: path.resolve(__dirname, "..", "dist", "app-icon.png"),
    backgroundColor: "#f6f7f2",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  if (isSmokeTest()) {
    win.webContents.once("did-finish-load", async () => {
      try {
        const engineCheck = await smokeHebrewEngine();
        const result = await win.webContents.executeJavaScript(
          "new Promise((resolve) => setTimeout(resolve, 500)).then(async () => { const edit = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('עריכת ההגדרות')); edit?.click(); await new Promise((resolve) => setTimeout(resolve, 100)); const visionResponses = await Promise.all(['./mediapipe/wasm/vision_wasm_internal.js', './mediapipe/wasm/vision_wasm_internal.wasm', './models/face_landmarker.task', './models/pose_landmarker_lite.task'].map(async (url) => { const response = await fetch(url); return { url, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength }; })); const body = document.body.innerText; return { title: document.title, origin: window.location.origin, direction: document.documentElement.dir, setupEntryVisible: body.includes('נכיר אתכם, נבין מה חשוב לכם') || body.includes('נכיר כל אחד מכם בכמה דקות') || body.includes('כמה פרטים שיעזרו לנו ללוות אתכם'), desktopRuntimeVisible: !body.includes('הזיהוי האוטומטי אינו זמין בחלון הזה'), visionResponses, voiceModel: await window.coupleLabDesktop.getVoiceModelStatus(), transcriptionModel: await window.coupleLabDesktop.getTranscriptionModelStatus(), runtime: await window.coupleLabDesktop.getRuntimeInfo() }; })"
        );
        if (!/(^| — )Couple Lab$/.test(result.title) || result.origin !== APP_ORIGIN || result.direction !== "rtl" || !result.setupEntryVisible || !result.desktopRuntimeVisible || !result.runtime?.isDesktop || !result.voiceModel?.ready || !result.transcriptionModel?.ready || !Array.isArray(result.visionResponses) || result.visionResponses.some((asset) => !asset.ok || asset.bytes < 1000)) {
          throw new Error(`desktop-ui-smoke-assertion-failed: ${JSON.stringify(result)}`);
        }
        const report = JSON.stringify(engineCheck ? { ...result, engineCheck } : result);
        process.stdout.write(`${report}\n`);
        // The portable exe's launcher does not forward stdout.
        if (process.env.COUPLE_LAB_SMOKE_OUT) await fs.writeFile(process.env.COUPLE_LAB_SMOKE_OUT, report, "utf8");
        app.exit(0);
      } catch (error) {
        process.stderr.write(`desktop-smoke-failed: ${error instanceof Error ? error.message : String(error)}\n`);
        app.exit(1);
      }
    });
    win.webContents.once("did-fail-load", (_event, code, description) => {
      process.stderr.write(`desktop-load-failed: ${code} ${description}\n`);
      app.exit(1);
    });
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (isDevelopment()) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL || DEVELOPMENT_ORIGIN);
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`);
  }

  return win;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  registerAppProtocol();
  configurePermissions();
  registerIpcHandlers();
  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (voiceWorker) void voiceWorker.terminate();
  if (transcriptionWorker) void transcriptionWorker.terminate();
  killTranscriptionEngine();
});
