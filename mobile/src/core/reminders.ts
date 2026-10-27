import { resolveForms } from "@shared/deckForms";
import { reminderStart } from "@shared/calendarReminder";
import { type AppState, dayKey } from "./model";

/**
 * Notification wording. At most one a day, at the time the couple chose, in
 * the voice of a friend: never a streak, never "you missed", never urgency.
 */
export const DAILY_ID = 1;
export const WEEKLY_ID = 2;

export function dailyNotificationText(state: AppState, today = dayKey()): { title: string; body: string } {
  const couple = state.couple;
  const d = state.days[today];
  if (couple && d) {
    const answered = (["A", "B"] as const).filter((p) => d.locked[p] !== undefined && d.revealed[p] === undefined);
    if (answered.length === 1) {
      const who = couple[answered[0]];
      const waiting = couple[answered[0] === "A" ? "B" : "A"];
      return {
        title: "שאלת היום",
        body: resolveForms("{w} {w:ענה|ענתה}. {o}, {w:הוא מחכה|היא מחכה} לשמוע אותך.", { w: who, o: waiting })
      };
    }
    if (answered.length === 2) return { title: "שאלת היום", body: "שניכם עניתם. אפשר לחשוף יחד כשנוח לכם." };
  }
  return { title: "שאלה קטנה לערב", body: "יש שאלה אחת שמחכה לכם, אם מתאים הערב." };
}

/** The small step chosen at the end of a date, a week later at 21:00 (shared calendarReminder). */
export function weeklyStepTime(now = new Date()) {
  return reminderStart({ daysAhead: 7, hour: 21, minute: 0, now });
}

export function weeklyStepText(step: string) {
  return { title: "הצעד שבחרתם השבוע", body: `${step.trim()}. איך הלך? אפשר לדבר על זה הערב.` };
}

/** Words that would turn a reminder into pressure. Checked by tests on every text above. */
export const PRESSURE_WORDS = ["רצף", "פספס", "אל תשכחו", "אחרון", "דחוף", "!", "חובה", "נשבר"];
