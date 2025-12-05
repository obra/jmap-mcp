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
    "Calendar URL or display name to fetch events from. If omitted, returns events from all calendars."
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

const CreateEventSchema = z.object({
  calendar: z.string().describe(
    "Calendar to add event to (URL or display name). Use 'calendars' tool to list available calendars."
  ),
  summary: z.string().describe(
    "Event title/summary"
  ),
  start: z.string().describe(
    'Start date/time. ISO 8601 format (e.g., "2024-12-04T10:00:00Z") or date only for all-day events ("2024-12-25")'
  ),
  end: z.string().optional().describe(
    'End date/time. Same format as start. Omit for instantaneous events or all-day events spanning one day.'
  ),
  all_day: z.boolean().optional().describe(
    "Set to true for all-day events (ignores time portion of start/end)"
  ),
  location: z.string().optional().describe(
    "Event location (e.g., conference room, address, video call URL)"
  ),
  description: z.string().optional().describe(
    "Event description/notes"
  ),
});

const UpdateEventSchema = z.object({
  url: z.string().describe(
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
  all_day: z.boolean().optional().describe(
    "Set to true for all-day events"
  ),
  location: z.string().optional().describe(
    "New event location. Use empty string to clear."
  ),
  description: z.string().optional().describe(
    "New event description. Use empty string to clear."
  ),
});

const DeleteEventSchema = z.object({
  url: z.string().describe(
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
    // First try exact URL match
    const byUrl = calendars.find((c) => c.url === nameOrUrl);
    if (byUrl) return byUrl;
    // Then try display name match (case-insensitive)
    const byName = calendars.find(
      (c) => c.displayName?.toLowerCase() === nameOrUrl.toLowerCase()
    );
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

Returns: uid, url, summary, start, end, location, description, all_day
Filter by calendar, date range, or get all events.`,
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
            return mcpResponse(
              `Calendar not found: "${args.calendar}". Use the 'calendars' tool to list available calendars.`,
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
        const allEvents = [];
        for (const calendar of targetCalendars) {
          const events = await fetchCalendarEvents(client, calendar, { timeRange });
          allEvents.push(...events);
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

Example: create_event(calendar: "Personal", summary: "Team Meeting", start: "2024-12-04T10:00:00Z", end: "2024-12-04T11:00:00Z", location: "Conference Room A")

Returns the created event's UID and URL on success.`,
    CreateEventSchema.shape,
    async (args) => {
      try {
        const client = await getClient();

        // Resolve calendar by name or URL
        const calendar = await resolveCalendar(client, args.calendar);
        if (!calendar) {
          return mcpResponse(
            `Calendar not found: "${args.calendar}". Use the 'calendars' tool to list available calendars.`,
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

        // Create iCal string
        const { icalString, uid } = createICalString({
          summary: args.summary,
          start,
          end,
          allDay: args.all_day,
          location: args.location,
          description: args.description,
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

        // Fetch the existing event
        const fetchResponse = await client.fetchCalendarObjects({
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

        // Update the iCal string
        const updatedICalString = updateICalString(existingEvent.data, {
          summary: args.summary,
          start,
          end,
          allDay: args.all_day,
          location: args.location,
          description: args.description,
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
