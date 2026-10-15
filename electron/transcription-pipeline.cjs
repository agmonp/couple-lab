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

/*
 * Lessons ported from the Shema project's ASR 2.0 benchmark (FLEURS Hebrew,
 * phone-like conditions, RTX 5070 Ti, 2026-10-15):
 *
 * - "vadnorm": the VAD hears a copy raised to a fixed peak, Whisper still gets
 *   the original. Quiet speakers (a phone on a table across the room) lost
 *   whole sentences to the VAD: WER 28.2% -> 20.9% at -50 dBFS, no cost.
 * - "overlap": pad 0.5 s, join regions closer than 0.8 s up to 28 s, cut
 *   longer stretches into 20 s windows overlapping by 2 s, and let exactly one
 *   window own each word (the one whose span holds the word's midpoint).
 *   Together "overlap+vadnorm" was better or equal in every condition:
 *   -3% relative on normal phone audio, -5% in noise, -27% for quiet speakers.
 * - keep-filter: drop a Whisper segment when no_speech_prob >= 0.6, average
 *   log-prob <= -1.2, or it is a known subtitle-credit hallucination.
 */
const WORD_WINDOW_DEFAULTS = {
  paddingSeconds: 0.5,
  mergeGapSeconds: 0.8,
  maxMergeSeconds: 28,
  minSpeechSeconds: 0.25,
  splitSeconds: 20,
  overlapSeconds: 2
};
const SEGMENTATION_PRESET = "overlap+vadnorm";

// Whisper writes these on silence and noise (subtitle credits in its training data).
const HALLUCINATIONS = new Set([
  "תודה רבה", "תודה", "תודה רבה לכם", "תודה רבה לצפייה", "תודה שצפיתם", "תודה על הצפייה",
  "כתוביות", "תרגום", "מתורגמן", "שבת שלום", "thank you", "thanks for watching", "you"
]);

function isHallucination(text) {
  const normalized = String(text || "")
    .replace(/[‏‪-‮.,!?״"' ]+/g, " ")
    .trim()
    .toLocaleLowerCase("he");
  return HALLUCINATIONS.has(normalized);
}

/** What the VAD listens to: the audio scaled to a fixed peak, never more than 30 dB of gain so hiss stays hiss. */
function vadView(samples, peak = 0.5, maxGainDb = 30) {
  let maximum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index]);
    if (value > maximum) maximum = value;
  }
  if (!(maximum > 0)) return samples;
  const gain = Math.min(peak / maximum, 10 ** (maxGainDb / 20));
  const scaled = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) scaled[index] = samples[index] * gain;
  return scaled;
}

/**
 * Stretches the VAD called silent, for a second, locally normalised VAD pass.
 * Whole-file vadnorm cannot lift one quiet partner sitting next to a loud one:
 * on FLEURS recordings a sentence 37-43 dB below its neighbours was never
 * decoded, although Whisper read it correctly once it was handed the audio.
 */
function uncoveredGaps(vadSegments, totalSamples, minimumGapSamples) {
  const gaps = [];
  let cursor = 0;
  for (const range of unionRanges(rawVadRanges(vadSegments, totalSamples))) {
    if (range.startSample - cursor >= minimumGapSamples) gaps.push({ startSample: cursor, endSample: range.startSample });
    cursor = Math.max(cursor, range.endSample);
  }
  if (totalSamples - cursor >= minimumGapSamples) gaps.push({ startSample: cursor, endSample: totalSamples });
  return gaps;
}

/**
 * VAD segments -> decode windows. startSample/endSample is the padded slice the
 * model hears; ownStartSeconds/ownEndSeconds is the span whose words this
 * window keeps (half way to the neighbouring speech), so padding and the 2 s
 * overlap never store a word twice.
 */
function vadSegmentsToWordWindows(vadSegments, totalSamples, options = {}) {
  const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
    ? options.sampleRate
    : DEFAULT_SAMPLE_RATE;
  const settings = { ...WORD_WINDOW_DEFAULTS, ...options };
  const regions = [];
  for (const range of rawVadRanges(vadSegments, totalSamples)) {
    const previous = regions[regions.length - 1];
    if (previous
      && range.startSample - previous.endSample < settings.mergeGapSeconds * sampleRate
      && range.endSample - previous.startSample < settings.maxMergeSeconds * sampleRate) {
      previous.endSample = Math.max(previous.endSample, range.endSample);
    } else {
      regions.push({ ...range });
    }
  }
  const kept = regions.filter((region) => region.endSample - region.startSample >= settings.minSpeechSeconds * sampleRate);
  const padding = Math.round(settings.paddingSeconds * sampleRate);
  const split = Math.round(settings.splitSeconds * sampleRate);
  const step = Math.max(sampleRate, Math.round((settings.splitSeconds - settings.overlapSeconds) * sampleRate));
  const windows = [];

  kept.forEach((region, index) => {
    const ownStart = index === 0 ? 0 : (kept[index - 1].endSample + region.startSample) / 2 / sampleRate;
    const ownEnd = index === kept.length - 1
      ? totalSamples / sampleRate
      : (region.endSample + kept[index + 1].startSample) / 2 / sampleRate;
    const pieces = [];
    if (split > 0 && region.endSample - region.startSample > split) {
      for (let cursor = region.startSample; ; cursor += step) {
        const end = Math.min(region.endSample, cursor + split);
        pieces.push([cursor, end]);
        if (end >= region.endSample) break;
      }
    } else {
      pieces.push([region.startSample, region.endSample]);
    }
    pieces.forEach(([start, end], pieceIndex) => {
      windows.push({
        startSample: Math.max(0, start - padding),
        endSample: Math.min(totalSamples, end + padding),
        speechStartSample: start,
        speechEndSample: end,
        ownStartSeconds: round(pieceIndex === 0 ? ownStart : (pieces[pieceIndex - 1][1] + start) / 2 / sampleRate),
        ownEndSeconds: round(pieceIndex === pieces.length - 1 ? ownEnd : (end + pieces[pieceIndex + 1][0]) / 2 / sampleRate)
      });
    });
  });
  return windows;
}

function ownsWord(window, word) {
  const middle = (word[0] + word[1]) / 2;
  return window.ownStartSeconds <= middle && middle < window.ownEndSeconds;
}

function keepWhisperSegment(segment) {
  return Number(segment?.noSpeechProb) < 0.6
    && Number(segment?.avgLogprob) > -1.2
    && !isHallucination(segment?.text);
}

function wordKey(text) {
  return String(text || "").toLocaleLowerCase("he").replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Whisper segments decoded per window -> transcript segments with owned words
 * only. An exact re-read at a window seam (same word, times overlapping by more
 * than half of the shorter copy) is dropped; different words that overlap are
 * kept, since two partners can talk at once.
 */
function whisperWindowsToSegments(windows, decodedWindows) {
  const lines = [];
  windows.forEach((window, windowIndex) => {
    for (const segment of decodedWindows[windowIndex]?.segments ?? []) {
      if (!keepWhisperSegment(segment)) continue;
      const words = (segment.words ?? []).filter((word) => wordKey(word[2]) && ownsWord(window, word));
      if (words.length) lines.push({ segment, words });
    }
  });
  lines.sort((left, right) => left.words[0][0] - right.words[0][0]);

  let previousWord = null;
  const output = [];
  for (const line of lines) {
    const words = [];
    for (const word of line.words) {
      if (previousWord) {
        const overlap = Math.min(previousWord[1], word[1]) - Math.max(previousWord[0], word[0]);
        const shorter = Math.max(Math.min(previousWord[1] - previousWord[0], word[1] - word[0]), 0.01);
        if (wordKey(previousWord[2]) === wordKey(word[2]) && overlap > 0.5 * shorter) continue;
      }
      words.push(word);
      previousWord = word;
    }
    if (!words.length) continue;
    const averageLogProbability = Number(line.segment.avgLogprob);
    const confidenceProxy = clamp(Math.exp(Math.min(0, averageLogProbability)), 0, 1);
    output.push({
      text: words.map((word) => word[2]).join(" "),
      startSeconds: round(words[0][0]),
      endSeconds: round(Math.max(words[0][0], words[words.length - 1][1])),
      quality: {
        averageLogProbability: round(averageLogProbability, 4),
        confidenceProxy: round(confidenceProxy, 4),
        confidenceLevel: confidenceLevel(confidenceProxy),
        tokenCount: Math.max(0, Number(line.segment.tokenCount) || 0),
        timestampCount: words.length
      }
    });
  }
  return output;
}

module.exports = {
  SEGMENTATION_PRESET,
  aggregateRecognitionQuality,
  isHallucination,
  keepWhisperSegment,
  recognitionQuality,
  removeRepeatedPrefix,
  uncoveredGaps,
  vadCoverage,
  vadSegmentsToDecodeRanges,
  vadSegmentsToWordWindows,
  vadView,
  whisperWindowsToSegments
};
