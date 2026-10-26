import { describe, expect, it } from "vitest";
import { buildReminderIcs, escapeIcsText, reminderStart } from "./calendarReminder";

describe("calendar reminder", () => {
  const now = new Date(2026, 9, 26, 22, 30, 0);

  it("schedules a week ahead at 21:00 local time", () => {
    const start = reminderStart({ step: "x", now });
    expect(start.getDate()).toBe(2);
    expect(start.getMonth()).toBe(10);
    expect(start.getHours()).toBe(21);
  });

  it("has the fields calendar apps require", () => {
    const ics = buildReminderIcs({ step: "תה בלי טלפונים", now });
    for (const field of ["BEGIN:VEVENT", "UID:", "DTSTAMP:", "DTSTART:", "DTEND:", "BEGIN:VALARM"]) {
      expect(ics).toContain(field);
    }
    expect(ics).toContain("תה בלי טלפונים");
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
  });

  it("escapes characters that would break the event text", () => {
    expect(escapeIcsText("a, b; c\nd\\e")).toBe("a\\, b\\; c\\nd\\\\e");
  });
});
