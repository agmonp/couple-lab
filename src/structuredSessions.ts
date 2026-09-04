import type {
  BodySignals,
  InteractionTag,
  PartnerId,
  SafetyState,
  StructuredFlowRecord,
  StructuredSessionKind,
  StructuredStepBoundary
} from "./types";

/**
 * Structured sessions — "אחרי ריב" (Aftermath of a Fight) and
 * "שיחה מפחיתת-לחץ" (Stress-Reducing Conversation).
 *
 * This module is the pure, testable core: the step blueprints in Hebrew, the
 * safety gate for Aftermath, the mapping from deck id to session kind, and the
 * helpers that turn a recorded flow into conversation-structure tags and a
 * descriptive stress-change line. It holds no React and no side effects so the
 * whole design can be unit-tested the way the rest of the engine is.
 *
 * Product boundary: nothing here infers a partner's feelings or decides who was
 * right. The feelings palette is self-report, the "reality" step is explicitly
 * subjective, and the stress numbers are self-reported sliders. See PRODUCT.md
 * and docs/STRUCTURED_SESSIONS_SPEC.md.
 */

export const AFTERMATH_DECK_ID = "aftermath";
export const STRESS_REDUCING_DECK_ID = "stress-reducing";

/** Stress at or above this (0–10 self-report) makes Aftermath caution, not block. */
export const HIGH_STRESS_THRESHOLD = 7;

/**
 * How a step is meant to be spoken. Drives the turn indicator in the UI; it is
 * guidance for the couple, never an automated judgement.
 * - speaker-then-switch: one speaks, then they swap.
 * - reflect-and-validate: listener mirrors and validates before swapping.
 * - both-share: each says their own, no strict order.
 * - listener-support: one talks, the other only supports (stress-reducing turn).
 */
export type StructuredTurnModel =
  | "speaker-then-switch"
  | "reflect-and-validate"
  | "both-share"
  | "listener-support";

export interface StructuredStep {
  key: string;
  title: string;
  /** One sentence: what this step is for. */
  intent: string;
  /** The soft guiding prompt shown to the couple. */
  prompt: string;
  turnModel: StructuredTurnModel;
}

/**
 * Aftermath step 1 — a self-report palette. The partner picks words that fit
 * how *they* felt; the app never assigns a feeling. Deliberately about feelings
 * during the incident, with no "because" and no "you did".
 */
export const FEELINGS_PALETTE: string[] = [
  "פגוע/ה",
  "לא מובן/ת",
  "מבוטל/ת",
  "לא מוערך/ת",
  "מותקף/ת",
  "חסר/ת אונים",
  "בודד/ה",
  "מוצף/ת",
  "מאוכזב/ת",
  "חושש/ת"
];

/** The five sequential steps of "אחרי ריב" (retrospective, calm, never mid-storm). */
export const AFTERMATH_STEPS: StructuredStep[] = [
  {
    key: "feelings",
    title: "רגשות — מה הרגשתי",
    intent: "כל אחד שם מילים על מה שהרגיש באירוע, בלי להסביר למה ובלי לתאר מה השני עשה.",
    prompt: "בחרו מהפָּלֶטה ואמרו בקול: הרגשתי ___. רק שמות של רגשות — עדיין בלי 'כי' ובלי 'אתה'.",
    turnModel: "both-share"
  },
  {
    key: "realities",
    title: "המציאות של כל אחד",
    intent: "כל אחד מתאר איך זה נראה מבפנים; המקשיב/ה משקף/ת ומתקף/ת לפני שמציג/ה עמדה.",
    prompt: "הדובר/ת: 'מה ראיתי, מה שמעתי, איך חוויתי'. המקשיב/ה: 'אני מבין/ה איך זה נראה מנקודת המבט שלך'. אין כאן הכרעה מי צודק.",
    turnModel: "reflect-and-validate"
  },
  {
    key: "triggers",
    title: "טריגרים — מה הצית אותי",
    intent: "מהו הרגע שהסלים, ומה הסיפור וההיסטוריה שמאחוריו.",
    prompt: "ספרו: 'הרגע שהצית אותי היה ___. זה מזכיר לי ___. אני רגיש/ה לזה כי ___.'",
    turnModel: "speaker-then-switch"
  },
  {
    key: "ownership",
    title: "האחריות שלי",
    intent: "כל אחד לוקח אחריות על חלקו — לא על חלק השני.",
    prompt: "אמרו: 'החלק שלי בזה היה ___. מה שהכין אותי להיות פגיע/ה או חד/ה יותר היה ___. אני מצטער/ת על ___.'",
    turnModel: "both-share"
  },
  {
    key: "plan",
    title: "תוכנית קטנה להמשך",
    intent: "דבר מעשי אחד לפעם הבאה, ומשפט תיקון קטן שאפשר לזהות באמצע.",
    prompt: "כל אחד: 'בפעם הבאה אני אנסה ___.' ואז הסכימו יחד על משפט תיקון קצר שתזהו ('בוא נתחיל מחדש', 'אני איתך').",
    turnModel: "both-share"
  }
];

/**
 * The five listener guidelines of "שיחה מפחיתת-לחץ". Unlike Aftermath these are
 * *simultaneous* rules that apply inside each turn, not sequential phases —
 * shown to whoever is currently listening.
 */
export const LISTENER_RULES: string[] = [
  "תורות — עכשיו התור של אחד, השני מקשיב.",
  "לא לפתור — הבנה לפני עצה; לא לתת עצה שלא ביקשו.",
  "תשומת לב אמיתית — קשר עין, בלי הסחות, לשאול מתוך עניין.",
  "הזדהות והבנה — 'זה הגיוני', 'גם אני הייתי מרגיש/ה ככה'.",
  "להיות בצד שלו/שלה — ברית, 'אנחנו מול הלחץ'."
];

/**
 * Stress-reducing is two symmetric turns. Each turn is one partner talking
 * about *external* stress while the other supports per LISTENER_RULES.
 */
export const STRESS_REDUCING_STEPS: StructuredStep[] = [
  {
    key: "turn-1",
    title: "תור ראשון",
    intent: "אחד מדבר על לחץ מבחוץ; השני מקשיב לפי חמשת הכללים.",
    prompt: "המדבר/ת בוחר/ת נושא מחוץ לקשר (עבודה, משפחה, עולם) ופורק/ת. המקשיב/ה רק תומך/ת — לא פותר/ת.",
    turnModel: "listener-support"
  },
  {
    key: "turn-2",
    title: "תור שני",
    intent: "מתחלפים — אותם חמשת הכללים.",
    prompt: "עכשיו מתחלפים. הנושא עדיין מבחוץ, וההקשבה אותה הקשבה תומכת.",
    turnModel: "listener-support"
  }
];

export function structuredKindForDeck(deckId: string | undefined | null): StructuredSessionKind | null {
  if (deckId === AFTERMATH_DECK_ID) return "aftermath";
  if (deckId === STRESS_REDUCING_DECK_ID) return "stress-reducing";
  return null;
}

export function isStructuredDeck(deckId: string | undefined | null): boolean {
  return structuredKindForDeck(deckId) !== null;
}

export function structuredStepsForKind(kind: StructuredSessionKind): StructuredStep[] {
  return kind === "aftermath" ? AFTERMATH_STEPS : STRESS_REDUCING_STEPS;
}

export function structuredKindLabel(kind: StructuredSessionKind): string {
  return kind === "aftermath" ? "אחרי ריב" : "שיחה מפחיתת-לחץ";
}

export interface AftermathGateInput {
  signals: BodySignals;
  safety: SafetyState;
}

export interface AftermathGateResult {
  /** false → a hard block: do not let the session start. */
  allowed: boolean;
  /** Present when blocked: why, in Hebrew, framed toward support. */
  blockingReason?: string;
  /** Present when allowed but worth pausing on (e.g. still elevated). */
  cautionReason?: string;
}

/**
 * The Aftermath gate. Hard-blocks when the safety check flags fear, coercion,
 * threats or violence — Aftermath is for regrettable incidents, never for
 * processing abuse (Gottman; PRODUCT.md). Cautions (but allows) when either
 * partner's self-reported stress is still high, since the tool is meant for a
 * calm, retrospective moment rather than the middle of the storm.
 */
export function evaluateAftermathGate({ signals, safety }: AftermathGateInput): AftermathGateResult {
  if (
    safety.fearOrCoercion ||
    safety.violenceOrThreats ||
    safety.pressuredToParticipate ||
    safety.seriousDepressionOrAddiction
  ) {
    return {
      allowed: false,
      blockingReason:
        "התרגול הזה הוא לעיבוד ריב שכבר נגמר בין בני זוג שמרגישים בטוחים. כשיש פחד, כפייה, איום או אלימות — לא ממשיכים כאן, ופונים לתמיכה מקצועית מתאימה."
    };
  }
  const peakStress = Math.max(signals.A?.stress ?? 0, signals.B?.stress ?? 0);
  if (peakStress >= HIGH_STRESS_THRESHOLD) {
    return {
      allowed: true,
      cautionReason:
        "רמת הלחץ שסימנתם עדיין גבוהה. 'אחרי ריב' עובד הכי טוב כשרגועים — אפשר לקחת נשימה, ואם צריך לחזור לזה מאוחר יותר."
    };
  }
  return { allowed: true };
}

/**
 * Turn a recorded structured flow into conversation-structure interaction tags,
 * one per step that actually ran. These let the report show per-step coverage;
 * the family already exists in the type system reserved for exactly this, so no
 * schema change is needed. They are descriptive markers, not judgements —
 * confidence is 1 because the boundary is a fact of the flow, not an inference.
 */
export function buildStructuredTags(flow: StructuredFlowRecord): InteractionTag[] {
  const kindLabel = structuredKindLabel(flow.kind);
  return flow.steps.map((step, index) => ({
    id: `structure-${flow.kind}-${step.key}-${index}`,
    label: step.title,
    family: "conversation-structure",
    source: "derived",
    seconds: Math.max(0, Math.round(step.startSeconds)),
    endSeconds: typeof step.endSeconds === "number" ? Math.max(0, Math.round(step.endSeconds)) : undefined,
    speaker: step.speaker,
    evidence: `שלב '${step.title}' ב${kindLabel}`,
    confidence: 1,
    metadata: { step: step.key, kind: flow.kind }
  }));
}

export interface StructuredFlowStepDisplay {
  key: string;
  title: string;
  /** "m:ss", or a fixed label when the step has no recorded end time yet. */
  durationLabel: string;
  speaker?: PartnerId;
}

function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Turns a flow's raw step boundaries into report-ready rows: one line per
 * step/turn with a formatted duration. Purely descriptive — no pacing
 * judgment, no color-coding by length; see docs/STRUCTURED_SESSIONS_SPEC.md §7.5.
 */
export function describeStructuredFlowSteps(steps: StructuredStepBoundary[]): StructuredFlowStepDisplay[] {
  return steps.map((step) => ({
    key: step.key,
    title: step.title,
    durationLabel: typeof step.endSeconds === "number"
      ? formatDuration(step.endSeconds - step.startSeconds)
      : "עד סוף השיחה",
    speaker: step.speaker
  }));
}

function stressChangeWord(delta: number): string {
  if (delta <= -3) return "ירד בהרבה";
  if (delta < 0) return "ירד";
  if (delta === 0) return "נשאר דומה";
  if (delta >= 3) return "עלה בהרבה";
  return "עלה";
}

/**
 * A single descriptive line about how the self-reported stress changed, per
 * partner. Purely factual ("הלחץ שסימנת ירד מ-7 ל-4"); never a grade of the
 * listener and never a claim about the relationship. Returns null when there is
 * nothing to compare.
 */
export function summarizeStressChange(
  before: Partial<Record<PartnerId, number>> | undefined,
  after: Partial<Record<PartnerId, number>> | undefined,
  nameFor: (partner: PartnerId) => string
): string | null {
  if (!before || !after) return null;
  const parts: string[] = [];
  (["A", "B"] as PartnerId[]).forEach((partner) => {
    const from = before[partner];
    const to = after[partner];
    if (typeof from !== "number" || typeof to !== "number") return;
    parts.push(`הלחץ ש${nameFor(partner)} סימן/ה ${stressChangeWord(to - from)} — מ-${from} ל-${to}`);
  });
  return parts.length ? parts.join(" · ") : null;
}
