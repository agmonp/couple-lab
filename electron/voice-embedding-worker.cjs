const { parentPort, workerData } = require("node:worker_threads");

if (!parentPort) throw new Error("voice-worker-missing-parent-port");

let extractor;

function normalize(values) {
  let magnitude = 0;
  for (const value of values) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (!Number.isFinite(magnitude) || magnitude <= 0) throw new Error("invalid-speaker-embedding");
  return Array.from(values, (value) => value / magnitude);
}

function getExtractor() {
  if (extractor) return extractor;
  const { SpeakerEmbeddingExtractor } = require("sherpa-onnx-node");
  extractor = new SpeakerEmbeddingExtractor({
    model: workerData.modelPath,
    numThreads: 2,
    debug: false,
    provider: "cpu"
  });
  return extractor;
}

parentPort.on("message", ({ id, type, samples }) => {
  try {
    if (type === "status") {
      const instance = getExtractor();
      parentPort.postMessage({ id, ok: true, result: { ready: true, dimensions: instance.dim } });
      return;
    }
    if (type !== "extract") throw new Error("unsupported-voice-worker-request");
    const instance = getExtractor();
    const stream = instance.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(samples) });
    if (!instance.isReady(stream)) throw new Error("voice-sample-too-short");
    // Electron forbids external ArrayBuffers in native modules. Ask sherpa-onnx to copy.
    const embedding = instance.compute(stream, false);
    parentPort.postMessage({ id, ok: true, result: { vector: normalize(embedding), dimensions: embedding.length } });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
