/**
 * Addressing each partner the way they chose, instead of "מבין/ה" forms.
 *
 * Two pieces, both pure:
 * - `resolveForms` fills a template whose tokens name a role:
 *   `{you}` is that person's name, `{you:מבין|מבינה}` picks the masculine or
 *   feminine word for them. Roles are whatever the caller passes: "you"/"them"
 *   for a question put to one partner, "s"/"l" for speaker/listener, "a"/"b".
 * - `resolveSlashForms` turns an existing slash text that is about ONE person
 *   ("פגוע/ה", "חסר/ת אונים") into that person's form. Use it only when the whole
 *   text refers to the same person; mixed texts need a template.
 *
 * `deckCardForms` holds the addressed version of every card in the light
 * layers (1–3). Each line keeps the meaning of the card at the same index in
 * `decks` (src/data.ts) but speaks to the person answering, naming the partner.
 */

export type AddressForm = "m" | "f";

export interface AddressedPerson {
  name: string;
  form: AddressForm;
}

export type FormRoles = Record<string, AddressedPerson>;

const TOKEN = /\{([a-z]+)(?::([^{}|]*)\|([^{}|]*))?\}/g;

export function resolveForms(template: string, roles: FormRoles): string {
  return template.replace(TOKEN, (whole, role: string, masculine?: string, feminine?: string) => {
    const person = roles[role];
    if (!person) throw new Error(`resolveForms: no person for role "${role}" in "${template}"`);
    if (masculine === undefined) return person.name;
    return person.form === "f" ? feminine ?? "" : masculine;
  });
}

const FINAL_TO_REGULAR: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const REGULAR_TO_FINAL: Record<string, string> = { "כ": "ך", "מ": "ם", "נ": "ן", "פ": "ף", "צ": "ץ" };

function withLast(word: string, table: Record<string, string>) {
  const last = word.slice(-1);
  return table[last] ? word.slice(0, -1) + table[last] : word;
}

/** Word pairs whose two forms are not a stem plus a suffix. */
const WHOLE_WORD_PAIRS: Record<string, [string, string]> = {
  "את/ה": ["אתה", "את"],
  "הוא/היא": ["הוא", "היא"],
  "שלו/שלה": ["שלו", "שלה"],
  "לו/לה": ["לו", "לה"]
};

const SLASH_WORD = /([א-ת]+)\/([א-ת]+)/g;

export function resolveSlashForms(text: string, form: AddressForm): string {
  return text.replace(SLASH_WORD, (whole: string, stem: string, tail: string) => {
    const pair = WHOLE_WORD_PAIRS[whole];
    if (pair) return form === "m" ? pair[0] : pair[1];
    if (tail.length <= 2) {
      // A suffix: "מבין/ה" → מבין / מבינה, "שקפ/י" → שקף / שקפי.
      return form === "m" ? withLast(stem, REGULAR_TO_FINAL) : withLast(stem, FINAL_TO_REGULAR) + tail;
    }
    return form === "m" ? stem : tail;
  });
}

/** True when a text still holds a "word/ending" form that a reader would see. */
export function hasSlashForm(text: string): boolean {
  return /[א-ת]\/[א-ת]/.test(text);
}

export const deckCardForms: Record<string, string[]> = {
  "love-maps": [
    "איזה לחץ בחיים שלך {them} עדיין לא {them:מבין|מבינה} עד הסוף?",
    "איזה דבר קטן ש{them} {them:עשה|עשתה} השבוע עזר לך להרגיש שאכפת {them:לו|לה} ממך?",
    "איזה חלום שקט נמצא אצלך לאחרונה?",
    "מה היית רוצה ש{them} {them:יידע|תדע} על היום שלך, לפני {them:שהוא ינסה|שהיא תנסה} לפתור משהו?",
    "איזו דאגה שלך מרגישה קלה יותר כש{them} פשוט {them:יודע|יודעת} עליה?"
  ],
  "open-ended": [
    "על מה היית רוצה ש{them} {them:ישאל|תשאל} אותך יותר?",
    "איזה נושא מעסיק אותך לאחרונה שעדיין לא סיפרת עליו ל{them}?",
    "אם היה לכם ערב פנוי רק לשיחה, על מה היית רוצה לדבר?",
    "מה השתנה אצלך בחודש האחרון ש{them} {them:היה רוצה|הייתה רוצה} לדעת?",
    "איזו שאלה היית רוצה ש{them} {them:ישאל|תשאל} אותך דווקא עכשיו?"
  ],
  "fondness": [
    "איזו תכונה של {them} עדיין חשובה לך במיוחד?",
    "באיזה זיכרון הרגשת גאווה להיות עם {them}?",
    "מה {them} {them:עשה|עשתה} לאחרונה שהקל על החיים שלך?",
    "איזה מאמץ של {them} חשוב לך {them:שהוא יידע|שהיא תדע} שראית?",
    "מהו דבר אחד בקשר שלכם שלא היית רוצה שתאבדו?"
  ],
  "appreciation": [
    "על איזה דבר מסוים ש{them} {them:עשה|עשתה} היום מגיעה תודה בקול?",
    "מה {them} {them:עשה|עשתה} לאחרונה שהקל {you:עליך|עלייך}, ועוד לא עצרת להגיד תודה?",
    "איזו איכות של {them} היית רוצה לתאר {them:לו|לה} במילים מדויקות?",
    "על איזה מאמץ קטן ולא מובן מאליו של {them} היית רוצה {them:שיידע|שתדע} שראית?",
    "מתי השבוע הרגשת גאווה ב{them} ועוד לא סיפרת {them:לו|לה}?"
  ],
  "turn-toward": [
    "איזו פנייה קטנה של {them} {you:אליך|אלייך} קל לך לפספס כש{you:אתה שקוע|את שקועה} במשהו?",
    "מה עוזר לך לעצור ולהיות {you:נוכח|נוכחת} כש{them} פונה {you:אליך|אלייך}?",
    "מתי השבוע פנית ל{them} והרגשת {them:שהוא קיבל|שהיא קיבלה} את זה בחום?",
    "איזה סימן קטן אצלך אומר ל{them} '{you:אני צריך|אני צריכה} אותך עכשיו'?",
    "איך היית רוצה ש{them} {them:יגיב|תגיב} כש{you:אתה משתף|את משתפת} משהו קטן מהיום שלך?"
  ],
  "rituals": [
    "איזה רגע קבוע ביום היית רוצה שיהיה רק שלך ושל {them}?",
    "איך היית רוצה שתיפרדו בבוקר ותיפגשו שוב בערב?",
    "איזה טקס קטן מהעבר שלכם חסר לך, והיית רוצה להחזיר?",
    "מה יגרום לסוף השבוע להרגיש שלכם באמת?",
    "איזו מסורת קטנה היית רוצה שתלווה אתכם השנה?"
  ],
  "date-opportunity": [
    "לאן היית רוצה לברוח עם {them} ליום אחד, בלי שום לוגיסטיקה?",
    "איזו חוויה חדשה היית רוצה לנסות עם {them} השנה?",
    "מה היה הופך ערב רגיל שלכם לערב שתזכרו?",
    "איזה חלום קטן תוכלו להגשים יחד בקרוב?",
    "מה משך אותך אל {them} בהתחלה, ושהיית רוצה לחזור אליו?"
  ]
};

/**
 * One card put to `you` about `them`. Falls back to the deck text resolved for
 * the answering person when no addressed version exists yet.
 */
export function addressedCard(
  deckId: string,
  index: number,
  fallbackCard: string,
  you: AddressedPerson,
  them: AddressedPerson
): string {
  const template = deckCardForms[deckId]?.[index];
  if (template) return resolveForms(template, { you, them });
  return resolveSlashForms(fallbackCard, you.form);
}
