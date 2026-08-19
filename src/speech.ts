import type {
  SpeechLanguage,
  SpeechRecognitionErrorLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionLike
} from "./types";

/**
 * Browser speech recognition, tuned for two people talking to each other rather
 * than one person dictating to a machine.
 *
 * Three things it does that the raw Web Speech API does not:
 *
 * 1. Merges the recogniser's short final fragments into whole utterances, so the
 *    transcript reads as turns instead of a wall of one-line scraps.
 * 2. Times each utterance from the clock rather than guessing from word count.
 * 3. Picks between Hebrew and English by watching recogniser confidence. Script
 *    detection cannot do this on its own: a recogniser set to he-IL renders
 *    English speech as Hebrew-looking nonsense, so the script of the output only
 *    ever reflects the setting, never the speech.
 */

/** Silence after which a buffered utterance is considered finished. */
export const SILENCE_FLUSH_MS = 2200;
/** Long utterances are cut here so the transcript keeps moving. */
const MAX_UTTERANCE_WORDS = 45;
/** Final results below this confidence are treated as room noise and dropped. */
const NOISE_CONFIDENCE = 0.3;
/** Confidence below this, sustained, suggests the wrong language is selected. */
const LANGUAGE_SWITCH_CONFIDENCE = 0.62;
/** Evidence required before switching language, so one bad phrase cannot flip it. */
const LANGUAGE_PROBE_MIN_RESULTS = 4;
const LANGUAGE_PROBE_MIN_WORDS = 12;
/** Restart backoff after a dropped connection. */
const RESTART_BASE_MS = 250;
const RESTART_MAX_MS = 5000;

export interface Utterance {
  text: string;
  /** Mean confidence 0-1, or undefined when the browser reports none. */
  confidence?: number;
  language: SpeechLanguage;
  /** performance.now() timestamps, so callers can place the turn on their own clock. */
  startedAtMs: number;
  endedAtMs: number;
}

export type TranscriberState =
  | "idle"
  | "starting"
  | "listening"
  | "reconnecting"
  | "unsupported"
  | "blocked"
  | "no-microphone"
  | "stopped";

export interface TranscriberStatus {
  state: TranscriberState;
  language: SpeechLanguage;
  /** Short line for the UI. */
  message: string;
  /** Rolling mean confidence for the active language, when the browser reports it. */
  confidence?: number;
}

export interface TranscriberOptions {
  /** "auto" lets the transcriber choose between Hebrew and English. */
  language: SpeechLanguage | "auto";
  /** Best guess to start from when language is "auto". */
  initialLanguage: SpeechLanguage;
  onInterim: (text: string) => void;
  onUtterance: (utterance: Utterance) => void;
  onStatus: (status: TranscriberStatus) => void;
}

export function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const HEBREW_CHAR = /[\u0590-\u05FF]/;
const HEBREW_CHARS = /[\u0590-\u05FF]/g;

export function hasHebrewText(text: string) {
  return HEBREW_CHAR.test(text);
}

/**
 * Which script the text is written in. This confirms what the recogniser was set
 * to; it cannot reveal what language was actually spoken.
 */
export function detectScriptLanguage(text: string): SpeechLanguage | null {
  const hebrewCount = (text.match(HEBREW_CHARS) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;

  if (hebrewCount >= 2 && hebrewCount >= latinCount) return "he-IL";
  if (latinCount >= 4 && latinCount > hebrewCount) return "en-US";
  return null;
}

export function languageLabel(language: SpeechLanguage) {
  return language === "he-IL" ? "Hebrew" : "English";
}

/**
 * Light cleanup of a recognised phrase: normalise spacing, drop the stutter the
 * recogniser produces when it re-hears a word, and tidy punctuation spacing.
 * Deliberately conservative — it never rewords what was said.
 */
export function tidyTranscriptText(raw: string, language: SpeechLanguage) {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";

  // "I I I think" -> "I think". Three or more is recogniser stutter; two can be real.
  text = text.replace(/\b(\S+)(?:\s+\1\b){2,}/gi, "$1");
  // No space before a closing punctuation mark, one space after.
  text = text.replace(/\s+([,.!?;:])/g, "$1").replace(/([,.!?;:])(?=\S)/g, "$1 ");
  text = text.replace(/\s+/g, " ").trim();

  if (language === "en-US" && text) {
    text = text[0].toUpperCase() + text.slice(1);
  }
  return text;
}

/** Guards against the recogniser re-emitting a phrase it already delivered. */
function isDuplicateOfTail(buffer: string, addition: string) {
  const tail = buffer.slice(-addition.length).toLowerCase().trim();
  return tail.length > 0 && tail === addition.toLowerCase().trim();
}

interface LanguageProbe {
  results: number;
  words: number;
  confidenceSum: number;
  confidenceSamples: number;
}

function emptyProbe(): LanguageProbe {
  return { results: 0, words: 0, confidenceSum: 0, confidenceSamples: 0 };
}

function probeMean(probe: LanguageProbe) {
  return probe.confidenceSamples > 0 ? probe.confidenceSum / probe.confidenceSamples : undefined;
}

export function isSpeechRecognitionSupported() {
  if (typeof window === "undefined") return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export class Transcriber {
  private options: TranscriberOptions;
  private recognition: SpeechRecognitionLike | null = null;
  private running = false;
  private language: SpeechLanguage;

  private buffer = "";
  private bufferConfidenceSum = 0;
  private bufferConfidenceSamples = 0;
  private bufferStartedAtMs = 0;
  private bufferEndedAtMs = 0;
  private flushTimer = 0;

  private restartDelay = RESTART_BASE_MS;
  private restartTimer = 0;

  private probes: Record<SpeechLanguage, LanguageProbe> = {
    "he-IL": emptyProbe(),
    "en-US": emptyProbe()
  };
  private languageLocked = false;
  private switching = false;

  constructor(options: TranscriberOptions) {
    this.options = options;
    this.language = options.language === "auto" ? options.initialLanguage : options.language;
  }

  get activeLanguage() {
    return this.language;
  }

  private get isAuto() {
    return this.options.language === "auto";
  }

  start() {
    if (!isSpeechRecognitionSupported()) {
      this.emitStatus("unsupported", "Speech recognition unavailable — use transcript notes");
      return;
    }
    this.running = true;
    this.emitStatus("starting", `Starting ${languageLabel(this.language)} transcription`);
    this.spawn();
  }

  stop() {
    this.running = false;
    window.clearTimeout(this.restartTimer);
    this.flush();
    this.teardown();
    this.options.onInterim("");
    this.emitStatus("stopped", "Transcription stopped");
  }

  /**
   * Closes the current utterance immediately. Call when the speaker changes so a
   * turn is never attributed to the wrong partner.
   */
  flush() {
    window.clearTimeout(this.flushTimer);
    this.flushTimer = 0;
    const text = this.buffer.trim();
    if (!text) {
      this.resetBuffer();
      return;
    }
    const confidence =
      this.bufferConfidenceSamples > 0 ? this.bufferConfidenceSum / this.bufferConfidenceSamples : undefined;

    this.options.onUtterance({
      text: tidyTranscriptText(text, this.language),
      confidence,
      language: this.language,
      startedAtMs: this.bufferStartedAtMs,
      endedAtMs: this.bufferEndedAtMs
    });
    this.resetBuffer();
  }

  private resetBuffer() {
    this.buffer = "";
    this.bufferConfidenceSum = 0;
    this.bufferConfidenceSamples = 0;
    this.bufferStartedAtMs = 0;
    this.bufferEndedAtMs = 0;
  }

  private teardown() {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
    try {
      recognition.abort();
    } catch {
      /* already gone */
    }
  }

  private emitStatus(state: TranscriberState, message: string) {
    this.options.onStatus({
      state,
      language: this.language,
      message,
      confidence: probeMean(this.probes[this.language])
    });
  }

  private spawn() {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      this.emitStatus("unsupported", "Speech recognition unavailable — use transcript notes");
      return;
    }

    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = this.language;

    recognition.onstart = () => {
      this.restartDelay = RESTART_BASE_MS;
      this.emitStatus("listening", `Listening — ${languageLabel(this.language)}`);
    };

    recognition.onresult = (event) => this.handleResult(event);

    recognition.onerror = (event: SpeechRecognitionErrorLike) => {
      switch (event.error) {
        case "not-allowed":
        case "service-not-allowed":
          this.running = false;
          this.emitStatus("blocked", "Microphone blocked — allow it in the browser, then restart");
          break;
        case "audio-capture":
          this.running = false;
          this.emitStatus("no-microphone", "No microphone found");
          break;
        case "no-speech":
          // Ordinary in a conversation with pauses; onend restarts silently.
          break;
        case "network":
          this.restartDelay = Math.max(this.restartDelay, 1500);
          this.emitStatus("reconnecting", "Speech service unreachable — retrying");
          break;
        default:
          break;
      }
    };

    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.recognition = null;
      if (!this.running) return;

      if (this.switching) {
        this.switching = false;
        this.restartDelay = RESTART_BASE_MS;
        this.spawn();
        return;
      }

      this.emitStatus("reconnecting", `Reconnecting — ${languageLabel(this.language)}`);
      this.restartTimer = window.setTimeout(() => {
        if (this.running) this.spawn();
      }, this.restartDelay);
      this.restartDelay = Math.min(this.restartDelay * 2, RESTART_MAX_MS);
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      // start() throws if the previous instance has not fully released the mic.
      this.restartTimer = window.setTimeout(() => {
        if (this.running) this.spawn();
      }, this.restartDelay);
      this.restartDelay = Math.min(this.restartDelay * 2, RESTART_MAX_MS);
    }
  }

  private handleResult(event: SpeechRecognitionEventLike) {
    let interim = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const alternative = result[0];
      if (!alternative) continue;

      if (!result.isFinal) {
        interim += alternative.transcript;
        continue;
      }

      const text = alternative.transcript.trim();
      if (!text) continue;

      const confidence = typeof alternative.confidence === "number" ? alternative.confidence : 0;
      // Confidence of 0 means "not reported" in some browsers, so it must not be
      // read as "certainly noise".
      if (confidence > 0 && confidence < NOISE_CONFIDENCE) continue;

      this.recordProbe(text, confidence);
      this.appendFinal(text, confidence);

      if (this.considerLanguageSwitch()) return;
    }

    if (interim.trim()) {
      // Speech onset is the first sign of talking after a flush, which is a far
      // better start time than working backwards from the word count.
      if (!this.bufferStartedAtMs) {
        this.bufferStartedAtMs = performance.now();
      }
      this.options.onInterim(interim.trim());
    }
  }

  private appendFinal(text: string, confidence: number) {
    const now = performance.now();
    if (!this.bufferStartedAtMs) this.bufferStartedAtMs = now;
    this.bufferEndedAtMs = now;

    if (!isDuplicateOfTail(this.buffer, text)) {
      this.buffer = this.buffer ? `${this.buffer} ${text}` : text;
    }
    if (confidence > 0) {
      this.bufferConfidenceSum += confidence;
      this.bufferConfidenceSamples += 1;
    }

    this.options.onInterim("");

    if (countWords(this.buffer) >= MAX_UTTERANCE_WORDS) {
      this.flush();
      return;
    }

    window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => this.flush(), SILENCE_FLUSH_MS);
  }

  private recordProbe(text: string, confidence: number) {
    const probe = this.probes[this.language];
    probe.results += 1;
    probe.words += countWords(text);
    if (confidence > 0) {
      probe.confidenceSum += confidence;
      probe.confidenceSamples += 1;
    }
  }

  /**
   * Returns true when the recogniser is being restarted in the other language.
   *
   * Sustained low confidence is the only usable signal that the wrong language is
   * selected. Each language is tried once; after both have been sampled the better
   * one is kept for the rest of the session so the two cannot ping-pong.
   */
  private considerLanguageSwitch() {
    if (!this.isAuto || this.languageLocked || this.switching) return false;

    const current = this.probes[this.language];
    const mean = probeMean(current);

    // Nothing to judge on: this browser does not report confidence.
    if (mean === undefined) return false;
    if (current.results < LANGUAGE_PROBE_MIN_RESULTS || current.words < LANGUAGE_PROBE_MIN_WORDS) return false;
    if (mean >= LANGUAGE_SWITCH_CONFIDENCE) {
      // Confident in this language — stop second-guessing it.
      this.languageLocked = true;
      return false;
    }

    const other: SpeechLanguage = this.language === "he-IL" ? "en-US" : "he-IL";
    const otherMean = probeMean(this.probes[other]);

    if (otherMean !== undefined) {
      // Both have been tried. Keep whichever scored better and stop switching.
      this.languageLocked = true;
      const better = otherMean > mean ? other : this.language;
      if (better === this.language) return false;
      this.switchTo(better, `Keeping ${languageLabel(better)} — clearer transcription`);
      return true;
    }

    this.switchTo(other, `Low confidence in ${languageLabel(this.language)} — trying ${languageLabel(other)}`);
    return true;
  }

  private switchTo(language: SpeechLanguage, message: string) {
    this.flush();
    this.language = language;
    this.switching = true;
    this.emitStatus("starting", message);
    const recognition = this.recognition;
    if (!recognition) {
      this.switching = false;
      this.spawn();
      return;
    }
    try {
      recognition.stop();
    } catch {
      this.switching = false;
      this.teardown();
      this.spawn();
    }
  }
}
