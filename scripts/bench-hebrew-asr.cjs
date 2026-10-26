/**
 * Hebrew transcription bench on FLEURS (he_il test), through the real
 * transcription worker, so VAD, windows and filters are the shipped ones.
 *
 *   node scripts/bench-hebrew-asr.cjs <fleurs_he dir> [count] [engine]
 *     engine: tiny (default sherpa whisper-tiny) | whispercpp | python (.venv-asr faster-whisper)
 *   whispercpp needs COUPLE_LAB_WHISPER_SERVER and COUPLE_LAB_WHISPER_MODEL.
 *
 * Prints WER (punctuation-insensitive) and seconds of compute per second of audio.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const [, , fleursDir, countArg = "20", engine = "tiny"] = process.argv;
if (!fleursDir) {
  console.error("usage: node scripts/bench-hebrew-asr.cjs <fleurs_he dir> [count] [tiny|whispercpp]");
  process.exit(2);
}
const root = path.resolve(__dirname, "..");

function readWav(file) {
  const buffer = fs.readFileSync(file);
  let offset = 12;
  let format = null;
  while (offset < buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") format = { tag: buffer.readUInt16LE(offset + 8), channels: buffer.readUInt16LE(offset + 10), rate: buffer.readUInt32LE(offset + 12), bits: buffer.readUInt16LE(offset + 22) };
    if (id === "data") {
      const pcm16 = format?.tag === 1 && format.bits === 16;
      const float32 = format?.tag === 3 && format.bits === 32;
      if (!format || format.rate !== 16000 || (!pcm16 && !float32)) throw new Error(`unsupported wav ${file}`);
      const bytes = format.bits / 8;
      const frames = size / bytes / format.channels;
      const samples = new Float32Array(frames);
      for (let index = 0; index < frames; index += 1) {
        const at = offset + 8 + index * bytes * format.channels;
        samples[index] = pcm16 ? buffer.readInt16LE(at) / 32768 : buffer.readFloatLE(at);
      }
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${file}`);
}

const normalize = (text) => text.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

function editDistance(reference, hypothesis) {
  const row = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let i = 1; i <= reference.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= hypothesis.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[hypothesis.length];
}

const references = new Map();
for (const line of fs.readFileSync(path.join(fleursDir, "test.tsv"), "utf8").split(/\r?\n/)) {
  const columns = line.split("\t");
  if (columns.length >= 3) references.set(columns[1], columns[2].replace(/^"|"$/g, ""));
}
const files = [...references.keys()].filter((name) => fs.existsSync(path.join(fleursDir, "test", name))).sort().slice(0, Number(countArg));

const workerData = {
  encoderPath: path.join(root, "models/asr/whisper-tiny/tiny-encoder.int8.onnx"),
  decoderPath: path.join(root, "models/asr/whisper-tiny/tiny-decoder.int8.onnx"),
  tokensPath: path.join(root, "models/asr/whisper-tiny/tiny-tokens.txt"),
  modelId: "whisper-tiny-multilingual-int8",
  vadPath: path.join(root, "models/vad/silero_vad.onnx"),
  whisperEngine: engine === "whispercpp"
    ? { kind: "whispercpp", server: process.env.COUPLE_LAB_WHISPER_SERVER, model: process.env.COUPLE_LAB_WHISPER_MODEL, threads: 8 }
    : engine === "python"
      ? { kind: "python", python: path.join(root, ".venv-asr/Scripts/python.exe"), script: path.join(root, "electron/whisper-engine.py") }
      : null
};
const worker = new Worker(path.join(root, "electron/transcription-worker.cjs"), { workerData });
let enginePid = null;
let nextId = 0;
const pending = new Map();
worker.on("message", (message) => {
  if (message.enginePid) {
    enginePid = message.enginePid;
    return;
  }
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.ok) request.resolve(message.result);
  else request.reject(new Error(message.error));
});
const ask = (type, samples) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  worker.postMessage({ id, type, samples, language: "he-IL" }, samples ? [samples] : []);
});

(async () => {
  const status = await ask("status");
  let errors = 0;
  let words = 0;
  let audioSeconds = 0;
  let computeSeconds = 0;
  let engineName = "";
  const lines = [];
  for (const name of files) {
    const samples = readWav(path.join(fleursDir, "test", name));
    audioSeconds += samples.length / 16000;
    const started = Date.now();
    const result = await ask("transcribe", samples.buffer);
    computeSeconds += (Date.now() - started) / 1000;
    engineName = result.metadata.engine || result.metadata.modelId;
    const reference = normalize(references.get(name));
    const hypothesis = normalize(result.text);
    errors += editDistance(reference, hypothesis);
    words += reference.length;
    lines.push(`${name}\tREF ${reference.join(" ")}\n\tHYP ${hypothesis.join(" ")}`);
  }
  fs.writeFileSync(path.join(root, "output", `asr-bench-${engine}.txt`), lines.join("\n"), "utf8");
  console.log(JSON.stringify({
    engine: engineName,
    modelId: status.modelId,
    files: files.length,
    wer: Math.round((errors / words) * 1000) / 10,
    secondsPerAudioSecond: Math.round((computeSeconds / audioSeconds) * 100) / 100,
    audioSeconds: Math.round(audioSeconds)
  }));
  if (enginePid) try { process.kill(enginePid); } catch {}
  await worker.terminate();
})().catch((error) => {
  console.error(error);
  if (enginePid) try { process.kill(enginePid); } catch {}
  process.exit(1);
});
