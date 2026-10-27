/**
 * Short original lines the phone needs around the cards. Templates use the
 * roles of src/deckForms.ts: {a}/{b} for the two partners, {you}/{them} for a
 * line put to one of them.
 */

/** One follow-up after a reveal, to turn two answers into a conversation. */
export const REVEAL_FOLLOW_UPS: string[] = [
  "{a}, {a:שאל|שאלי} את {b}: '{b:ספר|ספרי} לי עוד על זה. מה עוד יש שם?'",
  "{b}, מה בתשובה של {a} לא ידעת עד עכשיו? {b:ספר|ספרי} ל{a}.",
  "כל אחד אומר משפט אחד שמתחיל ב'כששמעתי את התשובה שלך, הרגשתי…'.",
  "{a}, {a:בחר|בחרי} מילה אחת מהתשובה של {b} ו{a:שאל|שאלי} עליה שאלה."
];

/** The two private questions at the end of a date. */
export const END_QUESTIONS = {
  good: "מה היה לך טוב הערב?",
  learned: "מה למדת הערב על {them} שלא ידעת קודם?"
};

/** For the 20-minute break: things that are not the argument. */
export const DISTRACTIONS: string[] = [
  "לשטוף פנים במים קרים",
  "לצאת לכמה דקות למרפסת או לחצר",
  "לשים שיר אחד שאוהבים ולהקשיב לו עד הסוף",
  "לסדר משהו קטן: מגירה, מדף, הכיורים",
  "לקרוא כמה עמודים ממשהו שלא קשור",
  "למתוח את הגוף לאט, דקה או שתיים"
];

export const BREAK_RETURN_LINE = "כשחוזרים, מתחילים במשפט אחד של אכפתיות, למשל: 'אני רוצה שנבין זה את זו.'";

export const WELCOME_BACK = "התגעגענו. הנה שאלה קלה להתחלה.";

/** Help lines in Israel. Shown on the safety screen and whenever the gate stops a session. */
export const HELP_LINES = [
  { number: "118", title: "קו החירום של משרד הרווחה", detail: "אלימות במשפחה, פחד בבית. 24 שעות ביממה." },
  { number: "1201", title: 'ער"ן: עזרה ראשונה נפשית', detail: "כשקשה, כשבודד, כשמוצפים. 24 שעות ביממה." },
  { number: "100", title: "משטרה", detail: "בסכנה מיידית." }
];

export const NOT_THERAPY =
  "Couple Lab היא כלי תרגול לזוגות. היא לא טיפול, לא אבחון ולא מחליפה ייעוץ זוגי או עזרה מקצועית.";
