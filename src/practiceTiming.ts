/**
 * The timing rules behind the practice aids, with no React and no DOM so the
 * desktop components and the phone app share one source of truth.
 *
 * - A speaking turn is two minutes; the listener then reflects and they swap.
 * - An agreed break lasts at least 20 minutes, so the body has time to settle
 *   before the couple comes back (flooding research; GOTTMAN_INFORMED_QA.md).
 */

export const LISTENING_TURN_SECONDS = 120;
export const BREAK_MINUTES = 20;
export const BREAK_SECONDS = BREAK_MINUTES * 60;

/** "mm:ss" for a countdown; negative input reads as zero. */
export function clock(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** Whole seconds left until `endsAt` (epoch ms), never below zero. */
export function secondsUntil(endsAt: number, now = Date.now()) {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** When an agreed break that starts at `now` is over. */
export function breakReturnAt(now = Date.now()) {
  return now + BREAK_SECONDS * 1000;
}

/** What helps during the break. Plain, impersonal wording that fits anyone. */
export const CALMING_STEPS = [
  "כל אחד הולך למקום אחר בבית.",
  "נושמים לאט: שאיפה של 4, נשיפה של 6.",
  "שותים מים, זזים קצת, מוזיקה שקטה.",
  "לא מנסחים בראש תשובות לוויכוח. נותנים לגוף להירגע."
];
