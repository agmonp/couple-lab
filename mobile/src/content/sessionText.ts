import { AFTERMATH_STEPS, LISTENER_RULES, STRESS_REDUCING_STEPS } from "@shared/structuredSessions";

/**
 * The two structured sessions in the phone's voice: the same steps, order and
 * intent as src/structuredSessions.ts (which stays the source of truth for the
 * flow and the safety gate), worded for named partners instead of "/ה" forms.
 *
 * Roles: {a}/{b} both partners, {s} who speaks now, {l} who listens now,
 * {you} one partner in a per-person line.
 */
export interface StepText {
  key: string;
  intent: string;
  /** Read to both. */
  together?: string;
  /** Rendered once for each partner, as their own line. */
  perPerson?: string;
  /** Rendered for whoever speaks now; the screen swaps speaker and listener. */
  turn?: string;
}

export const AFTERMATH_TEXT: StepText[] = [
  {
    key: "feelings",
    intent: "כל אחד שם מילים על מה שהרגיש באירוע.",
    together: "כל אחד בוחר מהרשימה מילים שמתאימות למה שהרגיש, ואומר בקול: 'הרגשתי ___'. רק שמות של רגשות. עדיין בלי 'כי', ובלי לתאר מה {a} או {b} עשו."
  },
  {
    key: "realities",
    intent: "כל אחד מתאר איך זה נראה מבפנים. אין כאן הכרעה מי צודק: שתי המציאויות אמיתיות למי שחווה אותן.",
    turn: "{s} {s:מספר|מספרת}: מה ראיתי, מה שמעתי, איך חוויתי. {l} {l:משקף|משקפת} לפני שמציגים עמדה: '{l:אני מבין|אני מבינה} איך זה נראה מנקודת המבט שלך, וחלק מזה הגיוני לי.'"
  },
  {
    key: "triggers",
    intent: "מה הרגע שהסלים, ומה הסיפור שמאחוריו. כדי להבין, לא כדי להצדיק.",
    turn: "{s}: 'הרגע שהצית אותי היה ___. זה מזכיר לי ___. {s:אני רגיש|אני רגישה} לזה כי ___.' {l} {l:מקשיב|מקשיבה} עד הסוף."
  },
  {
    key: "ownership",
    intent: "כל אחד לוקח אחריות על החלק שלו, לא על החלק של השני.",
    perPerson: "'החלק שלי בזה היה ___. מה שהכין אותי להיות {you:פגיע או חד|פגיעה או חדה} יותר היה ___ (עייפות, לחץ, משהו קודם). {you:אני מצטער|אני מצטערת} על ___.'"
  },
  {
    key: "plan",
    intent: "דבר מעשי אחד לפעם הבאה, ומשפט תיקון קטן שתזהו באמצע.",
    perPerson: "'בפעם הבאה אני אנסה ___.'",
    together: "ואז מסכימים יחד על משפט תיקון קצר, למשל 'רגע, מתחילים מחדש' או 'אני איתך'."
  }
];

export const STRESS_TEXT: StepText[] = [
  {
    key: "turn-1",
    intent: "לחץ מבחוץ: עבודה, משפחה, העולם. לא תלונה זה על זה.",
    turn: "{s} {s:מדבר|מדברת} על משהו שמלחיץ מחוץ לקשר. {l} רק {l:תומך|תומכת}, לא {l:פותר|פותרת}."
  },
  {
    key: "turn-2",
    intent: "מתחלפים. אותם כללים, אותה הקשבה.",
    turn: "עכשיו {s} {s:מדבר|מדברת}, ו{l} {l:מקשיב|מקשיבה}. הנושא עדיין מבחוץ."
  }
];

/** Shown to the listener, in the same order as LISTENER_RULES. */
export const LISTENER_RULES_TEXT: string[] = [
  "תורות: עכשיו התור של {s}. {l} {l:מקשיב|מקשיבה}.",
  "לא לפתור: הבנה לפני עצה, ובלי עצה שלא ביקשו.",
  "תשומת לב אמיתית: קשר עין, בלי הסחות, שאלה מתוך עניין.",
  "הזדהות: 'זה הגיוני', 'גם אני {l:הייתי מרגיש|הייתי מרגישה} ככה'.",
  "להיות בצד של {s}: 'אנחנו מול הלחץ', גם אם לא הכל נשמע לך הוגן."
];

/** When the talk drifts to something between them (spec §4.1). */
export const STRESS_DRIFT_NOTE =
  "אם השיחה עוברת לנושא שביניכם, עוצרים בעדינות: לזה מתאימה שיחה אחרת. כאן מדברים על לחץ מבחוץ.";

export const STRESS_TURN_MINUTES = [5, 10, 15];

/** Keeps the phone wording aligned with the shared flow; checked by tests. */
export const SHARED_STEP_KEYS = {
  aftermath: AFTERMATH_STEPS.map((s) => s.key),
  stress: STRESS_REDUCING_STEPS.map((s) => s.key),
  listenerRules: LISTENER_RULES.length
};
