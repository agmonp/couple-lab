const { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session, shell } = require("electron");
const fs = require("node:fs/promises");
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
 * In-app transcription model installer.
 *
 * Packaged whisper-tiny measures ~80% word error rate on Hebrew, which makes
 * every downstream signal unreliable. These are the official sherpa-onnx
 * exports, so they drop straight in with no conversion. Downloading from
 * inside the app means the couple never needs a terminal.
 */
const INSTALLABLE_MODELS = {
  turbo: { directory: "whisper-turbo", repository: "csukuangfj/sherpa-onnx-whisper-turbo", approximateBytes: 1_036_613_791 },
  small: { directory: "whisper-small", repository: "csukuangfj/sherpa-onnx-whisper-small", approximateBytes: 375_485_327 }
};

let modelInstallInProgress = false;

function downloadToFile(url, destination, onChunk) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "follow" });
    request.on("response", (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.on("data", () => {});
        response.on("end", () => {});
        reject(new Error(`download-failed-${response.statusCode}`));
        return;
      }
      const total = Number(response.headers["content-length"]) || 0;
      const chunks = [];
      let received = 0;
      response.on("data", (chunk) => {
        chunks.push(chunk);
        received += chunk.length;
        onChunk(received, total);
      });
      response.on("end", () => {
        fs.writeFile(destination, Buffer.concat(chunks)).then(resolve, reject);
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

async function installTranscriptionModel(modelKey, onProgress) {
  const model = INSTALLABLE_MODELS[modelKey];
  if (!model) throw new Error("unknown-transcription-model");
  if (modelInstallInProgress) throw new Error("transcription-model-install-in-progress");
  modelInstallInProgress = true;

  const root = transcriptionModelsRoot();
  const directory = path.join(root, model.directory);
  const shortName = model.directory.replace("whisper-", "");
  const files = [
    { name: `${shortName}-encoder.int8.onnx`, label: "encoder" },
    { name: `${shortName}-decoder.int8.onnx`, label: "decoder" },
    { name: `${shortName}-tokens.txt`, label: "tokens" }
  ];

  try {
    await fs.mkdir(directory, { recursive: true });
    let completedBytes = 0;
    for (const file of files) {
      const destination = path.join(directory, file.name);
      try {
        const existing = await fs.stat(destination);
        completedBytes += existing.size;
        onProgress({ stage: file.label, receivedBytes: completedBytes, totalBytes: model.approximateBytes, skipped: true });
        continue;
      } catch {
        // Not downloaded yet.
      }
      const partial = `${destination}.part`;
      const url = `https://huggingface.co/${model.repository}/resolve/main/${file.name}`;
      const startedAt = completedBytes;
      await downloadToFile(url, partial, (received) => {
        onProgress({
          stage: file.label,
          receivedBytes: startedAt + received,
          totalBytes: model.approximateBytes
        });
      });
      await fs.rename(partial, destination);
      completedBytes = (await fs.stat(destination)).size + startedAt;
    }

    await fs.writeFile(
      path.join(directory, "SOURCE.md"),
      `# ${model.directory}\n\nOfficial sherpa-onnx Whisper export.\nSource: https://huggingface.co/${model.repository}\nInstalled from inside Couple Lab.\nDelete this folder to roll back to whisper-tiny.\n`,
      "utf8"
    );

    // Force re-detection and drop the worker so the next transcription loads
    // the new pack without an app restart.
    resolvedTranscriptionModel = null;
    if (transcriptionWorker) {
      await transcriptionWorker.terminate().catch(() => undefined);
      transcriptionWorker = null;
    }
    const installed = await resolveTranscriptionModel();
    return { ok: true, modelId: installed.modelId };
  } finally {
    modelInstallInProgress = false;
  }
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

async function startTranscriptionWorker() {
  const model = await resolveTranscriptionModel();
  transcriptionWorker = new Worker(path.join(__dirname, "transcription-worker.cjs"), {
    workerData: {
      encoderPath: model.encoderPath,
      decoderPath: model.decoderPath,
      tokensPath: model.tokensPath,
      modelId: model.modelId,
      vadPath: vadModelPath()
    }
  });
  transcriptionWorker.on("message", ({ id, ok, result, error }) => {
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
  });
  return transcriptionWorker;
}

async function requestTranscriptionWorker(type, samples, language) {
  const worker = await getTranscriptionWorker();
  return new Promise((resolve, reject) => {
    const id = ++transcriptionRequestId;
    const timeout = setTimeout(() => {
      transcriptionRequests.delete(id);
      reject(new Error("transcription-inference-timeout"));
    }, type === "status" ? 60000 : 10 * 60 * 1000);
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
        modelId: model.modelId,
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
    const modelKey = payload?.model === "small" ? "small" : "turbo";
    const sender = event.sender;
    return installTranscriptionModel(modelKey, (progress) => {
      if (!sender.isDestroyed()) sender.send("desktop:transcription-model-progress", progress);
    });
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
        const result = await win.webContents.executeJavaScript(
          "new Promise((resolve) => setTimeout(resolve, 500)).then(async () => { const edit = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('עריכת ההגדרות')); edit?.click(); await new Promise((resolve) => setTimeout(resolve, 100)); const visionResponses = await Promise.all(['./mediapipe/wasm/vision_wasm_internal.js', './mediapipe/wasm/vision_wasm_internal.wasm', './models/face_landmarker.task', './models/pose_landmarker_lite.task'].map(async (url) => { const response = await fetch(url); return { url, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength }; })); const body = document.body.innerText; return { title: document.title, origin: window.location.origin, direction: document.documentElement.dir, setupEntryVisible: body.includes('נכיר אתכם, נבין מה חשוב לכם') || body.includes('נכיר כל אחד מכם בכמה דקות') || body.includes('כמה פרטים שיעזרו לנו ללוות אתכם'), desktopRuntimeVisible: !body.includes('הזיהוי האוטומטי אינו זמין בחלון הזה'), visionResponses, voiceModel: await window.coupleLabDesktop.getVoiceModelStatus(), transcriptionModel: await window.coupleLabDesktop.getTranscriptionModelStatus(), runtime: await window.coupleLabDesktop.getRuntimeInfo() }; })"
        );
        if (result.title !== "Couple Lab" || result.origin !== APP_ORIGIN || result.direction !== "rtl" || !result.setupEntryVisible || !result.desktopRuntimeVisible || !result.runtime?.isDesktop || !result.voiceModel?.ready || !result.transcriptionModel?.ready || !Array.isArray(result.visionResponses) || result.visionResponses.some((asset) => !asset.ok || asset.bytes < 1000)) {
          throw new Error(`desktop-ui-smoke-assertion-failed: ${JSON.stringify(result)}`);
        }
        process.stdout.write(`${JSON.stringify(result)}\n`);
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
});
