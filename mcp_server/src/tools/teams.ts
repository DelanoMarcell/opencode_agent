import { z } from "zod";
import { graphGet, toText } from "../graph.js";

export const teamTools = {
  graph_list_user_teams: {
    description:
      "List all Microsoft Teams that a user is a member of.",
    schema: {
      userId: z
        .string()
        .min(1)
        .describe("User ID (GUID) or userPrincipalName, e.g. john@contoso.com"),
    },
    handler: async (args: { userId: string }) => {
      const data = await graphGet(
        `/users/${encodeURIComponent(args.userId)}/joinedTeams`,
        { $select: "id,displayName,description,webUrl" }
      );
      return toText(data);
    },
  },

  graph_list_teams: {
    description:
      "List all Microsoft Teams in the organisation.",
    schema: {
      top: z
        .number()
        .int()
        .min(1)
        .max(999)
        .default(50)
        .describe("Number of teams to return"),
    },
    handler: async (args: { top?: number }) => {
      const data = await graphGet("/teams", {
        $top: String(args.top ?? 50),
        $select: "id,displayName,description,webUrl",
      });
      return toText(data);
    },
  },

  graph_list_channels: {
    description:
      "List all channels in a Microsoft Team.",
    schema: {
      teamId: z.string().min(1).describe("Team ID (GUID)"),
    },
    handler: async (args: { teamId: string }) => {
      const data = await graphGet(
        `/teams/${encodeURIComponent(args.teamId)}/channels`,
        { $select: "id,displayName,description,webUrl,membershipType" }
      );
      return toText(data);
    },
  },

  graph_list_channel_members: {
    description:
      "List members of a specific channel in a Microsoft Team.",
    schema: {
      teamId: z.string().min(1).describe("Team ID (GUID)"),
      channelId: z.string().min(1).describe("Channel ID"),
    },
    handler: async (args: { teamId: string; channelId: string }) => {
      const data = await graphGet(
        `/teams/${encodeURIComponent(args.teamId)}/channels/${encodeURIComponent(args.channelId)}/members`,
        { $select: "id,displayName,roles" }
      );
      return toText(data);
    },
  },

  graph_get_channel_files_folder: {
    description:
      "Get the SharePoint folder (driveId + itemId) that backs a Teams channel's Files tab. Use the returned driveId and itemId with graph_list_drive_items or graph_get_file_download_url.",
    schema: {
      teamId: z.string().min(1).describe("Team ID (GUID)"),
      channelId: z.string().min(1).describe("Channel ID"),
    },
    handler: async (args: { teamId: string; channelId: string }) => {
      const data = await graphGet(
        `/teams/${encodeURIComponent(args.teamId)}/channels/${encodeURIComponent(args.channelId)}/filesFolder`,
        { $select: "id,name,webUrl,parentReference" }
      ) as Record<string, unknown>;
      const parent = data["parentReference"] as Record<string, unknown> | undefined;
      const result = {
        itemId: data["id"],
        name: data["name"],
        webUrl: data["webUrl"],
        driveId: parent?.["driveId"] ?? null,
      };
      return toText(result);
    },
  },
};
