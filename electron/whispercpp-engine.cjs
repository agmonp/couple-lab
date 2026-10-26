/**
 * The packaged Hebrew engine: whisper.cpp's whisper-server with the ivrit-ai
 * turbo model (q5_0). One long-lived local process bound to 127.0.0.1; the
 * model loads once and each decode window is posted as a small WAV.
 *
 * It returns windows in the same shape as electron/whisper-engine.py, so the
 * worker's VAD, keep-filter and word ownership (transcription-pipeline.cjs)
 * stay shared by every engine. Nothing leaves the computer.
 */
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const SAMPLE_RATE = 16000;
const START_TIMEOUT_MS = 120000;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** 16-bit PCM mono WAV from float samples in [-1, 1]. */
function wavFromFloat32(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] || 0));
    data.writeInt16LE(Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * whisper-server's "words" are really tokens (a Hebrew word is often 2–4 of
 * them). A token that starts with a space opens a new word; the rest are
 * appended. Times are the server's token timestamps; probability is the mean.
 */
function tokensToWords(tokens, shift) {
  const words = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const raw = String(token.word ?? "");
    if (!raw.trim() || /^\s*(\[_|<\|)/.test(raw)) continue;
    const start = shift(token.start);
    const end = shift(token.end);
    const probability = Number(token.probability ?? 0);
    const current = words[words.length - 1];
    if (!current || /^\s/.test(raw)) {
      words.push({ text: raw.trim(), start, end, probabilities: [probability] });
    } else {
      current.text += raw;
      current.end = Math.max(current.end, end);
      current.probabilities.push(probability);
    }
  }
  return words
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end))
    .map((word) => [
      word.start,
      Math.max(word.start, word.end),
      word.text,
      Math.round((word.probabilities.reduce((sum, value) => sum + value, 0) / word.probabilities.length) * 1000) / 1000
    ]);
}

/**
 * whisper.cpp can end a segment in the middle of a word ("גר" | "מניה").
 * Tokens at the start of a segment that do not open a new word (no leading
 * space) are moved back onto the previous segment, so no word is cut in two.
 */
function joinSplitWords(segments) {
  const joined = segments.map((segment) => ({
    ...segment,
    text: String(segment.text ?? ""),
    words: Array.isArray(segment.words) ? [...segment.words] : []
  }));
  for (let index = 1; index < joined.length; index += 1) {
    const previous = joined[index - 1];
    const current = joined[index];
    while (current.words.length && !/^\s/.test(String(current.words[0].word ?? "")) && previous.words.length) {
      const token = current.words.shift();
      const piece = String(token.word ?? "");
      previous.words.push(token);
      previous.text = previous.text.replace(/\s+$/, "") + piece;
      previous.end = Math.max(Number(previous.end) || 0, Number(token.end) || 0);
      if (current.text.startsWith(piece)) current.text = current.text.slice(piece.length);
    }
  }
  return joined.filter((segment) => segment.words.length || segment.text.trim());
}

/** whisper-server verbose_json segment -> the engine segment shape the pipeline reads. */
function toEngineSegment(segment, offsetSeconds) {
  const shift = (value) => Math.round((Number(value) + offsetSeconds) * 1000) / 1000;
  const tokens = Array.isArray(segment.tokens) ? segment.tokens : [];
  const words = tokensToWords(segment.words, shift);
  return {
    text: String(segment.text ?? "").trim(),
    start: shift(segment.start),
    end: shift(segment.end),
    avgLogprob: Number(segment.avg_logprob ?? 0),
    noSpeechProb: Number(segment.no_speech_prob ?? 0),
    compressionRatio: Number(segment.compression_ratio ?? 0),
    tokenCount: tokens.length,
    words
  };
}

class WhisperCppEngine {
  constructor({ server, model, threads, onSpawn }) {
    this.onSpawn = onSpawn;
    this.noGpu = false;
    this.server = server;
    this.model = model;
    this.threads = threads;
    this.child = null;
    this.port = 0;
    this.stderr = "";
    this.device = "cpu";
    this.starting = null;
  }

  async start() {
    if (this.child) return;
    if (this.starting) return this.starting;
    // A GPU driver that crashes or hangs while Vulkan initializes must not
    // cost the transcript: retry once on the CPU only.
    this.starting = this.launch()
      .catch((error) => {
        if (this.noGpu) throw error;
        this.noGpu = true;
        this.device = "cpu";
        return this.launch();
      })
      .finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async launch() {
    this.port = await freePort();
    const args = [
      "--model", this.model,
      "--host", "127.0.0.1",
      "--port", String(this.port),
      "--language", "he",
      "--beam-size", "5",
      "--threads", String(this.threads),
      ...(this.noGpu ? ["--no-gpu"] : [])
    ];
    const child = spawn(this.server, args, {
      cwd: path.dirname(this.server),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    if (child.pid && this.onSpawn) this.onSpawn(child.pid);
    const collect = (chunk) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-6000);
      // ggml reports the backend it picked; Vulkan means a GPU is in use.
      if (!this.noGpu && /ggml_vulkan: Found [1-9]|using Vulkan|Vulkan0/i.test(this.stderr)) this.device = "vulkan";
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("exit", () => {
      if (this.child === child) this.child = null;
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!this.child) throw new Error(`whispercpp-exited: ${this.stderr.slice(-300).trim()}`);
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    this.stop();
    throw new Error("whispercpp-start-timeout");
  }

  stop() {
    if (this.child) this.child.kill();
    this.child = null;
  }

  async decodeWindow(samples, offsetSeconds, language) {
    const form = new FormData();
    form.append("file", new Blob([wavFromFloat32(samples)], { type: "audio/wav" }), "window.wav");
    form.append("response_format", "verbose_json");
    form.append("language", language === "en" ? "en" : "he");
    form.append("temperature", "0.0");
    form.append("temperature_inc", "0.2");
    const response = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: "POST", body: form });
    if (!response.ok) throw new Error(`whispercpp-http-${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`whispercpp-${body.error}`);
    return joinSplitWords(Array.isArray(body.segments) ? body.segments : []).map((segment) => toEngineSegment(segment, offsetSeconds));
  }

  /** Same contract as whisper-engine.py's "transcribe": windows in samples, 16 kHz. */
  async transcribe(samples, windows, language) {
    await this.start();
    const started = Date.now();
    const decoded = [];
    for (const window of windows) {
      const start = Math.max(0, window.startSample);
      const end = Math.min(samples.length, window.endSample);
      decoded.push({
        segments: end > start ? await this.decodeWindow(samples.subarray(start, end), start / SAMPLE_RATE, language) : []
      });
    }
    return { windows: decoded, device: this.device, seconds: Math.round((Date.now() - started) / 10) / 100 };
  }
}

module.exports = { WhisperCppEngine, joinSplitWords, toEngineSegment, tokensToWords, wavFromFloat32 };
