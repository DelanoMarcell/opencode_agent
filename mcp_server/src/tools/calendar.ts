import { z } from "zod";
import { graphGet, toText } from "../graph.js";

export const calendarTools = {
  graph_list_calendar_events: {
    description:
      "List calendar events for a specific user. Use startDateTime and endDateTime to scope a time range (calendarView). Omit them to get recent/upcoming events.",
    schema: {
      userId: z
        .string()
        .min(1)
        .describe("User ID (GUID) or userPrincipalName"),
      startDateTime: z
        .string()
        .optional()
        .describe(
          "ISO 8601 start of the time range, e.g. 2024-01-01T00:00:00Z"
        ),
      endDateTime: z
        .string()
        .optional()
        .describe("ISO 8601 end of the time range, e.g. 2024-01-31T23:59:59Z"),
      top: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of events to return"),
      select: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields, e.g. id,subject,start,end,organizer,attendees"
        ),
    },
    handler: async (args: {
      userId: string;
      startDateTime?: string;
      endDateTime?: string;
      top?: number;
      select?: string;
    }) => {
      const encodedUser = encodeURIComponent(args.userId);
      const params: Record<string, string> = {
        $top: String(args.top ?? 20),
        $select:
          args.select ??
          "id,subject,start,end,organizer,attendees,location,bodyPreview,isAllDay",
        $orderby: "start/dateTime asc",
      };

      let path: string;
      if (args.startDateTime && args.endDateTime) {
        path = `/users/${encodedUser}/calendarView`;
        params["startDateTime"] = args.startDateTime;
        params["endDateTime"] = args.endDateTime;
      } else {
        path = `/users/${encodedUser}/events`;
      }

      const data = await graphGet(path, params);
      return toText(data);
    },
  },

  graph_get_calendar_event: {
    description: "Get a specific calendar event by its ID.",
    schema: {
      userId: z
        .string()
        .min(1)
        .describe("User ID (GUID) or userPrincipalName"),
      eventId: z.string().min(1).describe("The calendar event ID"),
      select: z
        .string()
        .optional()
        .describe("Comma-separated fields to include"),
    },
    handler: async (args: {
      userId: string;
      eventId: string;
      select?: string;
    }) => {
      const params: Record<string, string> = {};
      if (args.select) params["$select"] = args.select;

      const data = await graphGet(
        `/users/${encodeURIComponent(args.userId)}/events/${encodeURIComponent(args.eventId)}`,
        params
      );
      return toText(data);
    },
  },
};
