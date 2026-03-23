import { getAllowedMs365LocationById } from "@/lib/ms365/allowed-locations";
import { ms365GraphGet, Ms365GraphError } from "@/lib/ms365/graph";
import type { Ms365ImportSelection } from "@/lib/ms365/types";

type GraphDrive = {
  id: string;
  name?: string;
  webUrl?: string;
};

type GraphDriveItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  folder?: Record<string, unknown>;
  file?: {
    mimeType?: string;
  };
  parentReference?: {
    driveId?: string;
    id?: string;
    path?: string;
  };
  "@microsoft.graph.downloadUrl"?: string;
};

type ResolvedLocation = {
  id: string;
  driveId: string;
  rootItemId: string;
  rootPathPrefix: string;
};

function normalizeRootPathPrefix(item: GraphDriveItem, driveId: string) {
  const parentPath = item.parentReference?.path;
  if (!parentPath) {
    return `/drives/${driveId}/root:`;
  }
  return `${parentPath}/${item.name}`;
}

async function resolveLocation(
  organisationId: string,
  locationId: string
): Promise<ResolvedLocation> {
  const baseLocation = await getAllowedMs365LocationById(organisationId, locationId);
  if (!baseLocation) {
    throw new Error("Unknown Microsoft 365 location.");
  }

  const drive =
    baseLocation.driveId !== undefined
      ? ({
          id: baseLocation.driveId,
          name: undefined,
          webUrl: baseLocation.webUrl,
        } satisfies GraphDrive)
      : await ms365GraphGet<GraphDrive>(
          `/sites/${encodeURIComponent(baseLocation.siteId)}/drive`,
          { $select: "id,name,webUrl" }
        );

  const rootItemId = baseLocation.rootItemId ?? "root";
  if (rootItemId === "root") {
    return {
      id: baseLocation.id,
      driveId: drive.id,
      rootItemId,
      rootPathPrefix: `/drives/${drive.id}/root:`,
    };
  }

  const rootItem = await ms365GraphGet<GraphDriveItem>(
    `/drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(rootItemId)}`,
    {
      $select: "id,name,parentReference",
    }
  );

  return {
    id: baseLocation.id,
    driveId: drive.id,
    rootItemId,
    rootPathPrefix: normalizeRootPathPrefix(rootItem, drive.id),
  };
}

function isItemWithinLocation(
  location: ResolvedLocation,
  itemId: string,
  item: GraphDriveItem
): boolean {
  const itemDriveId = item.parentReference?.driveId ?? location.driveId;
  if (itemDriveId !== location.driveId) {
    return false;
  }

  if (location.rootItemId === "root") {
    return true;
  }

  if (itemId === location.rootItemId || item.id === location.rootItemId) {
    return true;
  }

  const parentPath = item.parentReference?.path;
  if (!parentPath) {
    return false;
  }

  return (
    parentPath === location.rootPathPrefix ||
    parentPath.startsWith(`${location.rootPathPrefix}/`)
  );
}

async function getDriveItemWithDownloadUrl(driveId: string, itemId: string) {
  return ms365GraphGet<GraphDriveItem>(
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`
  );
}

export async function importAllowedMs365File(args: {
  organisationId: string;
  selection: Ms365ImportSelection;
}) {
  const location = await resolveLocation(args.organisationId, args.selection.locationId);

  if (location.driveId !== args.selection.driveId) {
    throw new Error("Selected Microsoft 365 file does not match the allowed location drive.");
  }

  const item = await getDriveItemWithDownloadUrl(args.selection.driveId, args.selection.itemId);

  if (!isItemWithinLocation(location, args.selection.itemId, item)) {
    throw new Error("Selected Microsoft 365 file is outside the allowed location scope.");
  }

  if (!item.file || item.folder) {
    throw new Error("Only files can be uploaded from Microsoft 365.");
  }

  const downloadUrl = item["@microsoft.graph.downloadUrl"];
  if (!downloadUrl) {
    throw new Error("Microsoft 365 did not return a temporary download URL for this file.");
  }

  const downloadResponse = await fetch(downloadUrl, {
    cache: "no-store",
  });

  if (!downloadResponse.ok) {
    throw new Ms365GraphError(
      downloadResponse.status,
      `Failed to download Microsoft 365 file: ${item.name}`
    );
  }

  const bytes = new Uint8Array(await downloadResponse.arrayBuffer());

  return {
    bytes,
    originalName: item.name,
    size: item.size ?? bytes.byteLength,
    mime: item.file?.mimeType ?? undefined,
    webUrl: item.webUrl ?? undefined,
    ms365LocationId: args.selection.locationId,
    ms365DriveId: args.selection.driveId,
    ms365ItemId: args.selection.itemId,
  };
}
