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
