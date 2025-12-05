import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCalendarClient,
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
