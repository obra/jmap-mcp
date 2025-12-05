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
  rsvp?: boolean; // Request RSVP from attendee
  role?: string; // REQ-PARTICIPANT, OPT-PARTICIPANT, NON-PARTICIPANT, CHAIR
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

export interface Reminder {
  trigger: string; // e.g., "-PT15M" (15 min before), "-P1D" (1 day before)
  action?: string; // DISPLAY (default), EMAIL, AUDIO
  description?: string; // For DISPLAY/EMAIL actions
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
  // Additional fields
  categories?: string[]; // Tags/categories
  priority?: number; // 1-9 (1=highest, 9=lowest)
  transparency?: string; // OPAQUE (busy) or TRANSPARENT (free)
  eventUrl?: string; // URL for event (e.g., meeting link)
  reminders?: Reminder[];
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
      // ical.js returns a Recur object but types are incomplete
      const rruleValue = rruleProp.getFirstValue() as any;
      if (rruleValue && rruleValue.freq) {
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
        const byDay = rruleValue.getComponent?.('byday');
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
// iCal Generation (using ical.js)
// =============================================================================

export interface RecurrenceParams {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number; // Every N days/weeks/months/years (default 1)
  count?: number; // Number of occurrences
  until?: Date; // End date for recurrence
  byDay?: string[]; // Days of week: MO, TU, WE, TH, FR, SA, SU
}

export interface AttendeeInput {
  email: string;
  name?: string;
  rsvp?: boolean; // Request RSVP (default true)
  role?: "required" | "optional" | "non-participant" | "chair";
}

export interface ReminderInput {
  minutes?: number; // Minutes before event (e.g., 15, 30, 60)
  hours?: number; // Hours before event
  days?: number; // Days before event
  action?: "display" | "email"; // Default: display
}

export interface CreateEventParams {
  summary: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
  location?: string;
  description?: string;
  recurrence?: RecurrenceParams;
  // Attendees and organizer
  attendees?: AttendeeInput[];
  organizer?: { email: string; name?: string };
  // Additional fields
  status?: "confirmed" | "tentative" | "cancelled";
  url?: string; // Meeting link
  categories?: string[];
  priority?: number; // 1-9
  transparency?: "opaque" | "transparent"; // busy or free
  reminders?: ReminderInput[];
}

/**
 * Generate a unique UID for a new calendar event
 */
const generateEventUid = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}@fastmail-aibo`;
};

/**
 * Convert role string to iCalendar ROLE parameter value
 */
const roleToICalRole = (role: string): string => {
  const mapping: Record<string, string> = {
    required: "REQ-PARTICIPANT",
    optional: "OPT-PARTICIPANT",
    "non-participant": "NON-PARTICIPANT",
    chair: "CHAIR",
  };
  return mapping[role] ?? "REQ-PARTICIPANT";
};

/**
 * Convert reminder input to iCalendar duration string
 */
const reminderToDuration = (reminder: ReminderInput): string => {
  if (reminder.days) {
    return `-P${reminder.days}D`;
  }
  if (reminder.hours) {
    return `-PT${reminder.hours}H`;
  }
  if (reminder.minutes) {
    return `-PT${reminder.minutes}M`;
  }
  return "-PT15M"; // Default 15 minutes
};

/**
 * Create an iCal string for a new event using ical.js
 */
export const createICalString = (params: CreateEventParams): { icalString: string; uid: string } => {
  const uid = generateEventUid();

  // Create VCALENDAR component
  const vcalendar = new ICAL.Component(["vcalendar", [], []]);
  vcalendar.updatePropertyWithValue("version", "2.0");
  vcalendar.updatePropertyWithValue("prodid", "-//Fastmail Aibo//EN");
  // Required for iTIP (calendar invitations)
  vcalendar.updatePropertyWithValue("method", "REQUEST");

  // Create VEVENT component
  const vevent = new ICAL.Component("vevent");
  vevent.updatePropertyWithValue("uid", uid);
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  vevent.updatePropertyWithValue("summary", params.summary);

  // Set start time
  const startTime = ICAL.Time.fromJSDate(params.start, false);
  if (params.allDay) {
    startTime.isDate = true;
  }
  vevent.updatePropertyWithValue("dtstart", startTime);

  // Set end time (if provided)
  if (params.end) {
    const endTime = ICAL.Time.fromJSDate(params.end, false);
    if (params.allDay) {
      endTime.isDate = true;
    }
    vevent.updatePropertyWithValue("dtend", endTime);
  }

  // Optional fields
  if (params.location) {
    vevent.updatePropertyWithValue("location", params.location);
  }
  if (params.description) {
    vevent.updatePropertyWithValue("description", params.description);
  }

  // Status (CONFIRMED, TENTATIVE, CANCELLED)
  if (params.status) {
    vevent.updatePropertyWithValue("status", params.status.toUpperCase());
  }

  // URL (meeting link)
  if (params.url) {
    vevent.updatePropertyWithValue("url", params.url);
  }

  // Categories/tags
  if (params.categories && params.categories.length > 0) {
    vevent.updatePropertyWithValue("categories", params.categories.join(","));
  }

  // Priority (1-9)
  if (params.priority !== undefined && params.priority >= 1 && params.priority <= 9) {
    vevent.updatePropertyWithValue("priority", params.priority);
  }

  // Transparency (OPAQUE = busy, TRANSPARENT = free)
  if (params.transparency) {
    vevent.updatePropertyWithValue("transp", params.transparency.toUpperCase());
  }

  // Organizer
  if (params.organizer) {
    const organizerProp = new ICAL.Property("organizer");
    organizerProp.setValue(`mailto:${params.organizer.email}`);
    if (params.organizer.name) {
      organizerProp.setParameter("cn", params.organizer.name);
    }
    vevent.addProperty(organizerProp);
  }

  // Attendees
  if (params.attendees && params.attendees.length > 0) {
    for (const attendee of params.attendees) {
      const attendeeProp = new ICAL.Property("attendee");
      attendeeProp.setValue(`mailto:${attendee.email}`);
      if (attendee.name) {
        attendeeProp.setParameter("cn", attendee.name);
      }
      // RSVP defaults to true for meeting invitations
      attendeeProp.setParameter("rsvp", attendee.rsvp !== false ? "TRUE" : "FALSE");
      // Participation status starts as NEEDS-ACTION
      attendeeProp.setParameter("partstat", "NEEDS-ACTION");
      // Role
      if (attendee.role) {
        attendeeProp.setParameter("role", roleToICalRole(attendee.role));
      }
      vevent.addProperty(attendeeProp);
    }
  }

  // Reminders/Alarms
  if (params.reminders && params.reminders.length > 0) {
    for (const reminder of params.reminders) {
      const valarm = new ICAL.Component("valarm");
      valarm.updatePropertyWithValue("action", (reminder.action ?? "display").toUpperCase());

      // Create TRIGGER property with duration
      const triggerProp = new ICAL.Property("trigger");
      const duration = ICAL.Duration.fromString(reminderToDuration(reminder));
      triggerProp.setValue(duration);
      valarm.addProperty(triggerProp);

      // DISPLAY alarms need a DESCRIPTION
      if (!reminder.action || reminder.action === "display") {
        valarm.updatePropertyWithValue("description", params.summary);
      }

      vevent.addSubcomponent(valarm);
    }
  }

  // Recurrence rule
  if (params.recurrence) {
    const rrule = new ICAL.Recur({
      freq: params.recurrence.frequency.toUpperCase(),
      interval: params.recurrence.interval || 1,
    });

    if (params.recurrence.count) {
      rrule.count = params.recurrence.count;
    }
    if (params.recurrence.until) {
      rrule.until = ICAL.Time.fromJSDate(params.recurrence.until, false);
    }
    if (params.recurrence.byDay && params.recurrence.byDay.length > 0) {
      rrule.setComponent("byday", params.recurrence.byDay.map((d) => d.toUpperCase()));
    }

    vevent.updatePropertyWithValue("rrule", rrule);
  }

  vcalendar.addSubcomponent(vevent);

  return {
    icalString: vcalendar.toString(),
    uid,
  };
};

/**
 * Generate iCal filename from UID
 */
export const generateICalFilename = (uid: string): string => {
  return `${uid}.ics`;
};

// =============================================================================
// iCal Update (using ical.js)
// =============================================================================

export interface UpdateEventParams {
  summary?: string;
  start?: Date;
  end?: Date;
  allDay?: boolean;
  location?: string;
  description?: string;
  // Attendees and organizer
  attendees?: AttendeeInput[]; // Empty array clears all attendees
  organizer?: { email: string; name?: string };
  // Additional fields
  status?: "confirmed" | "tentative" | "cancelled" | ""; // Empty string clears
  url?: string; // Empty string clears
  categories?: string[]; // Empty array clears
  priority?: number | null; // null clears
  transparency?: "opaque" | "transparent" | ""; // Empty string clears
  reminders?: ReminderInput[]; // Empty array clears
}

/**
 * Update an existing iCal string with new values
 * Preserves the UID and other fields not being updated
 * Empty string values clear the field
 */
export const updateICalString = (
  icalString: string,
  updates: UpdateEventParams
): string => {
  const jcalData = ICAL.parse(icalString);
  const vcalendar = new ICAL.Component(jcalData);
  const vevent = vcalendar.getFirstSubcomponent("vevent");

  if (!vevent) {
    throw new Error("No VEVENT found in iCal string");
  }

  // Update summary
  if (updates.summary !== undefined) {
    vevent.updatePropertyWithValue("summary", updates.summary);
  }

  // Update start time
  if (updates.start !== undefined) {
    const startTime = ICAL.Time.fromJSDate(updates.start, false);
    if (updates.allDay) {
      startTime.isDate = true;
    }
    vevent.updatePropertyWithValue("dtstart", startTime);
  } else if (updates.allDay !== undefined) {
    // Just changing allDay flag without changing the time
    const dtstart = vevent.getFirstProperty("dtstart");
    if (dtstart) {
      // ical.js returns Time but types are incomplete
      const currentTime = dtstart.getFirstValue() as any;
      if (currentTime) {
        currentTime.isDate = updates.allDay;
        dtstart.setValue(currentTime);
      }
    }
  }

  // Update end time
  if (updates.end !== undefined) {
    const endTime = ICAL.Time.fromJSDate(updates.end, false);
    if (updates.allDay) {
      endTime.isDate = true;
    }
    vevent.updatePropertyWithValue("dtend", endTime);
  }

  // Update location (empty string clears it)
  if (updates.location !== undefined) {
    if (updates.location === "") {
      vevent.removeProperty("location");
    } else {
      vevent.updatePropertyWithValue("location", updates.location);
    }
  }

  // Update description (empty string clears it)
  if (updates.description !== undefined) {
    if (updates.description === "") {
      vevent.removeProperty("description");
    } else {
      vevent.updatePropertyWithValue("description", updates.description);
    }
  }

  // Update status
  if (updates.status !== undefined) {
    if (updates.status === "") {
      vevent.removeProperty("status");
    } else {
      vevent.updatePropertyWithValue("status", updates.status.toUpperCase());
    }
  }

  // Update URL
  if (updates.url !== undefined) {
    if (updates.url === "") {
      vevent.removeProperty("url");
    } else {
      vevent.updatePropertyWithValue("url", updates.url);
    }
  }

  // Update categories
  if (updates.categories !== undefined) {
    vevent.removeProperty("categories");
    if (updates.categories.length > 0) {
      vevent.updatePropertyWithValue("categories", updates.categories.join(","));
    }
  }

  // Update priority
  if (updates.priority !== undefined) {
    if (updates.priority === null) {
      vevent.removeProperty("priority");
    } else if (updates.priority >= 1 && updates.priority <= 9) {
      vevent.updatePropertyWithValue("priority", updates.priority);
    }
  }

  // Update transparency
  if (updates.transparency !== undefined) {
    if (updates.transparency === "") {
      vevent.removeProperty("transp");
    } else {
      vevent.updatePropertyWithValue("transp", updates.transparency.toUpperCase());
    }
  }

  // Update organizer
  if (updates.organizer !== undefined) {
    vevent.removeProperty("organizer");
    const organizerProp = new ICAL.Property("organizer");
    organizerProp.setValue(`mailto:${updates.organizer.email}`);
    if (updates.organizer.name) {
      organizerProp.setParameter("cn", updates.organizer.name);
    }
    vevent.addProperty(organizerProp);
  }

  // Update attendees
  if (updates.attendees !== undefined) {
    // Remove all existing attendees
    vevent.removeAllProperties("attendee");
    // Add new attendees
    for (const attendee of updates.attendees) {
      const attendeeProp = new ICAL.Property("attendee");
      attendeeProp.setValue(`mailto:${attendee.email}`);
      if (attendee.name) {
        attendeeProp.setParameter("cn", attendee.name);
      }
      attendeeProp.setParameter("rsvp", attendee.rsvp !== false ? "TRUE" : "FALSE");
      attendeeProp.setParameter("partstat", "NEEDS-ACTION");
      if (attendee.role) {
        attendeeProp.setParameter("role", roleToICalRole(attendee.role));
      }
      vevent.addProperty(attendeeProp);
    }
  }

  // Update reminders
  if (updates.reminders !== undefined) {
    // Remove all existing alarms
    const alarms = vevent.getAllSubcomponents("valarm");
    for (const alarm of alarms) {
      vevent.removeSubcomponent(alarm);
    }
    // Add new reminders
    const summary = vevent.getFirstPropertyValue("summary") as string ?? "Event";
    for (const reminder of updates.reminders) {
      const valarm = new ICAL.Component("valarm");
      valarm.updatePropertyWithValue("action", (reminder.action ?? "display").toUpperCase());
      const triggerProp = new ICAL.Property("trigger");
      const duration = ICAL.Duration.fromString(reminderToDuration(reminder));
      triggerProp.setValue(duration);
      valarm.addProperty(triggerProp);
      if (!reminder.action || reminder.action === "display") {
        valarm.updatePropertyWithValue("description", summary);
      }
      vevent.addSubcomponent(valarm);
    }
  }

  // Update DTSTAMP to now (required for updates)
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());

  return vcalendar.toString();
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
    displayName: String(cal.displayName ?? "Unnamed"),
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
