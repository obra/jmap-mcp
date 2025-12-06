import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DAVClient, DAVCalendar } from "tsdav";

import {
  createCalendarClient,
  fetchCalendars,
  fetchCalendarEvents,
  formatCalendarAsCSV,
  formatCalendarEventAsCSV,
  createICalString,
  updateICalString,
  generateICalFilename,
  CalendarClientConfig,
} from "../calendar.js";
import { formatError, mcpResponse } from "../utils.js";

// =============================================================================
// Schemas
// =============================================================================

const CalendarsSchema = z.object({});

const EventsSchema = z.object({
  calendar: z.string().optional().describe(
    "Calendar URL, display name, or 'default' for primary calendar. If omitted, returns events from all calendars."
  ),
  query: z.string().optional().describe(
    "Search query to filter events by summary, location, or description"
  ),
  after: z.string().optional().describe(
    'Only events starting after this date (ISO 8601 or YYYY-MM-DD, e.g., "2024-12-01")'
  ),
  before: z.string().optional().describe(
    'Only events starting before this date (ISO 8601 or YYYY-MM-DD, e.g., "2024-12-31")'
  ),
  limit: z.number().min(1).max(100).default(50).describe(
    "Maximum events to return (default 50)"
  ),
});

const RecurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).describe(
    "How often the event repeats"
  ),
  interval: z.number().min(1).optional().describe(
    "Repeat every N days/weeks/months/years (default 1)"
  ),
  count: z.number().min(1).optional().describe(
    "Number of occurrences (mutually exclusive with 'until')"
  ),
  until: z.string().optional().describe(
    "End date for recurrence in ISO 8601 format (mutually exclusive with 'count')"
  ),
  byDay: z.array(z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"])).optional().describe(
    'Days of week for weekly recurrence, e.g., ["MO", "WE", "FR"]'
  ),
});

const AttendeeSchema = z.object({
  email: z.string().email().describe("Attendee's email address"),
  name: z.string().optional().describe("Attendee's display name"),
  rsvp: z.boolean().optional().describe("Request RSVP from attendee (default true)"),
  role: z.enum(["required", "optional", "chair"]).optional().describe(
    "Attendee's role: required (default), optional, or chair (for meeting leader)"
  ),
});

const OrganizerSchema = z.object({
  email: z.string().email().describe("Organizer's email address"),
  name: z.string().optional().describe("Organizer's display name"),
});

const ReminderSchema = z.object({
  minutes: z.number().min(0).optional().describe("Minutes before event (e.g., 15, 30)"),
  hours: z.number().min(0).optional().describe("Hours before event (e.g., 1, 2)"),
  days: z.number().min(0).optional().describe("Days before event (e.g., 1)"),
  action: z.enum(["display", "email"]).optional().describe("Reminder type: display (popup) or email"),
});

const CreateEventSchema = z.object({
  calendar: z.string().min(1).default("default").describe(
    "Calendar to add event to (URL, display name, or 'default' for primary calendar)"
  ),
  summary: z.string().min(1).describe(
    "Event title/summary"
  ),
  start: z.string().describe(
    'Start date/time. ISO 8601 format (e.g., "2024-12-04T10:00:00Z") or date only for all-day events ("2024-12-25")'
  ),
  end: z.string().optional().describe(
    'End date/time. Same format as start. Omit for instantaneous events or all-day events spanning one day.'
  ),
  allDay: z.boolean().optional().describe(
    "Set to true for all-day events (ignores time portion of start/end)"
  ),
  location: z.string().optional().describe(
    "Event location (e.g., conference room, address, video call URL)"
  ),
  description: z.string().optional().describe(
    "Event description/notes"
  ),
  recurrence: RecurrenceSchema.optional().describe(
    'Make this a recurring event. Example: {frequency: "weekly", byDay: ["MO", "WE", "FR"]}'
  ),
  // New fields for invitations and event properties
  attendees: z.array(AttendeeSchema).optional().describe(
    'List of attendees to invite. Fastmail sends email invitations automatically. Example: [{email: "bob@example.com", name: "Bob"}]'
  ),
  organizer: OrganizerSchema.optional().describe(
    "Event organizer (defaults to your account email). Invitations are sent from this address."
  ),
  status: z.enum(["confirmed", "tentative", "cancelled"]).optional().describe(
    "Event status: confirmed (default), tentative, or cancelled"
  ),
  url: z.string().url().optional().describe(
    "URL for the event (e.g., video meeting link like Zoom/Meet URL)"
  ),
  categories: z.array(z.string()).optional().describe(
    'Categories/tags for the event. Example: ["work", "meeting"]'
  ),
  priority: z.enum(["urgent", "high", "normal", "low"]).optional().describe(
    "Event priority: urgent, high, normal (default), or low"
  ),
  showAs: z.enum(["busy", "free"]).optional().describe(
    "Show as: busy (default, blocks time) or free (available)"
  ),
  reminders: z.array(ReminderSchema).optional().describe(
    'Reminders before event. Example: [{minutes: 15}, {hours: 1}, {days: 1}]'
  ),
});

const UpdateEventSchema = z.object({
  url: z.string().url().describe(
    "The full URL of the event to update (returned by 'events' tool or 'create_event')"
  ),
  summary: z.string().optional().describe(
    "New event title/summary"
  ),
  start: z.string().optional().describe(
    'New start date/time. ISO 8601 format (e.g., "2024-12-04T10:00:00Z")'
  ),
  end: z.string().optional().describe(
    'New end date/time. Same format as start.'
  ),
  allDay: z.boolean().optional().describe(
    "Set to true for all-day events"
  ),
  location: z.string().optional().describe(
    "New event location. Use empty string to clear."
  ),
  description: z.string().optional().describe(
    "New event description. Use empty string to clear."
  ),
  // New fields
  attendees: z.array(AttendeeSchema).optional().describe(
    'Update attendee list. Empty array removes all attendees. Example: [{email: "bob@example.com"}]'
  ),
  organizer: OrganizerSchema.optional().describe(
    "Update event organizer"
  ),
  status: z.enum(["confirmed", "tentative", "cancelled"]).or(z.literal("")).optional().describe(
    "Event status. Empty string clears status."
  ),
  eventUrl: z.string().optional().describe(
    "URL for event (meeting link). Use empty string to clear."
  ),
  categories: z.array(z.string()).optional().describe(
    "Categories/tags. Empty array clears categories."
  ),
  priority: z.enum(["urgent", "high", "normal", "low"]).nullable().optional().describe(
    "Event priority. Use null to clear."
  ),
  showAs: z.enum(["busy", "free"]).or(z.literal("")).optional().describe(
    "Show as busy/free. Empty string clears."
  ),
  reminders: z.array(ReminderSchema).optional().describe(
    "Update reminders. Empty array removes all reminders."
  ),
});

const DeleteEventSchema = z.object({
  url: z.string().url().describe(
    "The full URL of the event to delete (returned by 'events' tool or 'create_event')"
  ),
});

// =============================================================================
// Calendar Tools Registration
// =============================================================================

export function registerCalendarTools(
  server: McpServer,
  calendarClient: DAVClient | null,
  config: CalendarClientConfig | null,
): void {
  // Helper to ensure we have a client
  const getClient = async (): Promise<DAVClient> => {
    if (calendarClient) {
      return calendarClient;
    }
    if (!config) {
      throw new Error(
        "Calendar access not configured. Set FASTMAIL_USERNAME and FASTMAIL_PASSWORD (app password) environment variables."
      );
    }
    return await createCalendarClient(config);
  };

  // Cache of calendars for name resolution
  let calendarsCache: DAVCalendar[] | null = null;

  const getCalendars = async (client: DAVClient): Promise<DAVCalendar[]> => {
    if (!calendarsCache) {
      calendarsCache = await client.fetchCalendars();
    }
    return calendarsCache;
  };

  const resolveCalendar = async (
    client: DAVClient,
    nameOrUrl: string
  ): Promise<DAVCalendar | undefined> => {
    const calendars = await getCalendars(client);

    // Handle 'default' keyword - return first non-hidden calendar
    if (nameOrUrl.toLowerCase() === "default") {
      return calendars.find((c) => {
        const name = typeof c.displayName === "string" ? c.displayName : "";
        return !name.startsWith("_");
      }) || calendars[0];
    }

    // First try exact URL match
    const byUrl = calendars.find((c) => c.url === nameOrUrl);
    if (byUrl) return byUrl;
    // Then try display name match (case-insensitive)
    const byName = calendars.find((c) => {
      const name = typeof c.displayName === "string" ? c.displayName : "";
      return name.toLowerCase() === nameOrUrl.toLowerCase();
    });
    return byName;
  };

  // ---------------------------------------------------------------------------
  // calendars - List all calendars
  // ---------------------------------------------------------------------------

  server.tool(
    "calendars",
    `List calendars in the user's Fastmail account.

Returns: url, display_name, ctag, color, description
Use the URL or display_name when fetching events from a specific calendar.`,
    CalendarsSchema.shape,
    async () => {
      try {
        const client = await getClient();
        const calendarInfos = await fetchCalendars(client);
        return mcpResponse(formatCalendarAsCSV(calendarInfos));
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // events - List calendar events
  // ---------------------------------------------------------------------------

  server.tool(
    "events",
    `Get calendar events from Fastmail.

Returns: uid, url, summary, start, end, location, description, allDay
Filter by calendar, search query, or date range.`,
    EventsSchema.shape,
    async (args) => {
      try {
        const client = await getClient();
        const calendars = await getCalendars(client);

        // Determine which calendars to fetch from
        let targetCalendars: DAVCalendar[] = calendars;
        if (args.calendar) {
          const resolved = await resolveCalendar(client, args.calendar);
          if (!resolved) {
            const available = calendars.map((c) => c.displayName).join(", ");
            return mcpResponse(
              `Calendar not found: "${args.calendar}". Available: ${available}`,
              true
            );
          }
          targetCalendars = [resolved];
        }

        // Build time range if specified
        let timeRange: { start: Date; end: Date } | undefined;
        if (args.after || args.before) {
          const start = args.after ? new Date(args.after) : new Date("1970-01-01");
          const end = args.before ? new Date(args.before) : new Date("2100-01-01");
          timeRange = { start, end };
        }

        // Fetch events from all target calendars
        let allEvents = [];
        for (const calendar of targetCalendars) {
          const events = await fetchCalendarEvents(client, calendar, { timeRange });
          allEvents.push(...events);
        }

        // Apply search filter if provided
        if (args.query) {
          const lowerQuery = args.query.toLowerCase();
          allEvents = allEvents.filter((event) =>
            event.summary?.toLowerCase().includes(lowerQuery) ||
            event.location?.toLowerCase().includes(lowerQuery) ||
            event.description?.toLowerCase().includes(lowerQuery)
          );
        }

        // Sort by start date
        allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

        // Apply limit
        const limited = allEvents.slice(0, args.limit);

        return mcpResponse(formatCalendarEventAsCSV(limited));
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // create_event - Create a new calendar event
  // ---------------------------------------------------------------------------

  server.tool(
    "create_event",
    `Create a new calendar event.

Examples:
  create_event(calendar: "Personal", summary: "Team Meeting", start: "2024-12-04T10:00:00Z", end: "2024-12-04T11:00:00Z")
  create_event(summary: "Weekly Standup", start: "2024-12-04T09:00:00Z", recurrence: {frequency: "weekly", byDay: ["MO", "WE", "FR"]})
  create_event(summary: "Daily Check-in", start: "2024-12-04T10:00:00Z", recurrence: {frequency: "daily", count: 30})

Returns the created event's UID and URL on success.`,
    CreateEventSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Resolve calendar by name or URL
        const calendar = await resolveCalendar(client, args.calendar);
        if (!calendar) {
          const calendars = await getCalendars(client);
          const available = calendars.map((c) => c.displayName).join(", ");
          return mcpResponse(
            `Calendar not found: "${args.calendar}". Available: ${available}`,
            true
          );
        }

        // Parse dates
        const start = new Date(args.start);
        if (isNaN(start.getTime())) {
          return mcpResponse(`Invalid start date: "${args.start}"`, true);
        }

        let end: Date | undefined;
        if (args.end) {
          end = new Date(args.end);
          if (isNaN(end.getTime())) {
            return mcpResponse(`Invalid end date: "${args.end}"`, true);
          }
        }

        // Parse recurrence if provided
        let recurrence: {
          frequency: "daily" | "weekly" | "monthly" | "yearly";
          interval?: number;
          count?: number;
          until?: Date;
          byDay?: string[];
        } | undefined;

        if (args.recurrence) {
          recurrence = {
            frequency: args.recurrence.frequency,
            interval: args.recurrence.interval,
            count: args.recurrence.count,
            byDay: args.recurrence.byDay,
          };

          if (args.recurrence.until) {
            const untilDate = new Date(args.recurrence.until);
            if (isNaN(untilDate.getTime())) {
              return mcpResponse(`Invalid recurrence until date: "${args.recurrence.until}"`, true);
            }
            recurrence.until = untilDate;
          }
        }

        // Create iCal string with all fields
        const { icalString, uid } = createICalString({
          summary: args.summary,
          start,
          end,
          allDay: args.allDay,
          location: args.location,
          description: args.description,
          recurrence,
          // New fields
          attendees: args.attendees,
          organizer: args.organizer,
          status: args.status,
          url: args.url,
          categories: args.categories,
          priority: args.priority,
          showAs: args.showAs,
          reminders: args.reminders,
        });

        // Create the event via CalDAV
        const filename = generateICalFilename(uid);
        const response = await client.createCalendarObject({
          calendar,
          iCalString: icalString,
          filename,
        });

        if (!response.ok) {
          return mcpResponse(
            `Failed to create event: ${response.status} ${response.statusText}`,
            true
          );
        }

        // Construct the event URL
        const eventUrl = `${calendar.url}${filename}`;

        return mcpResponse(
          `Event created successfully.\nUID: ${uid}\nURL: ${eventUrl}`
        );
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // update_event - Update an existing calendar event
  // ---------------------------------------------------------------------------

  server.tool(
    "update_event",
    `Update an existing calendar event.

Example: update_event(url: "https://caldav.fastmail.com/.../event.ics", summary: "New Title", location: "Room B")

Only provide fields you want to change. Use empty string to clear location/description.`,
    UpdateEventSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Extract calendar URL from event URL (everything before the last path segment)
        const eventUrlParts = args.url.split("/");
        const calendarUrl = eventUrlParts.slice(0, -1).join("/") + "/";

        // Fetch the existing event
        const fetchResponse = await client.fetchCalendarObjects({
          calendar: { url: calendarUrl } as DAVCalendar,
          objectUrls: [args.url],
        });

        if (!fetchResponse || fetchResponse.length === 0) {
          return mcpResponse(
            `Event not found: "${args.url}"`,
            true
          );
        }

        const existingEvent = fetchResponse[0];
        if (!existingEvent.data) {
          return mcpResponse(
            `Event has no data: "${args.url}"`,
            true
          );
        }

        // Parse dates if provided
        let start: Date | undefined;
        if (args.start) {
          start = new Date(args.start);
          if (isNaN(start.getTime())) {
            return mcpResponse(`Invalid start date: "${args.start}"`, true);
          }
        }

        let end: Date | undefined;
        if (args.end) {
          end = new Date(args.end);
          if (isNaN(end.getTime())) {
            return mcpResponse(`Invalid end date: "${args.end}"`, true);
          }
        }

        // Update the iCal string with all fields
        const updatedICalString = updateICalString(existingEvent.data, {
          summary: args.summary,
          start,
          end,
          allDay: args.allDay,
          location: args.location,
          description: args.description,
          // New fields
          attendees: args.attendees,
          organizer: args.organizer,
          status: args.status as any,
          url: args.eventUrl,
          categories: args.categories,
          priority: args.priority,
          showAs: args.showAs as any,
          reminders: args.reminders,
        });

        // Update the event via CalDAV
        const response = await client.updateCalendarObject({
          calendarObject: {
            url: args.url,
            data: updatedICalString,
            etag: existingEvent.etag,
          },
        });

        if (!response.ok) {
          return mcpResponse(
            `Failed to update event: ${response.status} ${response.statusText}`,
            true
          );
        }

        return mcpResponse(`Event updated successfully.`);
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // delete_event - Delete a calendar event
  // ---------------------------------------------------------------------------

  server.tool(
    "delete_event",
    `Delete a calendar event by URL.

Get the event URL from the 'events' tool or 'create_event' response.

Example: delete_event(url: "https://caldav.fastmail.com/dav/calendars/.../event.ics")`,
    DeleteEventSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Delete requires a calendarObject with url and etag
        // We'll do a simple delete by URL without etag (may fail if event was modified)
        const response = await client.deleteObject({
          url: args.url,
        });

        if (!response.ok) {
          return mcpResponse(
            `Failed to delete event: ${response.status} ${response.statusText}`,
            true
          );
        }

        return mcpResponse(`Event deleted successfully.`);
      } catch (error) {
        return mcpResponse(formatError(error), true);
      }
    }
  );
}
