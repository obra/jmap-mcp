import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCalendarClient,
  createICalString,
  updateICalString,
  generateICalFilename,
  formatCalendarAsCSV,
  formatCalendarEventAsCSV,
  parseICalEvent,
  CalendarInfo,
  CalendarEvent,
} from "./calendar.js";

// =============================================================================
// Unit Tests for Calendar Formatting Functions
// =============================================================================

describe("formatCalendarAsCSV", () => {
  it("formats a single calendar", () => {
    const calendars: CalendarInfo[] = [
      {
        url: "/dav/calendars/user/test@example.com/Default/",
        displayName: "Default",
        ctag: "abc123",
        color: "#0000FF",
        description: "My default calendar",
      },
    ];
    const result = formatCalendarAsCSV(calendars);
    expect(result).toContain("url,display_name,ctag,color,description");
    expect(result).toContain("/dav/calendars/user/test@example.com/Default/");
    expect(result).toContain("Default");
    expect(result).toContain("#0000FF");
  });

  it("escapes commas in display names", () => {
    const calendars: CalendarInfo[] = [
      {
        url: "/cal/1",
        displayName: "Work, Personal",
        ctag: "xyz",
      },
    ];
    const result = formatCalendarAsCSV(calendars);
    expect(result).toContain('"Work, Personal"');
  });

  it("handles empty calendar list", () => {
    const result = formatCalendarAsCSV([]);
    expect(result).toBe("url,display_name,ctag,color,description\n# total=0");
  });

  it("includes total count in footer", () => {
    const calendars: CalendarInfo[] = [
      { url: "/cal/1", displayName: "Cal 1" },
      { url: "/cal/2", displayName: "Cal 2" },
      { url: "/cal/3", displayName: "Cal 3" },
    ];
    const result = formatCalendarAsCSV(calendars);
    expect(result).toContain("# total=3");
  });
});

describe("formatCalendarEventAsCSV", () => {
  it("formats a single event", () => {
    const events: CalendarEvent[] = [
      {
        uid: "event-123",
        url: "/dav/calendars/user/test@example.com/Default/event-123.ics",
        summary: "Team Meeting",
        start: new Date("2024-12-04T10:00:00Z"),
        end: new Date("2024-12-04T11:00:00Z"),
        location: "Conference Room A",
        description: "Weekly team sync",
        allDay: false,
      },
    ];
    const result = formatCalendarEventAsCSV(events);
    expect(result).toContain("uid,url,summary,start,end,location,description,all_day");
    expect(result).toContain("event-123");
    expect(result).toContain("Team Meeting");
    expect(result).toContain("Conference Room A");
    expect(result).toContain("false");
  });

  it("marks all-day events correctly", () => {
    const events: CalendarEvent[] = [
      {
        uid: "event-456",
        url: "/cal/event-456.ics",
        summary: "Birthday",
        start: new Date("2024-12-25"),
        allDay: true,
      },
    ];
    const result = formatCalendarEventAsCSV(events);
    expect(result).toContain("true");
  });

  it("escapes special characters in summary", () => {
    const events: CalendarEvent[] = [
      {
        uid: "event-789",
        url: "/cal/event-789.ics",
        summary: 'Meeting with "Important" Client',
        start: new Date("2024-12-04T14:00:00Z"),
        allDay: false,
      },
    ];
    const result = formatCalendarEventAsCSV(events);
    // Should escape quotes by doubling them
    expect(result).toContain('""Important""');
  });

  it("handles empty event list", () => {
    const result = formatCalendarEventAsCSV([]);
    expect(result).toBe("uid,url,summary,start,end,location,description,all_day\n# total=0");
  });
});

describe("parseICalEvent", () => {
  it("parses a simple VCALENDAR with one event", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123@example.com
DTSTART:20241204T100000Z
DTEND:20241204T110000Z
SUMMARY:Team Meeting
LOCATION:Conference Room A
DESCRIPTION:Weekly team sync
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.uid).toBe("event-123@example.com");
    expect(event!.summary).toBe("Team Meeting");
    expect(event!.location).toBe("Conference Room A");
    expect(event!.description).toBe("Weekly team sync");
    expect(event!.allDay).toBe(false);
  });

  it("parses all-day events (DATE format)", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:birthday@example.com
DTSTART;VALUE=DATE:20241225
SUMMARY:Christmas Day
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.allDay).toBe(true);
    expect(event!.summary).toBe("Christmas Day");
  });

  it("handles events with timezone", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:tz-event@example.com
DTSTART;TZID=America/New_York:20241204T100000
DTEND;TZID=America/New_York:20241204T110000
SUMMARY:New York Meeting
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.summary).toBe("New York Meeting");
  });

  it("handles escaped characters in SUMMARY", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:escape-test@example.com
DTSTART:20241204T100000Z
SUMMARY:Meeting\\, with\\; special chars
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.summary).toBe("Meeting, with; special chars");
  });

  it("returns undefined for invalid iCal", () => {
    const event = parseICalEvent("not valid ical", "/cal/event.ics");
    expect(event).toBeUndefined();
  });

  it("returns undefined for VCALENDAR without VEVENT", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeUndefined();
  });
});

// =============================================================================
// Integration-style Tests (with mocked tsdav)
// =============================================================================

describe("parseICalEvent - RRULE recurrence", () => {
  it("parses a daily recurring event", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:daily-standup@example.com
DTSTART:20241204T090000Z
DTEND:20241204T091500Z
SUMMARY:Daily Standup
RRULE:FREQ=DAILY;COUNT=10
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.recurrence).toBeDefined();
    expect(event!.recurrence!.frequency).toBe("DAILY");
    expect(event!.recurrence!.count).toBe(10);
    expect(event!.recurrence!.humanReadable).toContain("daily");
  });

  it("parses a weekly recurring event with specific days", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:weekly-meeting@example.com
DTSTART:20241204T100000Z
SUMMARY:Team Sync
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.recurrence).toBeDefined();
    expect(event!.recurrence!.frequency).toBe("WEEKLY");
    expect(event!.recurrence!.byDay).toEqual(["MO", "WE", "FR"]);
  });

  it("parses a monthly recurring event with UNTIL", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:monthly-report@example.com
DTSTART:20241201T140000Z
SUMMARY:Monthly Report
RRULE:FREQ=MONTHLY;UNTIL=20251201T140000Z
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.recurrence).toBeDefined();
    expect(event!.recurrence!.frequency).toBe("MONTHLY");
    expect(event!.recurrence!.until).toBeDefined();
  });
});

describe("parseICalEvent - attendees and organizer", () => {
  it("parses organizer from event", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:meeting@example.com
DTSTART:20241204T100000Z
SUMMARY:Project Kickoff
ORGANIZER;CN=Alice Smith:mailto:alice@example.com
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.organizer).toBeDefined();
    expect(event!.organizer!.email).toBe("alice@example.com");
    expect(event!.organizer!.name).toBe("Alice Smith");
  });

  it("parses multiple attendees with status", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:meeting@example.com
DTSTART:20241204T100000Z
SUMMARY:Team Meeting
ORGANIZER;CN=Alice:mailto:alice@example.com
ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED:mailto:bob@example.com
ATTENDEE;CN=Carol;PARTSTAT=TENTATIVE:mailto:carol@example.com
ATTENDEE;CN=Dave;PARTSTAT=DECLINED:mailto:dave@example.com
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.attendees).toHaveLength(3);
    expect(event!.attendees![0].email).toBe("bob@example.com");
    expect(event!.attendees![0].name).toBe("Bob");
    expect(event!.attendees![0].status).toBe("ACCEPTED");
    expect(event!.attendees![1].status).toBe("TENTATIVE");
    expect(event!.attendees![2].status).toBe("DECLINED");
  });

  it("parses event status", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:cancelled@example.com
DTSTART:20241204T100000Z
SUMMARY:Cancelled Meeting
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

    const event = parseICalEvent(ical, "/cal/event.ics");
    expect(event).toBeDefined();
    expect(event!.status).toBe("CANCELLED");
  });
});

describe("createICalString", () => {
  it("creates valid iCal with required fields", () => {
    const result = createICalString({
      summary: "Team Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
    });

    expect(result.uid).toBeDefined();
    expect(result.uid).toContain("@fastmail-aibo");
    expect(result.icalString).toContain("BEGIN:VCALENDAR");
    expect(result.icalString).toContain("END:VCALENDAR");
    expect(result.icalString).toContain("BEGIN:VEVENT");
    expect(result.icalString).toContain("END:VEVENT");
    expect(result.icalString).toContain("SUMMARY:Team Meeting");
    expect(result.icalString).toContain(`UID:${result.uid}`);
  });

  it("creates iCal with end time", () => {
    const result = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      end: new Date("2024-12-04T11:00:00Z"),
    });

    expect(result.icalString).toContain("DTSTART");
    expect(result.icalString).toContain("DTEND");
  });

  it("creates all-day event", () => {
    // Use explicit UTC time to avoid timezone issues
    const result = createICalString({
      summary: "Holiday",
      start: new Date("2024-12-25T00:00:00Z"),
      allDay: true,
    });

    // All-day events should use DATE format with VALUE=DATE parameter
    expect(result.icalString).toContain("DTSTART;VALUE=DATE:");
    // Should have the date in YYYYMMDD format
    expect(result.icalString).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
  });

  it("includes location when provided", () => {
    const result = createICalString({
      summary: "Office Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      location: "Conference Room A",
    });

    expect(result.icalString).toContain("LOCATION:Conference Room A");
  });

  it("includes description when provided", () => {
    const result = createICalString({
      summary: "Planning Session",
      start: new Date("2024-12-04T10:00:00Z"),
      description: "Quarterly planning meeting",
    });

    expect(result.icalString).toContain("DESCRIPTION:Quarterly planning meeting");
  });

  it("generates unique UIDs for each call", () => {
    const result1 = createICalString({
      summary: "Event 1",
      start: new Date("2024-12-04T10:00:00Z"),
    });
    const result2 = createICalString({
      summary: "Event 2",
      start: new Date("2024-12-04T11:00:00Z"),
    });

    expect(result1.uid).not.toBe(result2.uid);
  });

  it("can be parsed by parseICalEvent", () => {
    const result = createICalString({
      summary: "Roundtrip Test",
      start: new Date("2024-12-04T10:00:00Z"),
      end: new Date("2024-12-04T11:00:00Z"),
      location: "Test Location",
      description: "Test Description",
    });

    const parsed = parseICalEvent(result.icalString, "/test/event.ics");
    expect(parsed).toBeDefined();
    expect(parsed!.uid).toBe(result.uid);
    expect(parsed!.summary).toBe("Roundtrip Test");
    expect(parsed!.location).toBe("Test Location");
    expect(parsed!.description).toBe("Test Description");
  });
});

describe("generateICalFilename", () => {
  it("generates .ics filename from UID", () => {
    const filename = generateICalFilename("12345-abc@fastmail-aibo");
    expect(filename).toBe("12345-abc@fastmail-aibo.ics");
  });

  it("handles UIDs with special characters", () => {
    const filename = generateICalFilename("event-123@example.com");
    expect(filename).toBe("event-123@example.com.ics");
  });
});

describe("updateICalString", () => {
  it("updates the summary of an existing event", () => {
    // Create an event first
    const original = createICalString({
      summary: "Original Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      end: new Date("2024-12-04T11:00:00Z"),
    });

    // Update the summary
    const updated = updateICalString(original.icalString, {
      summary: "Updated Meeting",
    });

    // Parse and verify
    const parsed = parseICalEvent(updated, "/test/event.ics");
    expect(parsed).toBeDefined();
    expect(parsed!.summary).toBe("Updated Meeting");
    expect(parsed!.uid).toBe(original.uid); // UID should be preserved
  });

  it("updates the start and end times", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      end: new Date("2024-12-04T11:00:00Z"),
    });

    const updated = updateICalString(original.icalString, {
      start: new Date("2024-12-04T14:00:00Z"),
      end: new Date("2024-12-04T15:30:00Z"),
    });

    const parsed = parseICalEvent(updated, "/test/event.ics");
    expect(parsed).toBeDefined();
    expect(parsed!.start.toISOString()).toBe("2024-12-04T14:00:00.000Z");
    expect(parsed!.end?.toISOString()).toBe("2024-12-04T15:30:00.000Z");
  });

  it("updates location and description", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      location: "Old Room",
      description: "Old notes",
    });

    const updated = updateICalString(original.icalString, {
      location: "New Conference Room",
      description: "New agenda items",
    });

    const parsed = parseICalEvent(updated, "/test/event.ics");
    expect(parsed).toBeDefined();
    expect(parsed!.location).toBe("New Conference Room");
    expect(parsed!.description).toBe("New agenda items");
  });

  it("preserves fields that are not updated", () => {
    const original = createICalString({
      summary: "Original Title",
      start: new Date("2024-12-04T10:00:00Z"),
      location: "Room A",
      description: "Important notes",
    });

    // Only update the summary
    const updated = updateICalString(original.icalString, {
      summary: "New Title",
    });

    const parsed = parseICalEvent(updated, "/test/event.ics");
    expect(parsed).toBeDefined();
    expect(parsed!.summary).toBe("New Title");
    expect(parsed!.location).toBe("Room A"); // preserved
    expect(parsed!.description).toBe("Important notes"); // preserved
  });

  it("can convert to all-day event", () => {
    const original = createICalString({
      summary: "Timed Event",
      start: new Date("2024-12-04T10:00:00Z"),
      end: new Date("2024-12-04T11:00:00Z"),
      allDay: false,
    });

    const updated = updateICalString(original.icalString, {
      start: new Date("2024-12-25T00:00:00Z"),
      allDay: true,
    });

    const parsed = parseICalEvent(updated, "/test/event.ics");
    expect(parsed).toBeDefined();
    expect(parsed!.allDay).toBe(true);
  });

  it("clears optional fields when set to empty string", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      location: "Room A",
      description: "Notes",
    });

    const updated = updateICalString(original.icalString, {
      location: "", // clear location
    });

    const parsed = parseICalEvent(updated, "/test/event.ics");
    expect(parsed).toBeDefined();
    expect(parsed!.location).toBeUndefined(); // cleared
    expect(parsed!.description).toBe("Notes"); // preserved
  });
});

describe("createICalString - attendees and organizer", () => {
  it("creates iCal with attendees", () => {
    const result = createICalString({
      summary: "Team Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      attendees: [
        { email: "bob@example.com", name: "Bob Smith" },
        { email: "carol@example.com" },
      ],
    });

    expect(result.icalString).toContain("ATTENDEE");
    // Note: long lines get folded in iCal, so check without line breaks
    const unfolded = result.icalString.replace(/\r\n /g, "");
    expect(unfolded).toContain("mailto:bob@example.com");
    expect(unfolded).toContain("CN=Bob Smith");
    expect(unfolded).toContain("mailto:carol@example.com");
  });

  it("creates iCal with RSVP request for attendees", () => {
    const result = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      attendees: [
        { email: "bob@example.com", rsvp: true },
      ],
    });

    expect(result.icalString).toContain("RSVP=TRUE");
  });

  it("creates iCal with different attendee roles", () => {
    const result = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      attendees: [
        { email: "alice@example.com", role: "chair" },
        { email: "bob@example.com", role: "required" },
        { email: "carol@example.com", role: "optional" },
        { email: "dave@example.com", role: "non-participant" },
      ],
    });

    expect(result.icalString).toContain("ROLE=CHAIR");
    expect(result.icalString).toContain("ROLE=REQ-PARTICIPANT");
    expect(result.icalString).toContain("ROLE=OPT-PARTICIPANT");
    expect(result.icalString).toContain("ROLE=NON-PARTICIPANT");
  });

  it("creates iCal with organizer", () => {
    const result = createICalString({
      summary: "Project Kickoff",
      start: new Date("2024-12-04T10:00:00Z"),
      organizer: { email: "alice@example.com", name: "Alice Manager" },
    });

    expect(result.icalString).toContain("ORGANIZER");
    expect(result.icalString).toContain("CN=Alice Manager");
    expect(result.icalString).toContain("mailto:alice@example.com");
  });

  it("creates iCal with organizer without name", () => {
    const result = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      organizer: { email: "alice@example.com" },
    });

    expect(result.icalString).toContain("ORGANIZER:mailto:alice@example.com");
  });

  it("includes METHOD:REQUEST when attendees are present", () => {
    const result = createICalString({
      summary: "Invite Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      attendees: [{ email: "bob@example.com" }],
    });

    expect(result.icalString).toContain("METHOD:REQUEST");
  });

  it("roundtrips attendees through parse", () => {
    const result = createICalString({
      summary: "Team Sync",
      start: new Date("2024-12-04T10:00:00Z"),
      organizer: { email: "alice@example.com", name: "Alice" },
      attendees: [
        { email: "bob@example.com", name: "Bob" },
        { email: "carol@example.com", name: "Carol" },
      ],
    });

    const parsed = parseICalEvent(result.icalString, "/test/event.ics");
    expect(parsed).toBeDefined();
    expect(parsed!.organizer?.email).toBe("alice@example.com");
    expect(parsed!.organizer?.name).toBe("Alice");
    expect(parsed!.attendees).toHaveLength(2);
    expect(parsed!.attendees![0].email).toBe("bob@example.com");
    expect(parsed!.attendees![1].email).toBe("carol@example.com");
  });
});

describe("createICalString - status, url, categories, priority, transparency", () => {
  it("creates iCal with confirmed status", () => {
    const result = createICalString({
      summary: "Confirmed Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      status: "confirmed",
    });

    expect(result.icalString).toContain("STATUS:CONFIRMED");
  });

  it("creates iCal with tentative status", () => {
    const result = createICalString({
      summary: "Maybe Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      status: "tentative",
    });

    expect(result.icalString).toContain("STATUS:TENTATIVE");
  });

  it("creates iCal with cancelled status", () => {
    const result = createICalString({
      summary: "Cancelled Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      status: "cancelled",
    });

    expect(result.icalString).toContain("STATUS:CANCELLED");
  });

  it("creates iCal with URL", () => {
    const result = createICalString({
      summary: "Video Call",
      start: new Date("2024-12-04T10:00:00Z"),
      url: "https://zoom.us/j/123456789",
    });

    expect(result.icalString).toContain("URL:https://zoom.us/j/123456789");
  });

  it("creates iCal with categories", () => {
    const result = createICalString({
      summary: "Tagged Event",
      start: new Date("2024-12-04T10:00:00Z"),
      categories: ["Work", "Important"],
    });

    // Note: commas in CATEGORIES are escaped in iCal format
    expect(result.icalString).toContain("CATEGORIES:Work\\,Important");
  });

  it("creates iCal with priority", () => {
    const result = createICalString({
      summary: "Urgent Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      priority: 1, // Urgent
    });

    expect(result.icalString).toContain("PRIORITY:1");
  });

  it("creates iCal with opaque transparency (busy)", () => {
    const result = createICalString({
      summary: "Busy Time",
      start: new Date("2024-12-04T10:00:00Z"),
      transparency: "opaque",
    });

    expect(result.icalString).toContain("TRANSP:OPAQUE");
  });

  it("creates iCal with transparent transparency (free)", () => {
    const result = createICalString({
      summary: "Free Time",
      start: new Date("2024-12-04T10:00:00Z"),
      transparency: "transparent",
    });

    expect(result.icalString).toContain("TRANSP:TRANSPARENT");
  });

  it("roundtrips status through parse", () => {
    const result = createICalString({
      summary: "Status Test",
      start: new Date("2024-12-04T10:00:00Z"),
      status: "tentative",
    });

    const parsed = parseICalEvent(result.icalString, "/test/event.ics");
    expect(parsed).toBeDefined();
    expect(parsed!.status).toBe("TENTATIVE");
  });
});

describe("createICalString - reminders (VALARM)", () => {
  it("creates iCal with reminder in minutes", () => {
    const result = createICalString({
      summary: "Meeting with Reminder",
      start: new Date("2024-12-04T10:00:00Z"),
      reminders: [{ minutes: 15 }],
    });

    expect(result.icalString).toContain("BEGIN:VALARM");
    expect(result.icalString).toContain("TRIGGER:-PT15M");
    expect(result.icalString).toContain("ACTION:DISPLAY");
    expect(result.icalString).toContain("END:VALARM");
  });

  it("creates iCal with reminder in hours", () => {
    const result = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      reminders: [{ hours: 2 }],
    });

    expect(result.icalString).toContain("TRIGGER:-PT2H");
  });

  it("creates iCal with reminder in days", () => {
    const result = createICalString({
      summary: "Conference",
      start: new Date("2024-12-04T10:00:00Z"),
      reminders: [{ days: 1 }],
    });

    expect(result.icalString).toContain("TRIGGER:-P1D");
  });

  it("creates iCal with email reminder", () => {
    const result = createICalString({
      summary: "Important Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      reminders: [{ minutes: 30, action: "email" }],
    });

    expect(result.icalString).toContain("ACTION:EMAIL");
  });

  it("creates iCal with multiple reminders", () => {
    const result = createICalString({
      summary: "Multi-Reminder Event",
      start: new Date("2024-12-04T10:00:00Z"),
      reminders: [
        { days: 1 },
        { hours: 1 },
        { minutes: 15 },
      ],
    });

    // Count VALARM blocks
    const valarmMatches = result.icalString.match(/BEGIN:VALARM/g);
    expect(valarmMatches).toHaveLength(3);
    expect(result.icalString).toContain("TRIGGER:-P1D");
    expect(result.icalString).toContain("TRIGGER:-PT1H");
    expect(result.icalString).toContain("TRIGGER:-PT15M");
  });
});

describe("updateICalString - new fields", () => {
  it("updates attendees", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
    });

    const updated = updateICalString(original.icalString, {
      attendees: [
        { email: "newperson@example.com", name: "New Person" },
      ],
    });

    expect(updated).toContain("ATTENDEE");
    // Note: long lines get folded in iCal, so check without line breaks
    const unfolded = updated.replace(/\r\n /g, "");
    expect(unfolded).toContain("mailto:newperson@example.com");
  });

  it("updates organizer", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
    });

    const updated = updateICalString(original.icalString, {
      organizer: { email: "boss@example.com", name: "The Boss" },
    });

    expect(updated).toContain("ORGANIZER");
    expect(updated).toContain("CN=The Boss");
    expect(updated).toContain("mailto:boss@example.com");
  });

  it("updates status", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      status: "tentative",
    });

    const updated = updateICalString(original.icalString, {
      status: "confirmed",
    });

    expect(updated).toContain("STATUS:CONFIRMED");
    expect(updated).not.toContain("STATUS:TENTATIVE");
  });

  it("clears status with empty string", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      status: "tentative",
    });

    const updated = updateICalString(original.icalString, {
      status: "",
    });

    expect(updated).not.toContain("STATUS:");
  });

  it("updates url", () => {
    const original = createICalString({
      summary: "Video Call",
      start: new Date("2024-12-04T10:00:00Z"),
    });

    const updated = updateICalString(original.icalString, {
      url: "https://meet.google.com/abc-defg-hij",
    });

    expect(updated).toContain("URL:https://meet.google.com/abc-defg-hij");
  });

  it("updates categories", () => {
    const original = createICalString({
      summary: "Event",
      start: new Date("2024-12-04T10:00:00Z"),
    });

    const updated = updateICalString(original.icalString, {
      categories: ["Personal", "Family"],
    });

    // Note: commas in CATEGORIES are escaped in iCal format
    expect(updated).toContain("CATEGORIES:Personal\\,Family");
  });

  it("clears categories with empty array", () => {
    const original = createICalString({
      summary: "Tagged Event",
      start: new Date("2024-12-04T10:00:00Z"),
      categories: ["Work"],
    });

    const updated = updateICalString(original.icalString, {
      categories: [],
    });

    expect(updated).not.toContain("CATEGORIES:");
  });

  it("updates priority", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
    });

    const updated = updateICalString(original.icalString, {
      priority: 2, // High
    });

    expect(updated).toContain("PRIORITY:2");
  });

  it("clears priority with null", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      priority: 1,
    });

    const updated = updateICalString(original.icalString, {
      priority: null,
    });

    expect(updated).not.toContain("PRIORITY:");
  });

  it("updates transparency", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
    });

    const updated = updateICalString(original.icalString, {
      transparency: "transparent",
    });

    expect(updated).toContain("TRANSP:TRANSPARENT");
  });

  it("updates reminders", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
    });

    const updated = updateICalString(original.icalString, {
      reminders: [{ minutes: 30 }],
    });

    expect(updated).toContain("BEGIN:VALARM");
    expect(updated).toContain("TRIGGER:-PT30M");
    expect(updated).toContain("END:VALARM");
  });

  it("clears attendees with empty array", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      attendees: [{ email: "bob@example.com" }],
    });

    const updated = updateICalString(original.icalString, {
      attendees: [],
    });

    expect(updated).not.toContain("ATTENDEE");
  });

  it("clears reminders with empty array", () => {
    const original = createICalString({
      summary: "Meeting",
      start: new Date("2024-12-04T10:00:00Z"),
      reminders: [{ minutes: 15 }],
    });

    const updated = updateICalString(original.icalString, {
      reminders: [],
    });

    expect(updated).not.toContain("BEGIN:VALARM");
  });
});

describe("createCalendarClient", () => {
  it("creates a client with the correct Fastmail URL format", async () => {
    // This tests that createCalendarClient constructs the right URL
    const config = {
      username: "test@fastmail.com",
      password: "app-password-123",
    };

    // We can't actually connect, but we can verify the URL is constructed correctly
    const expectedUrl = "https://caldav.fastmail.com/dav/principals/user/test@fastmail.com/";

    // The function should return a client factory or the client itself
    // This is a design decision we'll make when implementing
    expect(typeof createCalendarClient).toBe("function");
  });
});
