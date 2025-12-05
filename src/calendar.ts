import { DAVClient, DAVCalendar, DAVCalendarObject } from "tsdav";
import ICAL from "ical.js";

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

export interface Attendee {
  email: string;
  name?: string;
  status?: string; // ACCEPTED, DECLINED, TENTATIVE, NEEDS-ACTION
}

export interface Organizer {
  email: string;
  name?: string;
}

export interface RecurrenceInfo {
  frequency: string; // DAILY, WEEKLY, MONTHLY, YEARLY
  interval?: number;
  count?: number;
  until?: Date;
  byDay?: string[]; // MO, TU, WE, TH, FR, SA, SU
  humanReadable: string;
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
  status?: string; // CONFIRMED, TENTATIVE, CANCELLED
  organizer?: Organizer;
  attendees?: Attendee[];
  recurrence?: RecurrenceInfo;
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
// iCal Parsing (using ical.js)
// =============================================================================

/**
 * Generate a human-readable description of a recurrence rule
 */
const formatRecurrenceHumanReadable = (rrule: any): string => {
  const freq = rrule.freq?.toLowerCase() ?? "unknown";
  const interval = rrule.interval ?? 1;
  const parts: string[] = [];

  // Frequency with interval
  if (interval === 1) {
    parts.push(freq);
  } else {
    parts.push(`every ${interval} ${freq.replace("ly", "")}s`);
  }

  // Days of week - ical.js uses getComponent() for parts
  const byDay = rrule.getComponent?.('byday');
  if (byDay && byDay.length > 0) {
    const dayNames: Record<string, string> = {
      SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday",
      TH: "Thursday", FR: "Friday", SA: "Saturday",
    };
    const days = byDay.map((d: string) => dayNames[d] ?? d);
    parts.push(`on ${days.join(", ")}`);
  }

  // Count or until
  if (rrule.count) {
    parts.push(`(${rrule.count} times)`);
  } else if (rrule.until) {
    parts.push(`until ${rrule.until.toJSDate().toISOString().split("T")[0]}`);
  }

  return parts.join(" ");
};

/**
 * Extract email from mailto: URI
 */
const extractEmail = (value: string): string => {
  if (value.toLowerCase().startsWith("mailto:")) {
    return value.slice(7);
  }
  return value;
};

/**
 * Parse iCal content and extract event details using ical.js
 */
export const parseICalEvent = (
  icalContent: string,
  url: string
): CalendarEvent | undefined => {
  // Check for valid structure
  if (!icalContent.includes("BEGIN:VCALENDAR") || !icalContent.includes("BEGIN:VEVENT")) {
    return undefined;
  }

  try {
    const jcalData = ICAL.parse(icalContent);
    const vcalendar = new ICAL.Component(jcalData);
    const vevent = vcalendar.getFirstSubcomponent("vevent");

    if (!vevent) {
      return undefined;
    }

    const event = new ICAL.Event(vevent);

    // Get UID
    const uid = event.uid;
    if (!uid) {
      return undefined;
    }

    // Get start date
    const startTime = event.startDate;
    if (!startTime) {
      return undefined;
    }

    // Determine if all-day (DATE vs DATE-TIME)
    const allDay = startTime.isDate;

    // Convert ICAL.Time to JS Date
    const start = startTime.toJSDate();
    const end = event.endDate ? event.endDate.toJSDate() : undefined;

    // Build the result
    const result: CalendarEvent = {
      uid,
      url,
      summary: event.summary ?? "",
      start,
      end,
      location: event.location ?? undefined,
      description: event.description ?? undefined,
      allDay,
    };

    // Parse status
    const statusProp = vevent.getFirstPropertyValue("status");
    if (statusProp) {
      result.status = String(statusProp).toUpperCase();
    }

    // Parse organizer
    const organizerProp = vevent.getFirstProperty("organizer");
    if (organizerProp) {
      const orgValue = organizerProp.getFirstValue();
      const orgCN = organizerProp.getParameter("cn");
      result.organizer = {
        email: extractEmail(String(orgValue)),
        name: orgCN ? String(orgCN) : undefined,
      };
    }

    // Parse attendees
    const attendeeProps = vevent.getAllProperties("attendee");
    if (attendeeProps.length > 0) {
      result.attendees = attendeeProps.map((prop: any) => {
        const value = prop.getFirstValue();
        const cn = prop.getParameter("cn");
        const partstat = prop.getParameter("partstat");
        return {
          email: extractEmail(String(value)),
          name: cn ? String(cn) : undefined,
          status: partstat ? String(partstat).toUpperCase() : undefined,
        };
      });
    }

    // Parse RRULE for recurrence
    const rruleProp = vevent.getFirstProperty("rrule");
    if (rruleProp) {
      const rruleValue = rruleProp.getFirstValue();
      if (rruleValue) {
        const recurrence: RecurrenceInfo = {
          frequency: rruleValue.freq,
          humanReadable: formatRecurrenceHumanReadable(rruleValue),
        };

        if (rruleValue.interval && rruleValue.interval > 1) {
          recurrence.interval = rruleValue.interval;
        }
        if (rruleValue.count) {
          recurrence.count = rruleValue.count;
        }
        if (rruleValue.until) {
          recurrence.until = rruleValue.until.toJSDate();
        }
        // ical.js stores BYDAY in getComponent() or parts.BYDAY
        const byDay = rruleValue.getComponent('byday');
        if (byDay && byDay.length > 0) {
          recurrence.byDay = byDay;
        }

        result.recurrence = recurrence;
      }
    }

    return result;
  } catch (error) {
    // If ical.js fails to parse, return undefined
    return undefined;
  }
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
