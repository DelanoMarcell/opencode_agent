import { getAllowedMs365Locations } from "@/lib/ms365/config";
import { ms365GraphGet } from "@/lib/ms365/graph";
import type { Ms365BrowserItem, Ms365LocationSummary } from "@/lib/ms365/types";

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
  file?: Record<string, unknown>;
  parentReference?: {
    driveId?: string;
    id?: string;
    path?: string;
  };
  lastModifiedDateTime?: string;
};

type ResolvedLocation = Ms365LocationSummary & {
  rootPathPrefix: string;
};

function normalizeRootPathPrefix(item: GraphDriveItem, driveId: string) {
  const parentPath = item.parentReference?.path;
  if (!parentPath) {
    return `/drives/${driveId}/root:`;
  }
  return `${parentPath}/${item.name}`;
}

async function resolveLocation(locationId: string): Promise<ResolvedLocation> {
  const baseLocation = getAllowedMs365Locations().find(
    (candidate) => candidate.id === locationId
  );
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
      label: baseLocation.label,
      siteId: baseLocation.siteId,
      driveId: drive.id,
      rootItemId,
      webUrl: baseLocation.webUrl ?? drive.webUrl,
      driveName: drive.name,
      rootName: "Root",
      rootPathPrefix: `/drives/${drive.id}/root:`,
    };
  }

  const rootItem = await ms365GraphGet<GraphDriveItem>(
    `/drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(rootItemId)}`,
    {
      $select: "id,name,webUrl,parentReference",
    }
  );

  return {
    id: baseLocation.id,
    label: baseLocation.label,
    siteId: baseLocation.siteId,
    driveId: drive.id,
    rootItemId,
    webUrl: baseLocation.webUrl ?? rootItem.webUrl ?? drive.webUrl,
    driveName: drive.name,
    rootName: rootItem.name,
    rootPathPrefix: normalizeRootPathPrefix(rootItem, drive.id),
  };
}

async function getItemMetadata(driveId: string, itemId: string): Promise<GraphDriveItem> {
  if (itemId === "root") {
    return ms365GraphGet<GraphDriveItem>(`/drives/${encodeURIComponent(driveId)}/root`, {
      $select: "id,name,webUrl,parentReference,folder,file,lastModifiedDateTime,size",
    });
  }

  return ms365GraphGet<GraphDriveItem>(
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
    {
      $select: "id,name,webUrl,parentReference,folder,file,lastModifiedDateTime,size",
    }
  );
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

function serializeBrowserItem(item: GraphDriveItem, driveId: string): Ms365BrowserItem {
  return {
    id: item.id,
    name: item.name,
    kind: item.folder ? "folder" : "file",
    size: item.size,
    webUrl: item.webUrl,
    driveId,
    parentItemId: item.parentReference?.id,
    lastModifiedDateTime: item.lastModifiedDateTime,
  };
}

export async function listAllowedMs365LocationSummaries(): Promise<
  Array<Ms365LocationSummary>
> {
  const locations = getAllowedMs365Locations();
  const resolvedLocations = await Promise.all(
    locations.map((location) => resolveLocation(location.id))
  );

  return resolvedLocations.map(({ rootPathPrefix: _rootPathPrefix, ...location }) => location);
}

export async function listMs365LocationChildren(args: {
  locationId: string;
  itemId?: string;
}) {
  const location = await resolveLocation(args.locationId);
  const requestedItemId = args.itemId?.trim() || location.rootItemId;
  const requestedItem = await getItemMetadata(location.driveId, requestedItemId);

  if (!isItemWithinLocation(location, requestedItemId, requestedItem)) {
    throw new Error("Requested item is outside the allowed Microsoft 365 scope.");
  }

  const path =
    requestedItemId === "root"
      ? `/drives/${encodeURIComponent(location.driveId)}/root/children`
      : `/drives/${encodeURIComponent(location.driveId)}/items/${encodeURIComponent(
          requestedItemId
        )}/children`;

  const result = await ms365GraphGet<{ value?: Array<GraphDriveItem> }>(path, {
    $top: "200",
    $select:
      "id,name,size,webUrl,file,folder,lastModifiedDateTime,parentReference",
  });

  const items = (result.value ?? [])
    .filter((item) => isItemWithinLocation(location, item.id, item))
    .sort((left, right) => {
      const leftRank = left.folder ? 0 : 1;
      const rightRank = right.folder ? 0 : 1;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.name.localeCompare(right.name);
    })
    .map((item) => serializeBrowserItem(item, location.driveId));

  const { rootPathPrefix: _rootPathPrefix, ...publicLocation } = location;

  return {
    location: publicLocation,
    currentFolder: serializeBrowserItem(requestedItem, location.driveId),
    items,
  };
}
