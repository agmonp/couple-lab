"use strict";

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_PADDING_SECONDS = 0.2;
const DEFAULT_MAX_DECODE_SECONDS = 28;
/**
 * Silence this short is a breath inside one person's turn, not a turn change,
 * so the speech either side is decoded together.
 *
 * This matters more than it looks. Whisper always encodes a padded 30-second
 * window, so a 2-second clip costs the same encoder pass as a 28-second one —
 * decoding four short utterances separately is four times the work of decoding
 * them as one window. And Whisper is a context model: given two seconds with no
 * surrounding speech it has nothing to condition on and invents plausible
 * Hebrew. Merging is therefore both faster and more accurate.
 *
 * The VAD splits on 0.55s of silence while padding only bridged 0.4s, so before
 * this existed no two segments could ever merge.
 */
const DEFAULT_MAX_BRIDGED_GAP_SECONDS = 1.2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sampleCountForVadSegment(segment) {
  if (Number.isFinite(segment?.sampleCount)) return Math.max(0, Math.floor(segment.sampleCount));
  if (Number.isFinite(segment?.samples?.length)) return Math.max(0, Math.floor(segment.samples.length));
  return 0;
}

function rawVadRanges(vadSegments, totalSamples) {
  if (!Number.isFinite(totalSamples) || totalSamples <= 0 || !Array.isArray(vadSegments)) return [];

  return vadSegments
    .map((segment) => {
      const startSample = clamp(Math.floor(Number(segment?.start) || 0), 0, totalSamples);
      const endSample = clamp(startSample + sampleCountForVadSegment(segment), startSample, totalSamples);
      return { startSample, endSample };
    })
    .filter((range) => range.endSample > range.startSample)
    .sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample);
}

function unionRanges(ranges) {
  const merged = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (!previous || range.startSample > previous.endSample) {
      merged.push({ ...range });
      continue;
    }
    previous.endSample = Math.max(previous.endSample, range.endSample);
  }
  return merged;
}

function vadCoverage(vadSegments, totalSamples, sampleRate = DEFAULT_SAMPLE_RATE) {
  const audioSamples = Math.max(0, Math.floor(Number(totalSamples) || 0));
  const validSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE;
  const speechSamples = unionRanges(rawVadRanges(vadSegments, audioSamples))
    .reduce((sum, range) => sum + range.endSample - range.startSample, 0);
  const audioDurationSeconds = audioSamples / validSampleRate;
  const speechSeconds = speechSamples / validSampleRate;
  const silenceSeconds = Math.max(0, audioDurationSeconds - speechSeconds);

  return {
    audioDurationSeconds: round(audioDurationSeconds),
    speechSeconds: round(speechSeconds),
    silenceSeconds: round(silenceSeconds),
    speechCoverage: audioSamples ? round(speechSamples / audioSamples, 4) : 0
  };
}

function vadSegmentsToDecodeRanges(vadSegments, totalSamples, options = {}) {
  const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
    ? options.sampleRate
    : DEFAULT_SAMPLE_RATE;
  const paddingSamples = Math.max(0, Math.round(
    (Number.isFinite(options.paddingSeconds) ? options.paddingSeconds : DEFAULT_PADDING_SECONDS) * sampleRate
  ));
  const maximumSamples = Math.max(sampleRate, Math.round(
    (Number.isFinite(options.maxDecodeSeconds) ? options.maxDecodeSeconds : DEFAULT_MAX_DECODE_SECONDS) * sampleRate
  ));
  const rawRanges = rawVadRanges(vadSegments, totalSamples);
  const paddedRanges = rawRanges.map((range) => ({
    startSample: Math.max(0, range.startSample - paddingSamples),
    endSample: Math.min(totalSamples, range.endSample + paddingSamples),
    speechStartSample: range.startSample,
    speechEndSample: range.endSample
  }));

  const bridgeSamples = Math.max(0, Math.round(
    (Number.isFinite(options.maxBridgedGapSeconds) ? options.maxBridgedGapSeconds : DEFAULT_MAX_BRIDGED_GAP_SECONDS)
    * sampleRate
  ));

  const combined = [];
  for (const range of paddedRanges) {
    const previous = combined[combined.length - 1];
    const combinedLength = previous ? Math.max(previous.endSample, range.endSample) - previous.startSample : 0;
    // Bridge a short conversational pause, not just an literal overlap.
    const gap = previous ? range.startSample - previous.endSample : Infinity;
    if (previous && gap <= bridgeSamples && combinedLength <= maximumSamples) {
      previous.endSample = Math.max(previous.endSample, range.endSample);
      previous.speechEndSample = Math.max(previous.speechEndSample, range.speechEndSample);
      continue;
    }
    combined.push({ ...range });
  }

  const decoded = [];
  for (const range of combined) {
    if (range.endSample - range.startSample <= maximumSamples) {
      decoded.push(range);
      continue;
    }

    let cursor = range.startSample;
    while (cursor < range.endSample) {
      const endSample = Math.min(range.endSample, cursor + maximumSamples);
      decoded.push({
        startSample: cursor,
        endSample,
        speechStartSample: Math.max(cursor, range.speechStartSample),
        speechEndSample: Math.min(endSample, range.speechEndSample)
      });
      cursor = endSample;
    }
  }

  return decoded.filter((range) => range.endSample > range.startSample);
}

function confidenceLevel(confidenceProxy) {
  if (!Number.isFinite(confidenceProxy)) return "unknown";
  // Until calibrated on held-out Hebrew audio, reserve "high" for a
  // deliberately conservative token-probability proxy.
  if (confidenceProxy >= 0.75) return "high";
  if (confidenceProxy < 0.35) return "low";
  return "medium";
}

function recognitionQuality(result) {
  const probabilities = Array.isArray(result?.ys_log_probs)
    ? result.ys_log_probs.filter(Number.isFinite)
    : [];
  const tokenCount = Array.isArray(result?.tokens) ? result.tokens.length : 0;
  const timestampCount = Array.isArray(result?.timestamps)
    ? result.timestamps.filter(Number.isFinite).length
    : 0;

  if (probabilities.length === 0) {
    return { confidenceLevel: "unknown", tokenCount, timestampCount };
  }

  const averageLogProbability = probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length;
  const confidenceProxy = clamp(Math.exp(Math.min(0, averageLogProbability)), 0, 1);
  return {
    averageLogProbability: round(averageLogProbability, 4),
    confidenceProxy: round(confidenceProxy, 4),
    confidenceLevel: confidenceLevel(confidenceProxy),
    tokenCount,
    timestampCount
  };
}

function aggregateRecognitionQuality(qualities) {
  const usable = (Array.isArray(qualities) ? qualities : [])
    .filter((quality) => Number.isFinite(quality?.averageLogProbability));
  const tokenCount = (Array.isArray(qualities) ? qualities : [])
    .reduce((sum, quality) => sum + Math.max(0, Number(quality?.tokenCount) || 0), 0);

  if (usable.length === 0) {
    return { confidenceLevel: "unknown", tokenCount };
  }

  const totalWeight = usable.reduce((sum, quality) => sum + Math.max(1, quality.tokenCount || 0), 0);
  const averageLogProbability = usable.reduce(
    (sum, quality) => sum + quality.averageLogProbability * Math.max(1, quality.tokenCount || 0),
    0
  ) / totalWeight;
  const confidenceProxy = clamp(Math.exp(Math.min(0, averageLogProbability)), 0, 1);
  return {
    averageLogProbability: round(averageLogProbability, 4),
    confidenceProxy: round(confidenceProxy, 4),
    confidenceLevel: confidenceLevel(confidenceProxy),
    tokenCount
  };
}

function normalizedWords(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("he")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function removeRepeatedPrefix(previousText, currentText, maximumWords = 12) {
  const previousWords = String(previousText || "").trim().split(/\s+/).filter(Boolean);
  const currentWords = String(currentText || "").trim().split(/\s+/).filter(Boolean);
  const normalizedPrevious = normalizedWords(previousText);
  const normalizedCurrent = normalizedWords(currentText);
  const limit = Math.min(maximumWords, normalizedPrevious.length, normalizedCurrent.length);
  let overlap = 0;

  for (let size = 1; size <= limit; size += 1) {
    const previousSuffix = normalizedPrevious.slice(-size).join(" ");
    const currentPrefix = normalizedCurrent.slice(0, size).join(" ");
    if (previousSuffix === currentPrefix) overlap = size;
  }

  if (overlap === 0 || currentWords.length <= overlap) return String(currentText || "").trim();
  // Normalization only removes punctuation and spacing, so word indexes remain aligned.
  return currentWords.slice(overlap).join(" ").trim();
}

module.exports = {
  aggregateRecognitionQuality,
  recognitionQuality,
  removeRepeatedPrefix,
  vadCoverage,
  vadSegmentsToDecodeRanges
};
