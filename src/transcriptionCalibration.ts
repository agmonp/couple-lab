import { transcriptionAccuracy } from "./transcriptionEval";
import type { PartnerId } from "./types";

/**
 * Automatic transcription calibration.
 *
 * During voice enrollment each person already reads a known sentence aloud.
 * Because the expected text is known in advance, the local transcription of
 * that same recording can be scored automatically (WER/CER) with no manual
 * transcription step. The result is a per-person, per-model quality baseline
 * that is stored locally and can be re-run whenever the ASR model changes.
 */

export const CALIBRATION_STORAGE_KEY = "couple-lab-transcription-calibration";

export type CalibrationLevel = "good" | "fair" | "poor";

export interface CalibrationSample {
  partnerId: PartnerId;
  wer: number;
  cer: number;
  expectedWords: number;
  recognizedWords: number;
  level: CalibrationLevel;
  capturedAt: string;
  modelId?: string;
}

export interface CalibrationState {
  version: 1;
  samples: CalibrationSample[];
}

export interface CalibrationEvaluation {
  wer: number;
  cer: number;
  expectedWords: number;
  recognizedWords: number;
  level: CalibrationLevel;
}

const GOOD_WER = 0.2;
const FAIR_WER = 0.45;
const MAX_STORED_SAMPLES = 24;

export function evaluateCalibrationSample(expectedText: string, recognizedText: string): CalibrationEvaluation {
  const accuracy = transcriptionAccuracy(expectedText, recognizedText);
  const recognizedWords = Math.max(0, accuracy.expectedWords - accuracy.wordErrors);
  const level: CalibrationLevel = accuracy.wer <= GOOD_WER ? "good" : accuracy.wer <= FAIR_WER ? "fair" : "poor";
  return {
    wer: Math.round(accuracy.wer * 1000) / 1000,
    cer: Math.round(accuracy.cer * 1000) / 1000,
    expectedWords: accuracy.expectedWords,
    recognizedWords,
    level
  };
}

export function calibrationMessage(evaluation: CalibrationEvaluation) {
  const counts = `${evaluation.recognizedWords} מתוך ${evaluation.expectedWords} מילים`;
  if (evaluation.level === "good") {
    return `בדיקת התמלול זיהתה ${counts} — אפשר לסמוך עליו ברוב השיחה.`;
  }
  if (evaluation.level === "fair") {
    return `בדיקת התמלול זיהתה ${counts} — חלק מהמשפטים ידרשו תיקון קטן אחרי השיחה.`;
  }
  return `בדיקת התמלול זיהתה רק ${counts} — כדאי לדבר לאט וקרוב יותר למיקרופון, או לשקול מנוע תמלול משופר.`;
}

export function readCalibrationState(storage: Pick<Storage, "getItem"> = localStorage): CalibrationState {
  try {
    const raw = storage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return { version: 1, samples: [] };
    const parsed = JSON.parse(raw) as CalibrationState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.samples)) return { version: 1, samples: [] };
    return parsed;
  } catch {
    return { version: 1, samples: [] };
  }
}

export function appendCalibrationSample(
  sample: CalibrationSample,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage
): CalibrationState {
  const current = readCalibrationState(storage);
  const next: CalibrationState = {
    version: 1,
    samples: [...current.samples, sample].slice(-MAX_STORED_SAMPLES)
  };
  try {
    storage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Calibration history is best-effort; the in-memory result is still returned.
  }
  return next;
}

export interface CalibrationSummary {
  sampleCount: number;
  averageWer: number | null;
  level: CalibrationLevel | null;
  latestModelId?: string;
}

export function summarizeCalibration(state: CalibrationState): CalibrationSummary {
  if (!state.samples.length) return { sampleCount: 0, averageWer: null, level: null };
  const averageWer = state.samples.reduce((sum, sample) => sum + sample.wer, 0) / state.samples.length;
  const level: CalibrationLevel = averageWer <= GOOD_WER ? "good" : averageWer <= FAIR_WER ? "fair" : "poor";
  return {
    sampleCount: state.samples.length,
    averageWer: Math.round(averageWer * 1000) / 1000,
    level,
    latestModelId: state.samples[state.samples.length - 1]?.modelId
  };
}
