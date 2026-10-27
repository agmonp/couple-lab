/**
 * A one-off calendar reminder (.ics) for the small step a couple chose at the
 * end of a conversation. Built locally and saved by the user; nothing is sent.
 */

export interface ReminderOptions {
  step: string;
  /** Days from `now` until the reminder. */
  daysAhead?: number;
  hour?: number;
  minute?: number;
  durationMinutes?: number;
  now?: Date;
}

function icsTime(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
export function escapeIcsText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function reminderStart({ daysAhead = 7, hour = 21, minute = 0, now = new Date() }: Omit<ReminderOptions, "step"> & { step?: string }) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, hour, minute, 0);
}

export function buildReminderIcs(options: ReminderOptions) {
  const now = options.now ?? new Date();
  const start = reminderStart({ ...options, now });
  const end = new Date(start.getTime() + (options.durationMinutes ?? 20) * 60 * 1000);
  const step = escapeIcsText(options.step.trim());
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Couple Lab//Weekly Step//HE",
    "BEGIN:VEVENT",
    `UID:${now.getTime()}-step@couple-lab`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    "SUMMARY:Couple Lab — רגע לשיחה ולצעד שבחרנו",
    `DESCRIPTION:הצעד שבחרנו: ${step}\\nפותחים את Couple Lab\\, בודקים איך הלך ובוחרים שאלה לערב.`,
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:עוד רבע שעה: שיחה זוגית קצרה",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}
