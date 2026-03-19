import { z } from "zod";
import { graphGet, toText } from "../graph.js";

export const mailTools = {
  graph_list_messages: {
    description:
      "List email messages in a user's mailbox. Supports filtering by folder, date range, sender, subject, and OData $filter expressions.",
    schema: {
      userId: z
        .string()
        .min(1)
        .describe("User ID (GUID) or userPrincipalName"),
      folder: z
        .string()
        .default("inbox")
        .describe(
          'Folder name or well-known folder: inbox, sentitems, drafts, deleteditems, or a folder ID'
        ),
      top: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of messages to return"),
      filter: z
        .string()
        .optional()
        .describe(
          "OData $filter expression, e.g. \"receivedDateTime ge 2024-01-01T00:00:00Z\""
        ),
      search: z
        .string()
        .optional()
        .describe(
          "Full-text search query against subject, body, sender, e.g. \"contract review\""
        ),
      select: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields, e.g. id,subject,from,receivedDateTime,bodyPreview"
        ),
      orderby: z
        .string()
        .default("receivedDateTime desc")
        .describe("OData $orderby, e.g. receivedDateTime desc"),
    },
    handler: async (args: {
      userId: string;
      folder?: string;
      top?: number;
      filter?: string;
      search?: string;
      select?: string;
      orderby?: string;
    }) => {
      const folder = args.folder ?? "inbox";
      const encodedUser = encodeURIComponent(args.userId);
      const path = `/users/${encodedUser}/mailFolders/${encodeURIComponent(folder)}/messages`;

      const params: Record<string, string> = {
        $top: String(args.top ?? 20),
        $select:
          args.select ??
          "id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,isRead",
        $orderby: args.orderby ?? "receivedDateTime desc",
      };
      if (args.filter) params["$filter"] = args.filter;
      if (args.search) params["$search"] = `"${args.search}"`;

      const data = await graphGet(path, params);
      return toText(data);
    },
  },

  graph_get_message: {
    description:
      "Get a specific email message by ID including full body content.",
    schema: {
      userId: z
        .string()
        .min(1)
        .describe("User ID (GUID) or userPrincipalName"),
      messageId: z.string().min(1).describe("The message ID"),
      select: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to include. Defaults to all key fields including body."
        ),
    },
    handler: async (args: {
      userId: string;
      messageId: string;
      select?: string;
    }) => {
      const params: Record<string, string> = {};
      if (args.select) {
        params["$select"] = args.select;
      }

      const data = await graphGet(
        `/users/${encodeURIComponent(args.userId)}/messages/${encodeURIComponent(args.messageId)}`,
        params
      );
      return toText(data);
    },
  },

  graph_list_mail_folders: {
    description: "List mail folders in a user's mailbox.",
    schema: {
      userId: z
        .string()
        .min(1)
        .describe("User ID (GUID) or userPrincipalName"),
      includeHidden: z
        .boolean()
        .default(false)
        .describe("Whether to include hidden folders"),
    },
    handler: async (args: { userId: string; includeHidden?: boolean }) => {
      const params: Record<string, string> = {
        $select: "id,displayName,totalItemCount,unreadItemCount",
      };
      if (args.includeHidden) params["includeHiddenFolders"] = "true";

      const data = await graphGet(
        `/users/${encodeURIComponent(args.userId)}/mailFolders`,
        params
      );
      return toText(data);
    },
  },
};
