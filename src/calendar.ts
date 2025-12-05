import { DAVClient, DAVCalendar, DAVCalendarObject } from "tsdav";

// =============================================================================
// Types
// =============================================================================

export interface CalendarInfo {
  url: string;
  displayName: string;
  ctag?: string;
  color?: string;
  description?: string;
}

export interface CalendarEvent {
  uid: string;
  url: string;
  summary: string;
  start: Date;
  end?: Date;
  location?: string;
  description?: string;
  allDay: boolean;
}

export interface CalendarClientConfig {
  username: string;
  password: string;
}

// =============================================================================
// CSV Escaping (reusing pattern from email utils)
// =============================================================================

const escapeCSVField = (value: string | undefined | null): string => {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

// =============================================================================
// Calendar Formatting
// =============================================================================

export const formatCalendarAsCSV = (calendars: CalendarInfo[]): string => {
  const header = "url,display_name,ctag,color,description";
  if (calendars.length === 0) {
    return `${header}\n# total=0`;
  }

  const rows = calendars.map((cal) =>
    [
      escapeCSVField(cal.url),
      escapeCSVField(cal.displayName),
      escapeCSVField(cal.ctag),
      escapeCSVField(cal.color),
      escapeCSVField(cal.description),
    ].join(",")
  );

  return `${header}\n${rows.join("\n")}\n# total=${calendars.length}`;
};

export const formatCalendarEventAsCSV = (events: CalendarEvent[]): string => {
  const header = "uid,url,summary,start,end,location,description,all_day";
  if (events.length === 0) {
    return `${header}\n# total=0`;
  }

  const rows = events.map((event) =>
    [
      escapeCSVField(event.uid),
      escapeCSVField(event.url),
      escapeCSVField(event.summary),
      escapeCSVField(event.start?.toISOString() ?? ""),
      escapeCSVField(event.end?.toISOString() ?? ""),
      escapeCSVField(event.location),
      escapeCSVField(event.description),
      String(event.allDay),
    ].join(",")
  );

  return `${header}\n${rows.join("\n")}\n# total=${events.length}`;
};

// =============================================================================
// iCal Parsing
// =============================================================================

/**
 * Parse iCal content and extract event details
 * Handles common iCal escaping and format variations
 */
export const parseICalEvent = (
  icalContent: string,
  url: string
): CalendarEvent | undefined => {
  // Check for valid structure
  if (!icalContent.includes("BEGIN:VCALENDAR") || !icalContent.includes("BEGIN:VEVENT")) {
    return undefined;
  }

  // Extract VEVENT block
  const veventMatch = icalContent.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/);
  if (!veventMatch) {
    return undefined;
  }
  const vevent = veventMatch[0];

  // Helper to extract a property value
  const extractProperty = (name: string): string | undefined => {
    // Handle properties with parameters like DTSTART;TZID=...:value
    const regex = new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "m");
    const match = vevent.match(regex);
    if (match) {
      // Unescape iCal escapes: \, -> , and \; -> ;
      return match[1].trim().replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, "\n");
    }
    return undefined;
  };

  // Parse date/datetime
  const parseDateTime = (name: string): { date: Date | undefined; allDay: boolean } => {
    // Check for VALUE=DATE (all-day)
    const allDayRegex = new RegExp(`^${name};VALUE=DATE:(\\d{8})$`, "m");
    const allDayMatch = vevent.match(allDayRegex);
    if (allDayMatch) {
      const dateStr = allDayMatch[1];
      const year = parseInt(dateStr.slice(0, 4));
      const month = parseInt(dateStr.slice(4, 6)) - 1;
      const day = parseInt(dateStr.slice(6, 8));
      return { date: new Date(Date.UTC(year, month, day)), allDay: true };
    }

    // Check for datetime with timezone or UTC
    const dtRegex = new RegExp(`^${name}(?:;TZID=[^:]*)?:(\\d{8}T\\d{6}Z?)$`, "m");
    const dtMatch = vevent.match(dtRegex);
    if (dtMatch) {
      const dtStr = dtMatch[1];
      const year = parseInt(dtStr.slice(0, 4));
      const month = parseInt(dtStr.slice(4, 6)) - 1;
      const day = parseInt(dtStr.slice(6, 8));
      const hour = parseInt(dtStr.slice(9, 11));
      const minute = parseInt(dtStr.slice(11, 13));
      const second = parseInt(dtStr.slice(13, 15));

      // If ends with Z, it's UTC
      if (dtStr.endsWith("Z")) {
        return { date: new Date(Date.UTC(year, month, day, hour, minute, second)), allDay: false };
      }
      // Otherwise treat as local (this is a simplification - proper timezone handling would need a library)
      return { date: new Date(year, month, day, hour, minute, second), allDay: false };
    }

    return { date: undefined, allDay: false };
  };

  const uid = extractProperty("UID");
  const summary = extractProperty("SUMMARY");
  const location = extractProperty("LOCATION");
  const description = extractProperty("DESCRIPTION");
  const { date: start, allDay } = parseDateTime("DTSTART");
  const { date: end } = parseDateTime("DTEND");

  if (!uid || !start) {
    return undefined;
  }

  return {
    uid,
    url,
    summary: summary ?? "",
    start,
    end,
    location,
    description,
    allDay,
  };
};

// =============================================================================
// CalDAV Client
// =============================================================================

/**
 * Creates a CalDAV client configured for Fastmail
 */
export const createCalendarClient = async (
  config: CalendarClientConfig
): Promise<DAVClient> => {
  const serverUrl = `https://caldav.fastmail.com/dav/principals/user/${config.username}/`;

  const client = new DAVClient({
    serverUrl,
    credentials: {
      username: config.username,
      password: config.password,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  await client.login();
  return client;
};

/**
 * Fetch all calendars for the authenticated user
 */
export const fetchCalendars = async (client: DAVClient): Promise<CalendarInfo[]> => {
  const calendars = await client.fetchCalendars();
  return calendars.map((cal: DAVCalendar) => ({
    url: cal.url,
    displayName: cal.displayName ?? "Unnamed",
    ctag: cal.ctag,
    // tsdav includes these in props
    color: (cal as any).calendarColor,
    description: (cal as any).calendarDescription,
  }));
};

/**
 * Fetch calendar events, optionally filtered by time range
 */
export const fetchCalendarEvents = async (
  client: DAVClient,
  calendar: DAVCalendar,
  options?: {
    timeRange?: {
      start: Date;
      end: Date;
    };
  }
): Promise<CalendarEvent[]> => {
  const objects = await client.fetchCalendarObjects({
    calendar,
    timeRange: options?.timeRange
      ? {
          start: options.timeRange.start.toISOString(),
          end: options.timeRange.end.toISOString(),
        }
      : undefined,
  });

  const events: CalendarEvent[] = [];
  for (const obj of objects) {
    if (obj.data) {
      const event = parseICalEvent(obj.data, obj.url);
      if (event) {
        events.push(event);
      }
    }
  }

  return events;
};
