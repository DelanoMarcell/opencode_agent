import { z } from "zod";
import { graphGet, toText } from "../graph.js";
import { pbkdf2 } from "crypto";



export const userTools = {
  graph_list_users: {
    description:
      "List users in the organisation. Supports searching by displayName, mail, or userPrincipalName and pagination.",
    schema: {
      search: z
        .string()
        .optional()
        .describe(
          'Filter string, e.g. "displayName:John" or "mail:john@example.com"'
        ),
      top: z
        .number()
        .int()
        .min(1)
        .max(999)
        .default(25)
        .describe("Number of users to return (max 999)"),
      select: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to include, e.g. id,displayName,mail,jobTitle"
        ),
    },
    handler: async (args: {
      search?: string;
      top?: number;
      select?: string;
    }) => {
      const params: Record<string, string> = {
        $top: String(args.top ?? 25),
        $select:
          args.select ??
          "id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation",
      };
      if (args.search) {
        // Graph $search requires the value wrapped in double quotes
        params["$search"] = `"${args.search}"`;
      }

      const data = await graphGet(
        "/users",
        params,
        args.search ? { ConsistencyLevel: "eventual" } : undefined
      );
      return toText(data);
    },
  },

  graph_get_user: {
    description:
      "Get a specific user by their user ID (GUID) or userPrincipalName (UPN / email).",
    schema: {
      userId: z
        .string()
        .min(1)
        .describe("User ID (GUID) or userPrincipalName, e.g. john@contoso.com"),
      select: z
        .string()
        .optional()
        .describe("Comma-separated fields to include"),
    },
    handler: async (args: { userId: string; select?: string }) => {
      const params: Record<string, string> = {};
      if (args.select) params["$select"] = args.select;

      const data = await graphGet(`/users/${encodeURIComponent(args.userId)}`, params);
      return toText(data);
    },
  },
};
