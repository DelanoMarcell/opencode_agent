import { z } from "zod";
import { graphGet, toText } from "../graph.js";

export const fileTools = {
  graph_list_sites: {
    description:
      "List SharePoint sites in the organisation. Optionally search by keyword.",
    schema: {
      search: z
        .string()
        .default("*")
        .describe(
          'Search keyword for site names. Use "*" to list all accessible sites.'
        ),
      top: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(20)
        .describe("Number of sites to return"),
    },
    handler: async (args: { search?: string; top?: number }) => {
      const params: Record<string, string> = {
        search: args.search ?? "*",
        $top: String(args.top ?? 20),
        $select: "id,name,displayName,webUrl,description,createdDateTime",
      };

      const data = await graphGet("/sites", params);
      return toText(data);
    },
  },

  graph_get_site: {
    description:
      'Get a specific SharePoint site by its site ID (e.g. "contoso.sharepoint.com,siteId,webId") or use the hostname path format.',
    schema: {
      siteId: z
        .string()
        .min(1)
        .describe(
          'Site ID (GUID format "hostname,siteId,webId") or "root" for the root site'
        ),
    },
    handler: async (args: { siteId: string }) => {
      const data = await graphGet(
        `/sites/${encodeURIComponent(args.siteId)}`,
        { $select: "id,name,displayName,webUrl,description,createdDateTime,siteCollection" }
      );
      return toText(data);
    },
  },

  graph_list_drive_items: {
    description:
      "List items (files and folders) inside a SharePoint site drive or OneDrive. Provide siteId to browse a SharePoint site root. Provide driveId + itemId to browse a specific folder.",
    schema: {
      siteId: z
        .string()
        .optional()
        .describe("SharePoint site ID – browse the default document library"),
      driveId: z
        .string()
        .optional()
        .describe("Drive ID (use graph_list_drives to discover)"),
      itemId: z
        .string()
        .default("root")
        .describe("Folder item ID, defaults to 'root'"),
      top: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(50)
        .describe("Number of items to return"),
    },
    handler: async (args: {
      siteId?: string;
      driveId?: string;
      itemId?: string;
      top?: number;
    }) => {
      let path: string;
      const itemId = args.itemId ?? "root";

      if (args.driveId) {
        path = `/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(itemId)}/children`;
      } else if (args.siteId) {
        path = `/sites/${encodeURIComponent(args.siteId)}/drive/items/${encodeURIComponent(itemId)}/children`;
      } else {
        throw new Error("Either siteId or driveId must be provided.");
      }

      const params: Record<string, string> = {
        $top: String(args.top ?? 50),
        $select:
          "id,name,size,file,folder,webUrl,createdDateTime,lastModifiedDateTime,createdBy,lastModifiedBy",
        $orderby: "name asc",
      };

      const data = await graphGet(path, params);
      return toText(data);
    },
  },

  graph_get_drive_item: {
    description:
      "Get metadata for a specific file or folder by drive ID and item ID.",
    schema: {
      driveId: z.string().min(1).describe("Drive ID"),
      itemId: z.string().min(1).describe("Item ID"),
    },
    handler: async (args: { driveId: string; itemId: string }) => {
      const data = await graphGet(
        `/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.itemId)}`,
        {
          $select:
            "id,name,size,file,folder,webUrl,createdDateTime,lastModifiedDateTime,createdBy,lastModifiedBy,parentReference",
        }
      );
      return toText(data);
    },
  },

  graph_list_drives: {
    description:
      "List all drives (document libraries) in a SharePoint site.",
    schema: {
      siteId: z.string().min(1).describe("SharePoint site ID"),
    },
    handler: async (args: { siteId: string }) => {
      const data = await graphGet(
        `/sites/${encodeURIComponent(args.siteId)}/drives`,
        { $select: "id,name,driveType,webUrl,quota" }
      );
      return toText(data);
    },
  },

  graph_get_file_download_url: {
    description:
      "Get a temporary download URL for a file. The URL can be used to download or read the file content. Works for any file type including Office documents, PDFs, and text files.",
    schema: {
      driveId: z.string().min(1).describe("Drive ID"),
      itemId: z.string().min(1).describe("Item ID of the file"),
    },
    handler: async (args: { driveId: string; itemId: string }) => {
      // @microsoft.graph.downloadUrl is an OData annotation — it is returned by
      // default but is excluded when $select is used, so we omit $select here.
      const data = await graphGet(
        `/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.itemId)}`
      ) as Record<string, unknown>;
      const result = {
        id: data["id"],
        name: data["name"],
        size: data["size"],
        webUrl: data["webUrl"],
        downloadUrl: data["@microsoft.graph.downloadUrl"] ?? null,
      };
      return toText(result);
    },
  },

  graph_search_drive_items: {
    description:
      "Search for files/folders by name or content within a drive or SharePoint site.",
    schema: {
      query: z.string().min(1).describe("Search query string"), 
      siteId: z
        .string()
        .optional()
        .describe("Scope search to a specific SharePoint site"),
      driveId: z
        .string()
        .optional()
        .describe("Scope search to a specific drive"),
      top: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of results to return"),
    },
    handler: async (args: {
      query: string;
      siteId?: string;
      driveId?: string;
      top?: number;
    }) => {
      let path: string;
      if (args.driveId) {
        path = `/drives/${encodeURIComponent(args.driveId)}/root/search(q='${encodeURIComponent(args.query)}')`;
      } else if (args.siteId) {
        path = `/sites/${encodeURIComponent(args.siteId)}/drive/root/search(q='${encodeURIComponent(args.query)}')`;
      } else {
        throw new Error("Either siteId or driveId must be provided.");
      }

      const params: Record<string, string> = {
        $top: String(args.top ?? 20),
        $select:
          "id,name,size,file,folder,webUrl,createdDateTime,lastModifiedDateTime,parentReference",
      };

      const data = await graphGet(path, params);
      return toText(data);
    },
  },
};




