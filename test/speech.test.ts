import assert from "node:assert/strict";
import test, { before, describe } from "node:test";

import type {
  SpeechRecognitionErrorLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionLike
} from "../src/types.ts";

/** Stands in for the browser recogniser so the merging and language logic can be driven directly. */
class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];

  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  lang = "";
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    this.started = true;
    this.onstart?.();
  }

  stop() {
    this.started = false;
    this.onend?.();
  }

  abort() {
    this.started = false;
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }

  say(transcript: string, confidence = 0.9, isFinal = true) {
    const results: Record<number, unknown> & { length: number } = { length: 1 };
    results[0] = { length: 1, isFinal, 0: { transcript, confidence } };
    this.onresult?.({ resultIndex: 0, results } as unknown as SpeechRecognitionEventLike);
  }

  fail(error: string) {
    this.onerror?.({ error } as SpeechRecognitionErrorLike);
  }
}

// The module reads window.SpeechRecognition and window.setTimeout at call time,
// so the global has to exist before it is imported.
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;

type SpeechModule = typeof import("../src/speech.ts");
type Utterance = import("../src/speech.ts").Utterance;
type TranscriberStatus = import("../src/speech.ts").TranscriberStatus;
type TranscriberOptions = import("../src/speech.ts").TranscriberOptions;

let speech: SpeechModule;

before(async () => {
  speech = await import("../src/speech.ts");
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function newTranscriber(overrides: Partial<TranscriberOptions> = {}) {
  const utterances: Utterance[] = [];
  const statuses: TranscriberStatus[] = [];
  let interim = "";

  FakeRecognition.instances = [];
  const transcriber = new speech.Transcriber({
    language: "auto",
    initialLanguage: "he-IL",
    onInterim: (text) => {
      interim = text;
    },
    onUtterance: (utterance) => utterances.push(utterance),
    onStatus: (status) => statuses.push(status),
    ...overrides
  });

  transcriber.start();
  return {
    transcriber,
    utterances,
    statuses,
    get interim() {
      return interim;
    },
    get recognition() {
      return FakeRecognition.instances[FakeRecognition.instances.length - 1];
    }
  };
}

describe("tidyTranscriptText", () => {
  test("collapses recogniser stutter of three or more repeats", () => {
    assert.equal(speech.tidyTranscriptText("I I I think so", "en-US"), "I think so");
  });

  test("leaves a genuine double word alone", () => {
    assert.equal(speech.tidyTranscriptText("that is very very good", "en-US"), "That is very very good");
  });

  test("normalises punctuation spacing without recasing mid-sentence words", () => {
    assert.equal(speech.tidyTranscriptText("wait , I hear you .now", "en-US"), "Wait, I hear you. now");
  });

  test("capitalises English but not Hebrew", () => {
    assert.equal(speech.tidyTranscriptText("we talked", "en-US"), "We talked");
    assert.equal(speech.tidyTranscriptText("דיברנו", "he-IL"), "דיברנו");
  });

  test("returns empty for whitespace", () => {
    assert.equal(speech.tidyTranscriptText("   ", "en-US"), "");
  });
});

describe("detectScriptLanguage", () => {
  test("identifies Hebrew script", () => {
    assert.equal(speech.detectScriptLanguage("אני מרי2יש"), "he-IL");
  });

  test("identifies Latin script", () => {
    assert.equal(speech.detectScriptLanguage("I hear you"), "en-US");
  });

  test("returns null when there is too little to go on", () => {
    assert.equal(speech.detectScriptLanguage("ok"), null);
  });
});

describe("Transcriber utterance assembly", () => {
  test("merges consecutive final fragments into one turn", () => {
    const ctx = newTranscriber();
    ctx.recognition.say("I hear that", 0.9);
    ctx.recognition.say("you felt alone", 0.9);
    assert.equal(ctx.utterances.length, 0, "nothing emitted while the turn is still open");

    ctx.transcriber.flush();
    assert.equal(ctx.utterances.length, 1);
    assert.equal(ctx.utterances[0].text, "I hear that you felt alone");
  });

  test("closes the turn after a silence", async () => {
    const ctx = newTranscriber({ initialLanguage: "en-US" });
    ctx.recognition.say("that landed hard", 0.9);
    await wait(speech.SILENCE_FLUSH_MS + 300);
    assert.equal(ctx.utterances.length, 1);
    assert.equal(ctx.utterances[0].text, "That landed hard");
    ctx.transcriber.stop();
  });

  test("drops low-confidence room noise but keeps unreported confidence", () => {
    const ctx = newTranscriber();
    ctx.recognition.say("mmhm shhh", 0.05);
    ctx.transcriber.flush();
    assert.equal(ctx.utterances.length, 0, "0.05 confidence is noise");

    ctx.recognition.say("say more about that", 0);
    ctx.transcriber.flush();
    assert.equal(ctx.utterances.length, 1, "confidence 0 means unreported, not noise");
  });

  test("ignores a fragment the recogniser repeats", () => {
    const ctx = newTranscriber({ initialLanguage: "en-US" });
    ctx.recognition.say("we agreed on that", 0.9);
    ctx.recognition.say("we agreed on that", 0.9);
    ctx.transcriber.flush();
    assert.equal(ctx.utterances[0].text, "We agreed on that");
  });

  test("averages confidence across the merged turn", () => {
    const ctx = newTranscriber();
    ctx.recognition.say("first part", 0.8);
    ctx.recognition.say("second part", 0.6);
    ctx.transcriber.flush();
    assert.ok(Math.abs((ctx.utterances[0].confidence ?? 0) - 0.7) < 1e-9);
  });

  test("timestamps the turn from the clock, not the word count", async () => {
    const ctx = newTranscriber();
    ctx.recognition.say("a short line", 0.9);
    await wait(120);
    ctx.recognition.say("and the rest of it", 0.9);
    ctx.transcriber.flush();

    const utterance = ctx.utterances[0];
    assert.ok(utterance.endedAtMs - utterance.startedAtMs >= 100, "turn spans the real elapsed time");
  });

  test("surfaces interim text without emitting a turn", () => {
    const ctx = newTranscriber();
    ctx.recognition.say("I was going to", 0.5, false);
    assert.equal(ctx.interim, "I was going to");
    assert.equal(ctx.utterances.length, 0);
  });
});

describe("Transcriber language selection", () => {
  test("switches language after sustained low confidence", () => {
    const ctx = newTranscriber();
    assert.equal(ctx.recognition.lang, "he-IL");

    for (let i = 0; i < 4; i += 1) {
      ctx.recognition.say("four words go here", 0.4);
    }

    assert.equal(ctx.recognition.lang, "en-US", "low Hebrew confidence moves it to English");
  });

  test("locks the language once one scores well, and stops switching", () => {
    const ctx = newTranscriber();
    for (let i = 0; i < 4; i += 1) {
      ctx.recognition.say("four words go here", 0.9);
    }
    assert.equal(ctx.recognition.lang, "he-IL");

    // Even a bad run afterwards must not flip a locked language.
    for (let i = 0; i < 6; i += 1) {
      ctx.recognition.say("four words go here", 0.35);
    }
    assert.equal(ctx.recognition.lang, "he-IL");
  });

  test("keeps the better of the two once both have been tried", () => {
    const ctx = newTranscriber();
    for (let i = 0; i < 4; i += 1) {
      ctx.recognition.say("four words go here", 0.4);
    }
    assert.equal(ctx.recognition.lang, "en-US");

    // English scores worse still, so Hebrew is restored and the choice is final.
    for (let i = 0; i < 4; i += 1) {
      ctx.recognition.say("four words go here", 0.35);
    }
    assert.equal(ctx.recognition.lang, "he-IL");

    const instancesAfterLock = FakeRecognition.instances.length;
    for (let i = 0; i < 8; i += 1) {
      ctx.recognition.say("four words go here", 0.31);
    }
    assert.equal(FakeRecognition.instances.length, instancesAfterLock, "no further restarts once locked");
  });

  test("does not switch when the browser reports no confidence", () => {
    const ctx = newTranscriber();
    for (let i = 0; i < 8; i += 1) {
      ctx.recognition.say("four words go here", 0);
    }
    assert.equal(ctx.recognition.lang, "he-IL");
  });

  test("honours an explicit language and never switches away from it", () => {
    const ctx = newTranscriber({ language: "en-US" });
    assert.equal(ctx.recognition.lang, "en-US");
    for (let i = 0; i < 8; i += 1) {
      ctx.recognition.say("four words go here", 0.2);
    }
    assert.equal(ctx.recognition.lang, "en-US");
  });
});

describe("Transcriber resilience", () => {
  test("restarts after the recogniser drops out mid-session", async () => {
    const ctx = newTranscriber();
    const before = FakeRecognition.instances.length;
    ctx.recognition.stop();
    await wait(400);
    assert.ok(FakeRecognition.instances.length > before, "a new recogniser is spawned");
    ctx.transcriber.stop();
  });

  test("stops trying when the microphone is blocked", async () => {
    const ctx = newTranscriber();
    ctx.recognition.fail("not-allowed");
    const blocked = ctx.statuses.some((status) => status.state === "blocked");
    assert.ok(blocked, "reports the permission problem");

    const before = FakeRecognition.instances.length;
    ctx.recognition.stop();
    await wait(400);
    assert.equal(FakeRecognition.instances.length, before, "does not loop on a blocked microphone");
  });

  test("stop() flushes the turn in progress", () => {
    const ctx = newTranscriber({ initialLanguage: "en-US" });
    ctx.recognition.say("one last thing", 0.9);
    ctx.transcriber.stop();
    assert.equal(ctx.utterances.length, 1);
    assert.equal(ctx.utterances[0].text, "One last thing");
  });
});
