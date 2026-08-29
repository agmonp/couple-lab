/**
 * Prompt and parser for the opt-in cloud reflection over a corrected transcript.
 *
 * The model is asked for a short Gottman-informed reflection — strengths, risks,
 * and next steps for practice — in Hebrew, and explicitly instructed to stay
 * descriptive: never a verdict on emotion, intent, blame, or the future of the
 * relationship. This mirrors the boundary the local engine already respects.
 *
 * The parser is strict and pure (unit-tested): a malformed or oversized response
 * is rejected rather than shown, so a bad cloud reply can never masquerade as an
 * analysis.
 */

export interface CloudReflectionInput {
  /** Corrected, speaker-attributed transcript lines, already assembled. */
  transcript: string;
  partnerAName: string;
  partnerBName: string;
}

export interface ParsedCloudReflection {
  summary: string;
  strengths: string[];
  risks: string[];
  nextSteps: string[];
}

export class CloudReflectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudReflectionError";
  }
}

export const CLOUD_REFLECTION_SYSTEM =
  "אתה עוזר עדין לזוגות, מיודע בגישת גוטמן ובאסתר פרל. אתה כותב בעברית בלבד. " +
  "אתה מתאר דפוסי שיחה כתצפיות לתרגול, לעולם לא כאבחון ולא כקביעה על רגש, כוונה, אשמה או עתיד הקשר. " +
  "אתה לא ממציא דברים שלא נאמרו, ולא שם מילים בפי המשתתפים. " +
  "כשאין מספיק מידע, אתה אומר זאת בעדינות. אתה עונה אך ורק ב-JSON תקין לפי הסכימה שתתבקש.";

export function buildCloudReflectionPrompt(input: CloudReflectionInput): string {
  return [
    "להלן תמלול של שיחת תרגול בין שני בני זוג.",
    `הדוברים: "${input.partnerAName}" ו-"${input.partnerBName}".`,
    "",
    "כתוב רפלקציה קצרה ומיודעת-גוטמן בעברית, והחזר JSON יחיד בלבד בצורה הזאת (בלי טקסט לפני או אחרי):",
    '{',
    '  "summary": "משפט או שניים שמסכמים את השיחה כתרגול, לא כאבחון",',
    '  "strengths": ["עד 3 חוזקות שנשמעו, מנוסחות כתצפית"],',
    '  "risks": ["עד 3 דפוסים שכדאי לשים לב אליהם, בעדינות ולא כהאשמה"],',
    '  "nextSteps": ["עד 3 צעדים מעשיים וקטנים להמשך"]',
    '}',
    "",
    "כללים: אל תקבע מה מישהו הרגיש או התכוון. אל תשתמש בתוויות מאשימות. אל תמציא ציטוטים.",
    "אם אין מספיק דיבור לניתוח, החזר summary שמסביר זאת ומערכים ריקים.",
    "",
    "התמלול:",
    input.transcript
  ].join("\n");
}

function asStringArray(value: unknown, limit = 3): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/** Pull the first balanced JSON object out of a possibly chatty response. */
function extractJsonObject(response: string): string {
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new CloudReflectionError("no-json");
  }
  return response.slice(start, end + 1);
}

export function parseCloudReflection(response: string): ParsedCloudReflection {
  if (typeof response !== "string" || !response.trim()) {
    throw new CloudReflectionError("empty");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(response));
  } catch (error) {
    if (error instanceof CloudReflectionError) throw error;
    throw new CloudReflectionError("invalid-json");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CloudReflectionError("invalid-shape");
  }
  const record = parsed as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!summary) throw new CloudReflectionError("missing-summary");
  // Guard against a runaway response being shown verbatim.
  if (summary.length > 2000) throw new CloudReflectionError("summary-too-long");

  return {
    summary,
    strengths: asStringArray(record.strengths),
    risks: asStringArray(record.risks),
    nextSteps: asStringArray(record.nextSteps)
  };
}
