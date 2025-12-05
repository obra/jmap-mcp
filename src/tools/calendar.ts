import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DAVClient, DAVCalendar } from "tsdav";

import {
  createCalendarClient,
  fetchCalendars,
  fetchCalendarEvents,
  formatCalendarAsCSV,
  formatCalendarEventAsCSV,
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
}
