import {
  BodySignals,
  EmotionalStateScores,
  InteractionTag,
  InteractionTagFamily,
  LiveCue,
  PartnerId,
  PatternHit,
  SessionAnalysis,
  SessionMetrics,
  SessionType,
  TranscriptSegment,
  VisualObservation,
  VocalObservation
} from "./types";
import { sessionEvidenceSummary } from "./sessionFlow";
import { fuzzyMatchesAny } from "./transcriptMatch";

/**
 * Stable label for the contempt-risk pattern. UI logic must key on this
 * constant (not on a copied Hebrew string) so copy edits cannot silently
 * disable adviser behavior.
 */
export const CONTEMPT_RISK_LABEL = "חשש לניסוח מזלזל";

type TranscriptPattern = {
  label: string;
  regex: RegExp;
  hitFamily: PatternHit["family"];
  tagFamily: InteractionTagFamily;
  suggestion: string;
  confidence: number;
  metadata?: Record<string, string | number | boolean>;
  /**
   * Distinctive Hebrew phrases for the noise-tolerant fallback. Only consulted
   * when the exact regex misses, and only ever at reduced confidence — so a
   * misheard word can surface a likely pattern without ever asserting it.
   */
  fuzzyPhrases?: string[];
};

const transcriptPatterns: TranscriptPattern[] = [
  {
    label: "פתיחה שנשמעת ביקורתית",
    regex:
      /\b(you always|you never|what is wrong with you|you are so|you don't care|you only care)\b|(?:אתה|את)\s+(?:תמיד|אף פעם|לא\s+אכפת)|מה הבעיה שלך|לא אכפת לך/i,
    hitFamily: "risk",
    tagFamily: "four-horsemen",
    suggestion: "נסחו פתיחה רכה: תארו אירוע מסוים, אמרו איך הוא השפיע עליכם ובקשו דבר מעשי אחד.",
    confidence: 0.76,
    metadata: { horseman: "criticism", antidote: "gentle startup" },
    fuzzyPhrases: ["אתה תמיד", "את תמיד", "אתה אף פעם", "את אף פעם", "לא אכפת לך", "מה הבעיה שלך"]
  },
  {
    label: CONTEMPT_RISK_LABEL,
    regex:
      /\b(whatever|ridiculous|pathetic|grow up|that's stupid|you sound crazy|typical|idiot)\b|מגוחך|פתטי|תתבגר|תתבגרי|מטומטם|מטומטמת|הזוי|הזויה/i,
    hitFamily: "risk",
    tagFamily: "four-horsemen",
    suggestion: "עצרו את הטון המתנשא, אמרו מה כאב והוסיפו משפט אחד של כבוד או הערכה.",
    confidence: 0.78,
    metadata: { horseman: "contempt", antidote: "fondness and admiration" },
    fuzzyPhrases: ["אתה פתטי", "את פתטית", "זה מגוחך", "אתה מטומטם", "את מטומטמת", "זה הזוי"]
  },
  {
    label: "חשש להתגוננות",
    regex:
      /\b(not my fault|you did it too|why are you attacking|i only did that because|that is not true|you started)\b|לא אשמתי|גם את|גם אתה|למה את תוקפת|למה אתה תוקף|זה לא נכון/i,
    hitFamily: "risk",
    tagFamily: "four-horsemen",
    suggestion: "קחו אחריות על חלק קטן אחד לפני שתסבירו את נקודת המבט שלכם.",
    confidence: 0.74,
    metadata: { horseman: "defensiveness", antidote: "take responsibility" },
    fuzzyPhrases: ["זה לא אשמתי", "גם אתה", "גם את", "זה לא נכון", "למה אתה תוקף", "למה את תוקפת", "אתה התחלת", "את התחלת"]
  },
  {
    label: "חשש להיסגרות או ניתוק",
    regex:
      /\b(i am done|i'm done|leave me alone|i don't want to talk|nothing to say|stop talking|whatever)\b|עזבי אותי|עזוב אותי|אין לי מה להגיד|לא רוצה לדבר|סיימתי|תפסיקי לדבר|תפסיק לדבר/i,
    hitFamily: "risk",
    tagFamily: "four-horsemen",
    suggestion: "קחו הפסקה מתוזמנת להרגעה וחזרו לשיחה בזמן שעליו הסכמתם.",
    confidence: 0.72,
    metadata: { horseman: "stonewalling", antidote: "self soothing break" },
    fuzzyPhrases: ["אין לי מה להגיד", "לא רוצה לדבר", "עזוב אותי", "עזבי אותי", "תפסיק לדבר", "תפסיקי לדבר"]
  },
  {
    label: "האשמה גורפת",
    regex: /\b(every time|all you do|nothing i do|you make me|you ruined)\b|כל פעם|תמיד את|תמיד אתה|כל מה שאת|כל מה שאתה|את גורמת לי|אתה גורם לי/i,
    hitFamily: "risk",
    tagFamily: "conversation-structure",
    suggestion: "צמצמו את הנושא לרגע אחד שאפשר לתאר ולתקן.",
    confidence: 0.72
  },
  {
    label: "פתיחה רכה",
    regex:
      /\b(i feel|i felt|i need|i would like|would you be willing|can we|could we)\b|אני מרגיש|אני מרגישה|אני צריך|אני צריכה|היית מוכן|היית מוכנה|אפשר ש|אפשר לדבר/i,
    hitFamily: "strength",
    tagFamily: "conversation-structure",
    suggestion: "כיוון טוב. הישארו ממוקדים ובקשו שינוי מעשי אחד.",
    confidence: 0.8,
    metadata: { skill: "gentle startup" },
    fuzzyPhrases: ["אני מרגיש", "אני מרגישה", "אני צריך", "אני צריכה", "היית מוכן", "היית מוכנה", "אפשר לדבר"]
  },
  {
    label: "תיקוף והקשבה",
    regex:
      /\b(i hear you|that makes sense|i get why|i understand|tell me more|i can see|that sounds hard)\b|אני שומע|אני שומעת|זה הגיוני|אני מבין|אני מבינה|אני רואה|ספרי לי עוד|ספר לי עוד/i,
    hitFamily: "strength",
    tagFamily: "strength",
    suggestion: "הישארו עוד מעט בהקשבה לפני שעוברים לפתרונות.",
    confidence: 0.8,
    metadata: { skill: "attunement" },
    fuzzyPhrases: ["אני שומע אותך", "אני שומעת אותך", "זה הגיוני", "אני מבין אותך", "אני מבינה אותך", "ספר לי עוד", "ספרי לי עוד"]
  },
  {
    label: "הפקדה בחשבון הרגשי",
    regex:
      /\b(i appreciate|thank you|i love|i admire|i'm grateful|you matter|i noticed that you)\b|תודה|אני מעריך|אני מעריכה|אני אוהב|אני אוהבת|אני גאה|שמתי לב ש/i,
    hitFamily: "strength",
    tagFamily: "strength",
    suggestion: "הפכו את ההערכה למסוימת ועכשווית, כדי שתהיה משאב גם ברגעי לחץ.",
    confidence: 0.82,
    metadata: { skill: "emotional bank account" },
    fuzzyPhrases: ["אני מעריך אותך", "אני מעריכה אותך", "אני אוהב אותך", "אני אוהבת אותך", "שמתי לב ש", "אני גאה בך"]
  },
  {
    label: "היענות לפנייה לקרבה",
    regex:
      /\b(tell me|show me|i'm listening|i am listening|what happened|do you have a minute|can i show you)\b|תקשיב|תקשיבי|תראה|תראי|אני מקשיב|אני מקשיבה|מה קרה|אפשר רגע/i,
    hitFamily: "strength",
    tagFamily: "strength",
    suggestion: "זה רגע של פנייה או היענות לקרבה. תגובות קטנות מצטברות לאורך זמן.",
    confidence: 0.72,
    metadata: { skill: "turning toward" },
    fuzzyPhrases: ["אני מקשיב", "אני מקשיבה", "מה קרה", "אפשר רגע", "תקשיב לי", "תקשיבי לי"]
  },
  {
    label: "סקרנות",
    regex:
      /\b(help me understand|what was that like|can you say more|what do you need|what do you mean|i'm curious)\b|תעזור לי להבין|תעזרי לי להבין|מה את צריכה|מה אתה צריך|מה זה אומר לך|אני סקרן|אני סקרנית/i,
    hitFamily: "strength",
    tagFamily: "strength",
    suggestion: "שאלו עוד שאלה אחת לפני שאתם משיבים.",
    confidence: 0.78,
    metadata: { skill: "curiosity before certainty" }
  },
  {
    label: "ניסיון תיקון",
    regex:
      /\b(i'm sorry|i am sorry|that came out wrong|let me try again|can we pause|i don't want to fight|i love you|we are on the same team)\b|סליחה|יצא לי לא טוב|תני לי לנסות שוב|תן לי לנסות שוב|אפשר לעצור|לא רוצה לריב|אנחנו באותו צד/i,
    hitFamily: "repair",
    tagFamily: "repair",
    suggestion: "האטו ותנו לניסיון התיקון להיקלט לפני שממשיכים.",
    confidence: 0.84,
    metadata: { skill: "repair attempt" },
    fuzzyPhrases: ["אני מצטער", "אני מצטערת", "תן לי לנסות שוב", "תני לי לנסות שוב", "לא רוצה לריב", "אנחנו באותו צד", "אפשר לעצור"]
  },
  {
    label: "לקיחת אחריות",
    regex:
      /\b(my part is|i can own|i take responsibility|i should have|i missed|i see my part)\b|החלק שלי|אני לוקח אחריות|אני לוקחת אחריות|הייתי צריך|הייתי צריכה|פספסתי/i,
    hitFamily: "repair",
    tagFamily: "repair",
    suggestion: "אמרו מה הייתה ההשפעה על בן או בת הזוג ומה תעשו בפעם הבאה.",
    confidence: 0.82,
    metadata: { skill: "personal responsibility" },
    fuzzyPhrases: ["החלק שלי", "אני לוקח אחריות", "אני לוקחת אחריות", "הייתי צריך", "הייתי צריכה", "אני אשם", "אני אשמה"]
  },
  {
    label: "רמז לתשוקה או חיות",
    regex:
      /\b(i miss us|i want you|i desire|i feel alive|playful|adventure|space to miss|mystery)\b|אני מתגעגע|אני מתגעגעת|אני רוצה אותך|חשק|תשוקה|משחקיות|הרפתקה|מרחב|חופש/i,
    hitFamily: "strength",
    tagFamily: "desire",
    suggestion: "שמרו גם על קרבה וגם על נפרדות. שאלו מה יוסיף חיות לקשר השבוע.",
    confidence: 0.68,
    metadata: { lens: "desire and separateness" }
  }
];

const visualStressLabels = new Set<VisualObservation["label"]>([
  "brow-tension",
  "mouth-tension",
  "closed-posture",
  "leaning-away",
  "looking-away",
  "head-turned-away",
  "sustained-tension",
  "possible-withdrawal"
]);

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function otherPartner(partner?: PartnerId): PartnerId | undefined {
  if (!partner) return undefined;
  return partner === "A" ? "B" : "A";
}

function segmentEnd(segment: TranscriptSegment) {
  return segment.endSeconds ?? segment.seconds;
}

function findLinkedSegment(segments: TranscriptSegment[], seconds: number) {
  let bestSegment: TranscriptSegment | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    const start = segment.seconds;
    const end = segmentEnd(segment);
    const distance = seconds >= start && seconds <= end ? 0 : Math.min(Math.abs(seconds - start), Math.abs(seconds - end));
    if (distance <= 3 && distance < bestDistance) {
      bestSegment = segment;
      bestDistance = distance;
    }
  }

  return bestSegment;
}

type MatchType = "exact" | "fuzzy";

// A fuzzy match rests on a possibly-misheard word, so it is always reported as
// less certain than an exact one.
const FUZZY_CONFIDENCE_FACTOR = 0.85;

function matchConfidence(pattern: TranscriptPattern, matchType: MatchType) {
  return matchType === "fuzzy"
    ? Math.round(pattern.confidence * FUZZY_CONFIDENCE_FACTOR * 100) / 100
    : pattern.confidence;
}

function makeHit(pattern: TranscriptPattern, segment: TranscriptSegment, matchType: MatchType = "exact"): PatternHit {
  return {
    id: `${pattern.hitFamily}-${segment.id}-${slug(pattern.label)}`,
    label: pattern.label,
    family: pattern.hitFamily,
    speaker: segment.speaker,
    target: segment.target ?? otherPartner(segment.speaker),
    seconds: segment.seconds,
    endSeconds: segmentEnd(segment),
    source: "transcript",
    segmentId: segment.id,
    evidence: segment.text,
    suggestion: matchType === "fuzzy"
      ? `${pattern.suggestion} (זוהה מתוך תמלול שאולי אינו מדויק — כדאי לוודא שזה מה שנאמר.)`
      : pattern.suggestion,
    confidence: matchConfidence(pattern, matchType)
  };
}

function makeTag(pattern: TranscriptPattern, segment: TranscriptSegment, matchType: MatchType = "exact"): InteractionTag {
  return {
    id: `tag-${segment.id}-${slug(pattern.label)}`,
    label: pattern.label,
    family: pattern.tagFamily,
    source: "transcript",
    seconds: segment.seconds,
    endSeconds: segmentEnd(segment),
    speaker: segment.speaker,
    target: segment.target ?? otherPartner(segment.speaker),
    segmentId: segment.id,
    evidence: segment.text,
    suggestion: pattern.suggestion,
    confidence: matchConfidence(pattern, matchType),
    metadata: {
      ...(pattern.metadata ?? {}),
      matchType,
      wordCount: segment.wordCount ?? countWords(segment.text),
      detectedLanguage: segment.detectedLanguage ?? "unknown"
    }
  };
}

function scanSegments(segments: TranscriptSegment[]) {
  const hits: PatternHit[] = [];
  const tags: InteractionTag[] = [];

  segments.forEach((segment) => {
    transcriptPatterns.forEach((pattern) => {
      // Exact regex first (unchanged behaviour). Only when it misses do we fall
      // back to the noise-tolerant phrase match, and then at lower confidence —
      // a misheard transcript can surface a likely pattern, never assert it.
      const matchType: MatchType | null = pattern.regex.test(segment.text)
        ? "exact"
        : fuzzyMatchesAny(segment.text, pattern.fuzzyPhrases ?? [])
          ? "fuzzy"
          : null;
      if (matchType) {
        hits.push(makeHit(pattern, segment, matchType));
        tags.push(makeTag(pattern, segment, matchType));
      }
    });
  });

  return { hits, tags };
}

function cueHits(cues: LiveCue[]): PatternHit[] {
  return cues.map((cue) => {
    const positive = cue.tone === "warmth" || cue.tone === "repair" || cue.tone === "humor" || cue.tone === "softening";
    const tone = cueToneLabel(cue.tone);
    return {
      id: `cue-${cue.id}`,
      label: `סומן רמז: ${tone}`,
      family: positive ? "strength" : "body",
      speaker: cue.speaker,
      target: otherPartner(cue.speaker),
      seconds: cue.seconds,
      source: "manual-cue",
      cueId: cue.id,
      evidence: `סומן בשנייה ${Math.round(cue.seconds)}`,
      suggestion: positive
        ? "אמרו מה עבד ברגע הזה כדי שתוכלו לחזור עליו."
        : "בדקו בעדינות אם היה כאן לחץ, התרחקות או פשוט רגע רגיל של שקט.",
      confidence: 0.62
    };
  });
}

function cueTags(cues: LiveCue[]): InteractionTag[] {
  return cues.map((cue) => {
    const positive = cue.tone === "warmth" || cue.tone === "repair" || cue.tone === "humor" || cue.tone === "softening";
    const tone = cueToneLabel(cue.tone);
    return {
      id: `tag-cue-${cue.id}`,
      label: `רמז ידני: ${tone}`,
      family: cue.tone === "overwhelm" || cue.tone === "pause" ? "flooding" : positive ? "strength" : "nonverbal",
      source: "manual-cue",
      seconds: cue.seconds,
      speaker: cue.speaker,
      target: otherPartner(cue.speaker),
      cueId: cue.id,
      evidence: `המשתמש סימן ${tone} בשנייה ${Math.round(cue.seconds)}`,
      suggestion: positive ? "השתמשו ברמז כדי לחזק דפוס שעובד." : "השתמשו ברמז כהזמנה לבדיקה עדינה.",
      confidence: 0.62,
      metadata: { cueTone: cue.tone }
    };
  });
}

function cueToneLabel(tone: LiveCue["tone"]) {
  const labels: Record<LiveCue["tone"], string> = {
    warmth: "חום",
    repair: "תיקון",
    humor: "הומור",
    softening: "התרככות",
    overwhelm: "הצפה",
    pause: "הפסקה",
    "look-away": "הסטת מבט"
  };
  return labels[tone];
}

function visualLabel(observation: VisualObservation) {
  const labelMap: Record<VisualObservation["label"], string> = {
    "face-visible": "פנים נראות",
    "warm-expression": "רמז אפשרי לחום",
    "brow-tension": "רמז אפשרי למתח בפנים",
    "mouth-tension": "רמז אפשרי למתח בפה",
    "looking-away": "מבט אפשרי הצידה",
    "partner-gaze": "מבט אפשרי לעבר בן או בת הזוג",
    "mutual-attention": "קשב הדדי אפשרי",
    "shared-frame": "שניכם בתמונה",
    "body-visible": "תנוחת הגוף נראית",
    "closed-posture": "תנוחה סגורה אפשרית",
    "leaning-away": "הישענות אפשרית לאחור",
    "head-turned-away": "הפניית ראש אפשרית",
    "sustained-warmth": "רצף אפשרי של חום",
    "sustained-tension": "רצף אפשרי של מתח",
    "possible-engagement": "מעורבות אפשרית",
    "possible-withdrawal": "תנוחת התרחקות אפשרית",
    "capture-quality": "איכות כיסוי המצלמה",
    "smile-configuration": "תנועת זוויות הפה",
    "brow-movement": "תנועת גבות",
    "mouth-press": "הצמדת שפתיים",
    "eyes-turned-sideways": "כיוון עיניים הצידה",
    "head-orientation-offset": "כיוון הראש השתנה מהמרכז",
    "head-orientation-change": "שינוי בכיוון הראש",
    "wrists-near-opposite-shoulders": "פרקי הידיים ליד הכתפיים הנגדיות",
    "body-near-frame-edge": "מרכז הגוף ליד שולי התמונה",
    "body-movement": "תנועת גוף בין רגעים"
  };

  return labelMap[observation.label];
}

function visualHits(observations: VisualObservation[], segments: TranscriptSegment[]): PatternHit[] {
  return observations.filter((observation) => observation.label !== "capture-quality").slice(-40).map((observation) => {
    const linkedSegment = findLinkedSegment(segments, observation.seconds);
    const positive =
      observation.label === "face-visible" ||
      observation.label === "warm-expression" ||
      observation.label === "partner-gaze" ||
      observation.label === "mutual-attention" ||
      observation.label === "shared-frame" ||
      observation.label === "body-visible";

    return {
      id: `visual-${observation.id}`,
      label: visualLabel(observation),
      family: positive ? "strength" : "body",
      speaker: observation.subject ?? linkedSegment?.speaker,
      target: observation.subject ? otherPartner(observation.subject) : linkedSegment?.target,
      seconds: observation.seconds,
      source: "visual",
      segmentId: linkedSegment?.id,
      observationId: observation.id,
      evidence: `${visualLabel(observation)} בשנייה ${Math.round(observation.seconds)}`,
      suggestion: positive
        ? "אפשר להשתמש בזה כרמז תומך ולבדוק מול מה שכל אחד הרגיש."
        : "התייחסו לזה כשאלה לבדיקה עדינה, לא כהוכחה לרגש.",
      confidence: clamp(observation.score, 0.35, 0.86)
    };
  });
}

function visualTags(observations: VisualObservation[], segments: TranscriptSegment[]): InteractionTag[] {
  return observations.filter((observation) => observation.label !== "capture-quality").map((observation) => {
    const linkedSegment = findLinkedSegment(segments, observation.seconds);
    const stressCue = visualStressLabels.has(observation.label);

    return {
      id: `tag-visual-${observation.id}`,
      label: visualLabel(observation),
      family: "nonverbal",
      source: "visual",
      seconds: observation.seconds,
      speaker: observation.subject ?? linkedSegment?.speaker,
      target: observation.subject ? otherPartner(observation.subject) : linkedSegment?.target,
      segmentId: linkedSegment?.id,
      observationId: observation.id,
      evidence: visualLabel(observation),
      suggestion: stressCue
        ? "בדקו אם זה שיקף לחץ, עייפות, ריכוז או התרחקות לפני שמסיקים מסקנה."
        : "השתמשו בזה כהקשר לרגע המדובר, לא כהוכחה לרגש.",
      confidence: clamp(observation.score, 0.35, 0.86),
      metadata: {
        visualLabel: observation.label,
        linkedTranscript: Boolean(linkedSegment)
      }
    };
  });
}

// Vocal (prosody) cues are probabilistic and descriptive, exactly like the
// camera cues: they enrich the timeline and the nonverbal-stress count, but —
// per the product boundary — they never raise flooding, never create
// emotional-state verdicts, and are never sufficient evidence on their own.
const vocalStressLabels = new Set<VocalObservation["label"]>([
  "raised-voice",
  "tense-voice",
  "flat-withdrawn",
  "long-pause"
]);

function vocalLabel(observation: VocalObservation) {
  const labelMap: Record<VocalObservation["label"], string> = {
    "raised-voice": "הרמת קול אפשרית",
    "tense-voice": "מתח אפשרי בקול",
    "flat-withdrawn": "קול שטוח או מרוחק אפשרי",
    "warm-engaged": "טון חם ומעורב אפשרי",
    "long-pause": "שתיקה ארוכה"
  };
  return labelMap[observation.label];
}

function vocalHits(observations: VocalObservation[], segments: TranscriptSegment[]): PatternHit[] {
  return observations.slice(-40).map((observation) => {
    const linkedSegment = findLinkedSegment(segments, observation.seconds);
    const positive = observation.label === "warm-engaged";
    return {
      id: `vocal-${observation.id}`,
      label: vocalLabel(observation),
      family: positive ? "strength" : "body",
      speaker: observation.subject ?? linkedSegment?.speaker,
      target: observation.subject ? otherPartner(observation.subject) : linkedSegment?.target,
      seconds: observation.seconds,
      source: "vocal",
      segmentId: linkedSegment?.id,
      observationId: observation.id,
      evidence: `${vocalLabel(observation)} בשנייה ${Math.round(observation.seconds)}`,
      suggestion: positive
        ? "אפשר להשתמש בזה כרמז תומך ולבדוק מול מה שכל אחד הרגיש."
        : "התייחסו לזה כשאלה לבדיקה עדינה על צליל הקול, לא כהוכחה לרגש או לכוונה.",
      confidence: clamp(observation.score, 0.35, 0.86)
    };
  });
}

function vocalTags(observations: VocalObservation[], segments: TranscriptSegment[]): InteractionTag[] {
  return observations.map((observation) => {
    const linkedSegment = findLinkedSegment(segments, observation.seconds);
    const stressCue = vocalStressLabels.has(observation.label);
    return {
      id: `tag-vocal-${observation.id}`,
      label: vocalLabel(observation),
      family: "nonverbal",
      source: "vocal",
      seconds: observation.seconds,
      speaker: observation.subject ?? linkedSegment?.speaker,
      target: observation.subject ? otherPartner(observation.subject) : linkedSegment?.target,
      segmentId: linkedSegment?.id,
      observationId: observation.id,
      evidence: vocalLabel(observation),
      suggestion: stressCue
        ? "בדקו אם זה שיקף לחץ, עייפות, התלהבות או התרחקות לפני שמסיקים מסקנה."
        : "השתמשו בזה כהקשר לרגע המדובר, לא כהוכחה לרגש.",
      confidence: clamp(observation.score, 0.35, 0.86),
      metadata: {
        vocalLabel: observation.label,
        linkedTranscript: Boolean(linkedSegment)
      }
    };
  });
}

function detectRepairAcceptance(segments: TranscriptSegment[], tags: InteractionTag[]) {
  const repairSegmentIds = new Set(tags.filter((tag) => tag.family === "repair" && tag.segmentId).map((tag) => tag.segmentId));
  const hits: PatternHit[] = [];
  const acceptedTags: InteractionTag[] = [];

  segments.forEach((segment, index) => {
    if (!repairSegmentIds.has(segment.id)) {
      return;
    }

    const nextSegments = segments.slice(index + 1, index + 3);
    const nextText = nextSegments.map((item) => item.text).join(" ");
    if (/\b(okay|thank you|i hear|i appreciate|let's|yes|that helps)\b|בסדר|תודה|שמעתי|כן|זה עוזר|בוא|בואי/i.test(nextText)) {
      const acceptingSegment = nextSegments[0];
      const seconds = acceptingSegment?.seconds ?? segmentEnd(segment);
      const speaker = acceptingSegment?.speaker;

      hits.push({
        id: `repair-accepted-${segment.id}`,
        label: "ניסיון התיקון התקבל",
        family: "strength",
        speaker,
        target: otherPartner(speaker),
        seconds,
        source: "derived",
        segmentId: acceptingSegment?.id,
        evidence: nextText,
        suggestion: "זה דפוס חשוב של חוסן. שמרו את ניסיונות התיקון קטנים וקבלו אותם מוקדם.",
        confidence: 0.7
      });

      acceptedTags.push({
        id: `tag-repair-accepted-${segment.id}`,
        label: "ניסיון התיקון התקבל",
        family: "repair",
        source: "derived",
        seconds,
        speaker,
        target: otherPartner(speaker),
        segmentId: acceptingSegment?.id,
        evidence: nextText,
        suggestion: "זה רגע משמעותי. חזקו במילים את העובדה שניסיון התיקון התקבל.",
        confidence: 0.7,
        metadata: { repairedSegmentId: segment.id }
      });
    }
  });

  return { hits, tags: acceptedTags };
}

function deriveConversationTags(
  segments: TranscriptSegment[],
  tags: InteractionTag[]
): InteractionTag[] {
  const derived: InteractionTag[] = [];

  segments.forEach((segment, index) => {
    const previous = segments[index - 1];
    if (previous && previous.speaker !== segment.speaker && segment.seconds <= segmentEnd(previous) + 1.5) {
      derived.push({
        id: `tag-interruption-${previous.id}-${segment.id}`,
        label: "חפיפה או קטיעה אפשרית",
        family: "turn-taking",
        source: "derived",
        seconds: segment.seconds,
        endSeconds: segmentEnd(segment),
        speaker: segment.speaker,
        target: previous.speaker,
        segmentId: segment.id,
        evidence: `הדובר הבא התחיל בתוך שנייה וחצי מסיום הקטע הקודם.`,
        suggestion: "בדקו אם זו הייתה התלהבות, תמיכה או קטיעה. אם זה הפריע, האטו את המעבר בין הדוברים.",
        confidence: 0.54
      });
    }

    const words = segment.wordCount ?? countWords(segment.text);
    if (words >= 80) {
      derived.push({
        id: `tag-long-turn-${segment.id}`,
        label: "תור דיבור ארוך",
        family: "turn-taking",
        source: "derived",
        seconds: segment.seconds,
        endSeconds: segmentEnd(segment),
        speaker: segment.speaker,
        target: segment.target ?? otherPartner(segment.speaker),
        segmentId: segment.id,
        evidence: `${words} מילים בתור אחד.`,
        suggestion: "נסו סיכום קצר והזמינו את בן או בת הזוג לשקף מה נשמע.",
        confidence: 0.68
      });
    }
  });

  const horsemenTags = tags.filter((tag) => tag.family === "four-horsemen").sort((a, b) => a.seconds - b.seconds);
  horsemenTags.forEach((tag, index) => {
    const nearby = horsemenTags.slice(index, index + 3).filter((item) => item.seconds - tag.seconds <= 45);
    if (nearby.length >= 2) {
      derived.push({
        id: `tag-escalation-cluster-${tag.id}`,
        label: "רצף אפשרי של הסלמה",
        family: "conversation-structure",
        source: "derived",
        seconds: tag.seconds,
        endSeconds: nearby[nearby.length - 1].endSeconds ?? nearby[nearby.length - 1].seconds,
        speaker: tag.speaker,
        target: tag.target,
        evidence: `${nearby.length} רמזים לניסוח מכאיב הופיעו בתוך 45 שניות.`,
        suggestion: "עצרו את פתרון הבעיה. נסו תיקון או הפסקה מתוזמנת לפני שממשיכים.",
        confidence: 0.72,
        metadata: { count: nearby.length }
      });
    }
  });

  const repairTags = tags.filter((tag) => tag.family === "repair").sort((a, b) => a.seconds - b.seconds);
  horsemenTags.forEach((riskTag) => {
    const repair = repairTags.find((tag) => tag.seconds > riskTag.seconds && tag.seconds - riskTag.seconds <= 60);
    if (repair) {
      derived.push({
        id: `tag-risk-repaired-${riskTag.id}-${repair.id}`,
        label: "רגע מכאיב שאחריו הגיע תיקון",
        family: "repair",
        source: "derived",
        seconds: riskTag.seconds,
        endSeconds: repair.endSeconds ?? repair.seconds,
        speaker: repair.speaker,
        target: repair.target,
        segmentId: repair.segmentId,
        evidence: `${riskTag.label} ואחריו ${repair.label}.`,
        suggestion: "זהו סימן לחוסן. האטו ותנו לתיקון לשנות את כיוון השיחה.",
        confidence: 0.7
      });
    }
  });

  return derived;
}

function floodingRisk(signals: BodySignals, cues: LiveCue[]) {
  const stressAverage = (signals.A.stress + signals.B.stress) / 2;
  const relaxationAverage = (signals.A.relaxed + signals.B.relaxed) / 2;
  const heartRateRisk =
    (signals.A.heartRate && signals.A.heartRate > 100 ? 1 : 0) +
    (signals.B.heartRate && signals.B.heartRate > 100 ? 1 : 0);
  const overwhelmCues = cues.filter((cue) => cue.tone === "overwhelm" || cue.tone === "pause").length;

  return clamp(
    Math.round(stressAverage * 7 + heartRateRisk * 15 + (overwhelmCues > 0 ? 55 + (overwhelmCues - 1) * 8 : 0) - relaxationAverage * 2),
    0,
    100
  );
}

function countVisual(observations: VisualObservation[], labels: Set<VisualObservation["label"]>) {
  return new Set(
    observations
      .filter((observation) => labels.has(observation.label))
      .map((observation) => `${observation.seconds}:${observation.subject ?? "couple"}`)
  ).size;
}

function scoreEmotionalState(
  hits: PatternHit[],
  cues: LiveCue[],
  tags: InteractionTag[],
  flooding: number
): EmotionalStateScores {
  const repairSignals = hits.filter((hit) => hit.family === "repair").length;
  const riskSignals = hits.filter((hit) => hit.family === "risk").length;
  const validationSignals = tags.filter((tag) => tag.label === "תיקוף והקשבה").length;
  const bankDeposits = tags.filter((tag) => tag.label === "הפקדה בחשבון הרגשי").length;
  const curiositySignals = tags.filter((tag) => tag.label === "סקרנות").length;
  const turningToward = tags.filter((tag) => tag.label === "היענות לפנייה לקרבה").length;
  const softStartups = tags.filter((tag) => tag.label === "פתיחה רכה").length;
  const horsemenSignals = tags.filter((tag) => tag.family === "four-horsemen").length;
  const stonewallingSignals = tags.filter((tag) => tag.metadata?.horseman === "stonewalling").length;
  const positiveCues = cues.filter((cue) => cue.tone === "warmth" || cue.tone === "repair" || cue.tone === "humor" || cue.tone === "softening").length;
  const overwhelmCues = cues.filter((cue) => cue.tone === "overwhelm" || cue.tone === "pause").length;
  const warmth = clamp(18 + bankDeposits * 12 + validationSignals * 8 + positiveCues * 7 + repairSignals * 4 - riskSignals * 6, 0, 100);
  const engagement = clamp(22 + curiositySignals * 10 + turningToward * 10 + softStartups * 5, 0, 100);
  const tension = clamp(10 + riskSignals * 12 + horsemenSignals * 10 + overwhelmCues * 8 - repairSignals * 5, 0, 100);
  const withdrawal = clamp(8 + stonewallingSignals * 16 + overwhelmCues * 5 - turningToward * 5, 0, 100);
  const repairReadiness = clamp(18 + repairSignals * 14 + validationSignals * 8 + softStartups * 7 + positiveCues * 5 - horsemenSignals * 6 - Math.round(flooding / 5), 0, 100);

  return {
    warmth: Math.round(warmth),
    engagement: Math.round(engagement),
    tension: Math.round(tension),
    flooding,
    withdrawal: Math.round(withdrawal),
    repairReadiness: Math.round(repairReadiness)
  };
}

function buildMetrics(
  segments: TranscriptSegment[],
  hits: PatternHit[],
  signals: BodySignals,
  cues: LiveCue[],
  observations: VisualObservation[],
  vocalObservations: VocalObservation[],
  tags: InteractionTag[]
): SessionMetrics {
  const attributedSegments = segments.filter((segment) => segment.speakerAttribution !== "unknown");
  const totalSpeechWords = segments.reduce((sum, segment) => sum + countWords(segment.text), 0);
  const attributedSpeechWords = attributedSegments.reduce((sum, segment) => sum + countWords(segment.text), 0);
  // Turn-taking claims require most of the spoken words to have a known
  // speaker. A few short unattributed fragments no longer hide the balance,
  // but balance is still computed from attributed words only.
  const speakerAttributionReliable =
    segments.length > 0 && totalSpeechWords > 0 && attributedSpeechWords / totalSpeechWords >= 0.8;
  const wordsA = attributedSegments.filter((segment) => segment.speaker === "A").reduce((sum, segment) => sum + countWords(segment.text), 0);
  const wordsB = attributedSegments.filter((segment) => segment.speaker === "B").reduce((sum, segment) => sum + countWords(segment.text), 0);
  const maxWords = Math.max(wordsA, wordsB, 1);
  const minWords = Math.min(wordsA, wordsB);
  const turnBalance = Math.round((minWords / maxWords) * 100);
  const positiveSignals = hits.filter(
    (hit) => hit.family === "strength" && hit.source !== "visual" && hit.source !== "vocal"
  ).length;
  const riskSignals = hits.filter((hit) => hit.family === "risk").length;
  const repairSignals = hits.filter((hit) => hit.family === "repair").length;
  const fourHorsemenSignals = tags.filter((tag) => tag.family === "four-horsemen").length;
  const contemptSignals = tags.filter((tag) => tag.metadata?.horseman === "contempt").length;
  const softStartups = tags.filter((tag) => tag.label === "פתיחה רכה").length;
  const validationSignals = tags.filter((tag) => tag.label === "תיקוף והקשבה").length;
  const emotionalBankDeposits = tags.filter((tag) => tag.label === "הפקדה בחשבון הרגשי").length;
  const bidsOrTurningToward = tags.filter((tag) => tag.label === "היענות לפנייה לקרבה").length;
  const interruptionRisks = tags.filter((tag) => tag.label === "חפיפה או קטיעה אפשרית").length;
  const nonverbalStressSignals =
    observations.filter((observation) => visualStressLabels.has(observation.label)).length +
    vocalObservations.filter((observation) => vocalStressLabels.has(observation.label)).length;
  const risk = floodingRisk(signals, cues);
  const emotionalState = scoreEmotionalState(hits, cues, tags, risk);
  const balanceBonus = speakerAttributionReliable ? (turnBalance > 60 ? 8 : turnBalance > 40 ? 3 : -7) : 0;
  const repairBonus = repairSignals * 4 + softStartups * 2 + validationSignals * 2 + emotionalBankDeposits * 2 + bidsOrTurningToward;
  const riskPenalty = riskSignals * 8 + fourHorsemenSignals * 4 + interruptionRisks * 2 + Math.round(risk / 8);
  const score = clamp(64 + positiveSignals * 4 + repairBonus - riskPenalty + balanceBonus, 0, 100);

  return {
    wordsA,
    wordsB,
    turnBalance,
    speakerAttributionReliable,
    positiveSignals,
    riskSignals,
    repairSignals,
    floodingRisk: risk,
    connectionPracticeScore: score,
    emotionalState,
    fourHorsemenSignals,
    contemptSignals,
    softStartups,
    validationSignals,
    emotionalBankDeposits,
    bidsOrTurningToward,
    interruptionRisks,
    nonverbalStressSignals
  };
}

function selectStrengths(metrics: SessionMetrics, tags: InteractionTag[]) {
  const strengths = new Set<string>();
  if (metrics.speakerAttributionReliable !== false && metrics.turnBalance >= 65) strengths.add("לשני בני הזוג היה מרחב דיבור משמעותי.");
  if (metrics.repairSignals > 0) strengths.add("הופיעו בשיחה ניסיונות תיקון.");
  if (metrics.validationSignals > 0) strengths.add("היו רגעים של הקשבה ותיקוף.");
  if (metrics.emotionalBankDeposits > 0) strengths.add("הופיעו ביטויי הערכה או חיבה שמחזקים את הקשר.");
  if (metrics.bidsOrTurningToward > 0) strengths.add("נראו פניות לקרבה ורגעים של היענות.");
  if (tags.some((tag) => tag.family === "desire")) strengths.add("הופיע לפחות רמז אחד לחיות, רצון, משחקיות או נפרדות.");
  if (strengths.size === 0) strengths.add("יש בשיחה מספיק חומר כדי לבחור תרגול מעשי אחד.");
  return Array.from(strengths).slice(0, 4);
}

function selectRisks(metrics: SessionMetrics, hits: PatternHit[], sessionType: SessionType) {
  const risks = new Set<string>();
  const stressReducing = sessionType === "stress-reducing";
  // In a stress-reducing conversation the topic is meant to be stress from
  // *outside* the relationship. The same partner-directed patterns the engine
  // already tags are reframed here not as a "risk" but as the conversation
  // drifting to an internal grievance — which belongs in Aftermath or Conflict.
  if (stressReducing && (metrics.fourHorsemenSignals > 0 || metrics.contemptSignals > 0)) {
    risks.add(
      "חלק מהניסוח נשמע מכוון פנימה, זה אל זו. בשיחה מפחיתת-לחץ מתמקדים בלחץ שמגיע מבחוץ; נושא שבינֵיכם מתאים יותר ל'אחרי ריב' או ל'מחלוקת'."
    );
  } else {
    if (metrics.riskSignals > 0) risks.add("ייתכן שחלק מהניסוח נחווה כהאשמה, ביטול, זלזול או התגוננות.");
    if (metrics.fourHorsemenSignals > 0) risks.add("הופיעו דפוסים מכאיבים שכדאי לרכך בעזרת התגובה המתקנת המתאימה.");
    if (metrics.contemptSignals > 0) risks.add("ניסוח שעשוי להישמע מזלזל מצריך האטה וחזרה לכבוד הדדי.");
  }
  if (metrics.interruptionRisks > 0) {
    risks.add(
      stressReducing
        ? "היו רגעים של קטיעה; בתור של המקשיב/ה מספיק להקשיב ולשקף, בלי למהר לפתור."
        : "ייתכן שכדאי להבהיר טוב יותר את המעבר בין הדוברים."
    );
  }
  if (metrics.speakerAttributionReliable !== false && metrics.turnBalance < 45) risks.add("זמן הדיבור לא היה מאוזן; כדאי לבדוק אם שניכם הרגשתם שנשמעתם.");
  if (metrics.floodingRisk > 58) risks.add("רמזי העומס מצדיקים בדיקה משותפת אם נחוצה הפסקה מתוזמנת.");
  // "No repair attempt" is only a gap where repair is the point. A stress-
  // reducing conversation is about support, not repair, so it is not flagged.
  if (metrics.repairSignals === 0 && !stressReducing) risks.add("לא זוהה ניסיון תיקון; בפעם הבאה אפשר להוסיף אחד מוקדם.");
  if (hits.some((hit) => hit.label === "חשש להיסגרות או ניתוק")) risks.add("ניסוח שעלול להעיד על סגירות מציע לעצור את פתרון הבעיה ולבדוק מה נחוץ.");
  if (risks.size === 0) risks.add("הכללים הנוכחיים לא סימנו דפוס סיכון מרכזי.");
  return Array.from(risks).slice(0, 4);
}

function nextSteps(metrics: SessionMetrics, sessionType: SessionType) {
  const steps: string[] = [];
  if (metrics.floodingRisk > 58) {
    steps.push("קחו הפסקה של 20 דקות לפני שתחזרו לאותו נושא.");
  }
  if (metrics.contemptSignals > 0) {
    steps.push("לפני פתרון הבעיה, כל אחד יאמר דבר מסוים שהוא מכבד או מעריך בשני.");
  }
  if (metrics.fourHorsemenSignals > 0) {
    steps.push("עברו על כל ניסוח מכאיב ונסחו אותו מחדש בצורה רכה ומכבדת.");
  }
  if (metrics.interruptionRisks > 0) {
    steps.push("דברו בשני משפטים בכל תור, ואז המקשיב ישקף דבר אחד ששמע.");
  }
  if (metrics.riskSignals > metrics.positiveSignals) {
    steps.push("התחילו את הנושא מחדש, כשכל אחד מנסח פתיחה עדינה אחת.");
  }
  if (metrics.repairSignals === 0 && sessionType !== "stress-reducing") {
    steps.push("הסכימו על משפט תיקון אחד ששניכם תזהו.");
  }
  if (sessionType === "intimacy") {
    steps.push("סיימו בבקשה אחת לרוך ובקשה אחת למשחקיות.");
  }
  if (sessionType === "shared-meaning") {
    steps.push("הפכו ערך משותף אחד לטקס שבועי קטן.");
  }
  if (sessionType === "aftermath") {
    steps.push("הפכו את הצעד מהשלב החמישי למשפט תיקון קצר שתזהו בפעם הבאה.");
  }
  if (sessionType === "stress-reducing") {
    steps.push("המקשיב/ה: לפני כל עצה, שקפו משפט אחד ששמעתם — 'מה ששמעתי הוא…'.");
  }
  steps.push("עברו יחד על רגע מסומן אחד ותקנו אותו אם האפליקציה לא הבינה נכון.");
  return steps.slice(0, 5);
}

function suggestedScript(metrics: SessionMetrics) {
  if (metrics.floodingRisk > 58) {
    return "הקשר שלנו חשוב לי ואני מרגיש/ה מוצף/ת. אני רוצה לעצור עכשיו ולחזור בשעה שנקבע יחד.";
  }
  if (metrics.contemptSignals > 0) {
    return "אני רוצה לחזור לכבוד בינינו. דבר אחד שאני מעריך/ה בך הוא ___. הכאב שמתחת לתגובה שלי הוא ___.";
  }
  if (metrics.fourHorsemenSignals > 0) {
    return "אני רוצה לנסות לומר את זה שוב בצורה רכה יותר. אני מרגיש/ה ___ לגבי ___, ומה שאני צריך/ה הוא ___.";
  }
  if (metrics.repairSignals > 0) {
    return "תודה שניסית לתקן. אני יכול/ה לקבל את זה, ועדיין חשוב לי שנבין יחד ___.";
  }
  return "דבר אחד ששמעתי אותך אומר/ת הוא ___. דבר אחד שאני מעריך/ה הוא ___. צעד קטן אחד שאוכל לעשות הוא ___.";
}

export function analyzeSession(
  segments: TranscriptSegment[],
  signals: BodySignals,
  cues: LiveCue[],
  sessionType: SessionType,
  observations: VisualObservation[] = [],
  vocalObservations: VocalObservation[] = []
): SessionAnalysis {
  const evidence = sessionEvidenceSummary({ segments, cues, observations });
  if (!evidence.sufficient) {
    const emptyMetrics: SessionMetrics = {
      wordsA: 0,
      wordsB: 0,
      turnBalance: 0,
      speakerAttributionReliable: false,
      positiveSignals: 0,
      riskSignals: 0,
      repairSignals: 0,
      floodingRisk: 0,
      connectionPracticeScore: 0,
      emotionalState: {
        warmth: 0,
        engagement: 0,
        tension: 0,
        flooding: 0,
        withdrawal: 0,
        repairReadiness: 0
      },
      fourHorsemenSignals: 0,
      contemptSignals: 0,
      softStartups: 0,
      validationSignals: 0,
      emotionalBankDeposits: 0,
      bidsOrTurningToward: 0,
      interruptionRisks: 0,
      nonverbalStressSignals: 0
    };
    return {
      summary: "עדיין אין מספיק מידע לסיכום. אפשר להמשיך לדבר, לעבור על התמלול או להוסיף הערה ידנית.",
      metrics: emptyMetrics,
      strengths: [],
      risks: [],
      nextSteps: ["השלימו לפחות כמה משפטים לפני יצירת סיכום לתרגול."],
      suggestedScript: "אפשר להתחיל במשפט: משהו שחשוב לי שתבין/י עכשיו הוא…",
      hits: [],
      tags: [],
      dataQuality: {
        status: "insufficient",
        reasons: evidence.reasons,
        evidenceCount: evidence.evidenceCount
      }
    };
  }
  const scanned = scanSegments(segments);
  const repairAcceptance = detectRepairAcceptance(segments, scanned.tags);
  const baseTags = [
    ...scanned.tags,
    ...cueTags(cues),
    ...visualTags(observations, segments),
    ...vocalTags(vocalObservations, segments),
    ...repairAcceptance.tags
  ];
  const timelineTags = [...baseTags, ...deriveConversationTags(segments, baseTags)].sort((a, b) => a.seconds - b.seconds);
  const allHits = [
    ...scanned.hits,
    ...cueHits(cues),
    ...visualHits(observations, segments),
    ...vocalHits(vocalObservations, segments),
    ...repairAcceptance.hits
  ].sort((a, b) => (a.seconds ?? 0) - (b.seconds ?? 0));
  const metrics = buildMetrics(segments, allHits, signals, cues, observations, vocalObservations, timelineTags);
  const allTags = timelineTags;

  const summary =
    segments.length === 0
      ? "לא נקלט תמלול. אפשר להוסיף הערה ידנית או להשתמש בתמלול הדפדפן כדי ליצור התבוננות עשירה יותר."
      : `בשיחה הזו זוהו ${metrics.positiveSignals} רגעים חיוביים ו־${metrics.repairSignals} ניסיונות תיקון. נמצאו גם ${metrics.fourHorsemenSignals} רגעים שכדאי להתבונן בהם ו־${allTags.length} נקודות מסומנות. זהו סיכום לתרגול, לא קביעה לגבי הקשר או הרגשות.`;

  return {
    summary,
    metrics,
    strengths: selectStrengths(metrics, allTags),
    risks: selectRisks(metrics, allHits, sessionType),
    nextSteps: nextSteps(metrics, sessionType),
    suggestedScript: suggestedScript(metrics),
    hits: allHits.slice(0, 28),
    tags: allTags,
    dataQuality: {
      status: "sufficient",
      reasons: [],
      evidenceCount: evidence.evidenceCount
    }
  };
}
