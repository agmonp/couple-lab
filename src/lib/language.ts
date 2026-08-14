import { CoupleProfile, SpeechLanguage, TranscriptSegment } from "../types";
import { clamp, countWords } from "./utils";

/**
 * Couple Lab transcribes Hebrew and English. Speech recognition needs one language
 * at a time, so we sniff the script of what was said to pick and switch it.
 */
export function detectScriptLanguage(text: string): SpeechLanguage | null {
  const hebrewCount = (text.match(/[\u0590-\u05FF]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;

  if (hebrewCount >= 2 && hebrewCount >= latinCount) return "he-IL";
  if (latinCount >= 4 && latinCount > hebrewCount) return "en-US";
  return null;
}

export function hasHebrewText(text: string) {
  return /[\u0590-\u05FF]/.test(text);
}

/** Best guess before anything has been said: recent transcript, then names, then browser locale. */
export function chooseInitialSpeechLanguage(profile: CoupleProfile, segments: TranscriptSegment[]): SpeechLanguage {
  const recentTranscript = segments
    .slice(-6)
    .map((segment) => segment.text)
    .join(" ");
  const detected = detectScriptLanguage(recentTranscript);

  if (detected) return detected;
  if (hasHebrewText(`${profile.partnerAName} ${profile.partnerBName}`)) return "he-IL";
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("he")) return "he-IL";
  return "en-US";
}

/**
 * Speech recognition reports a final phrase without timings, so we back-date its start
 * from the word count at roughly conversational pace.
 */
export function estimateSpeechDuration(text: string) {
  return clamp(Math.ceil(countWords(text) / 2.4), 2, 18);
}
