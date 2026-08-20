import type { AcousticInterval, AcousticMetrics } from "./types";

const FRAME_SECONDS = 0.04;
const MIN_ACTIVITY_SECONDS = 0.16;
const MAX_BRIDGED_GAP_SECONDS = 0.2;
const LONG_PAUSE_SECONDS = 1.2;
const MIN_DB = -100;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], position: number) {
  if (!values.length) return MIN_DB;
  const sorted = [...values].sort((first, second) => first - second);
  const index = clamp((sorted.length - 1) * position, 0, sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function rmsToDb(rms: number) {
  return Math.max(MIN_DB, 20 * Math.log10(Math.max(rms, 0.00001)));
}

function frameLevels(samples: Float32Array, sampleRate: number) {
  const frameSize = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const levels: number[] = [];
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const end = Math.min(samples.length, offset + frameSize);
    let energy = 0;
    for (let index = offset; index < end; index += 1) energy += samples[index] ** 2;
    levels.push(rmsToDb(Math.sqrt(energy / Math.max(1, end - offset))));
  }
  return { levels, frameSize };
}

function bridgeShortGaps(active: boolean[], frameSeconds: number) {
  const result = [...active];
  const maxGapFrames = Math.max(1, Math.round(MAX_BRIDGED_GAP_SECONDS / frameSeconds));
  let index = 0;
  while (index < result.length) {
    if (result[index]) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < result.length && !result[index]) index += 1;
    const gapLength = index - start;
    if (start > 0 && index < result.length && gapLength <= maxGapFrames) {
      for (let fill = start; fill < index; fill += 1) result[fill] = true;
    }
  }
  return result;
}

function removeShortActivity(active: boolean[], frameSeconds: number) {
  const result = [...active];
  const minimumFrames = Math.max(1, Math.round(MIN_ACTIVITY_SECONDS / frameSeconds));
  let index = 0;
  while (index < result.length) {
    if (!result[index]) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < result.length && result[index]) index += 1;
    if (index - start < minimumFrames) {
      for (let clear = start; clear < index; clear += 1) result[clear] = false;
    }
  }
  return result;
}

function activityIntervals(active: boolean[], frameSeconds: number, durationSeconds: number) {
  const intervals: AcousticInterval[] = [];
  let index = 0;
  while (index < active.length) {
    if (!active[index]) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < active.length && active[index]) index += 1;
    intervals.push({
      startSeconds: round(start * frameSeconds),
      endSeconds: round(Math.min(durationSeconds, index * frameSeconds))
    });
  }
  return intervals;
}

function internalPauses(intervals: AcousticInterval[]) {
  return intervals.slice(1).map((interval, index) => ({
    startSeconds: intervals[index].endSeconds,
    endSeconds: interval.startSeconds
  }));
}

function relativeLevelShifts(levels: number[], active: boolean[], frameSeconds: number) {
  const framesPerWindow = Math.max(1, Math.round(2 / frameSeconds));
  const windows: number[] = [];
  for (let start = 0; start < levels.length; start += framesPerWindow) {
    const activeLevels = levels
      .slice(start, start + framesPerWindow)
      .filter((_, offset) => active[start + offset]);
    if (activeLevels.length >= Math.max(2, Math.round(framesPerWindow * 0.2))) {
      windows.push(percentile(activeLevels, 0.5));
    }
  }
  return windows.slice(1).reduce(
    (count, level, index) => count + (Math.abs(level - windows[index]) >= 4.5 ? 1 : 0),
    0
  );
}

export function analyzeAcousticFeatures(samples: Float32Array, sampleRate: number): AcousticMetrics {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || samples.length === 0) {
    return {
      provider: "local-energy-v1",
      durationSeconds: 0,
      speechSeconds: 0,
      silenceSeconds: 0,
      speechCoverage: 0,
      speechIntervalCount: 0,
      longPauseCount: 0,
      medianPauseSeconds: 0,
      longestPauseSeconds: 0,
      relativeLevelShiftCount: 0,
      quality: { status: "insufficient", noiseFloorDb: MIN_DB, clippingRatio: 0 },
      longPauses: []
    };
  }

  const durationSeconds = samples.length / sampleRate;
  const { levels, frameSize } = frameLevels(samples, sampleRate);
  const frameSeconds = frameSize / sampleRate;
  const noiseFloorDb = percentile(levels, 0.2);
  const highLevelDb = percentile(levels, 0.9);
  const activityThresholdDb = Math.max(-50, noiseFloorDb + 8, highLevelDb - 18);
  const rawActivity = levels.map((level) => level >= activityThresholdDb);
  const active = removeShortActivity(bridgeShortGaps(rawActivity, frameSeconds), frameSeconds);
  const intervals = activityIntervals(active, frameSeconds, durationSeconds);
  const pauses = internalPauses(intervals);
  const longPauses = pauses
    .filter((pause) => pause.endSeconds - pause.startSeconds >= LONG_PAUSE_SECONDS)
    .slice(0, 60);
  const pauseDurations = pauses.map((pause) => pause.endSeconds - pause.startSeconds);
  const activeLevels = levels.filter((_, index) => active[index]);
  const speechSeconds = Math.min(durationSeconds, active.filter(Boolean).length * frameSeconds);
  const silenceSeconds = Math.max(0, durationSeconds - speechSeconds);
  const clippingRatio = Array.from(samples).filter((sample) => Math.abs(sample) >= 0.995).length / samples.length;
  const signalContrastDb = highLevelDb - noiseFloorDb;
  const qualityStatus = durationSeconds < 1 || speechSeconds < 0.4
    ? "insufficient"
    : clippingRatio > 0.01 || signalContrastDb < 5
      ? "limited"
      : "usable";

  return {
    provider: "local-energy-v1",
    durationSeconds: round(durationSeconds),
    speechSeconds: round(speechSeconds),
    silenceSeconds: round(silenceSeconds),
    speechCoverage: round(durationSeconds > 0 ? speechSeconds / durationSeconds : 0, 3),
    speechIntervalCount: intervals.length,
    longPauseCount: longPauses.length,
    medianPauseSeconds: round(percentile(pauseDurations, 0.5)),
    longestPauseSeconds: round(pauseDurations.length ? Math.max(...pauseDurations) : 0),
    relativeLevelShiftCount: relativeLevelShifts(levels, active, frameSeconds),
    quality: {
      status: qualityStatus,
      noiseFloorDb: round(noiseFloorDb, 1),
      medianSpeechLevelDb: activeLevels.length ? round(percentile(activeLevels, 0.5), 1) : undefined,
      levelRangeDb: activeLevels.length ? round(percentile(activeLevels, 0.9) - percentile(activeLevels, 0.1), 1) : undefined,
      clippingRatio: round(clippingRatio, 4)
    },
    longPauses
  };
}

export function addTranscriptRate(metrics: AcousticMetrics, wordCount: number): AcousticMetrics {
  if (metrics.speechSeconds < 1 || wordCount <= 0) return metrics;
  return {
    ...metrics,
    estimatedWordsPerMinute: Math.round((wordCount * 60) / metrics.speechSeconds)
  };
}
