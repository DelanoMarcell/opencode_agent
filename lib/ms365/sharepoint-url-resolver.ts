import { z } from "zod";

import { ms365GraphGet } from "@/lib/ms365/graph";

type GraphSite = {
  id: string;
  displayName?: string;
  webUrl?: string;
};

type GraphDrive = {
  id: string;
  name?: string;
  webUrl?: string;
};

type GraphDriveItem = {
  id: string;
  name: string;
  webUrl?: string;
};

const sharePointResolveInputSchema = z.object({
  url: z.string().trim().url(),
  label: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1).optional(),
});

function normalizePath(value: string) {
  return decodeURIComponent(value).replace(/\/+/g, "/");
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toSuggestedId(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "ms365-location";
}

function encodeGraphPath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseSharePointLocation(inputUrl: string) {
  const parsedUrl = new URL(inputUrl);
  const rawTargetPath = parsedUrl.searchParams.get("id") || parsedUrl.pathname;
  const targetPath = normalizePath(rawTargetPath);
  const segments = targetPath.split("/").filter(Boolean);

  if (segments.length < 3) {
    throw new Error("Could not determine SharePoint site and library from the URL.");
  }

  if (!["sites", "teams"].includes(segments[0] ?? "")) {
    throw new Error("Only /sites/... or /teams/... SharePoint URLs are supported.");
  }

  const sitePath = `/${segments.slice(0, 2).join("/")}`;
  const relativeAfterSite = segments.slice(2);
  if (relativeAfterSite.length === 0) {
    throw new Error("Could not determine the document library from the URL.");
  }

  return {
    hostname: parsedUrl.hostname,
    sitePath,
    libraryName: relativeAfterSite[0] ?? "",
    folderPath: relativeAfterSite.slice(1).join("/"),
    sourceUrl: inputUrl,
  };
}

function findDriveForLibrary(drives: Array<GraphDrive>, libraryName: string) {
  const normalizedLibraryName = normalizeName(libraryName);

  return (
    drives.find((drive) => normalizeName(drive.name ?? "") === normalizedLibraryName) ??
    drives.find((drive) => {
      const webUrl = drive.webUrl;
      if (!webUrl) {
        return false;
      }

      try {
        const pathname = normalizePath(new URL(webUrl).pathname);
        const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
        return normalizeName(lastSegment) === normalizedLibraryName;
      } catch {
        return false;
      }
    }) ??
    null
  );
}

export async function resolveSharePointUrlToAllowedLocation(input: unknown) {
  const parsedInput = sharePointResolveInputSchema.parse(input);
  const location = parseSharePointLocation(parsedInput.url);

  const site = await ms365GraphGet<GraphSite>(
    `/sites/${encodeURIComponent(location.hostname)}:${location.sitePath}`,
    {
      $select: "id,displayName,webUrl",
    }
  );

  const drives = await ms365GraphGet<{ value?: Array<GraphDrive> }>(
    `/sites/${encodeURIComponent(site.id)}/drives`,
    {
      $select: "id,name,webUrl",
    }
  );

  const drive = findDriveForLibrary(drives.value ?? [], location.libraryName);
  if (!drive) {
    throw new Error(
      `Could not match the SharePoint library "${location.libraryName}" to a Graph drive.`
    );
  }

  let rootItemId: string | undefined;
  let rootName = "Root";
  let resolvedWebUrl = drive.webUrl ?? site.webUrl ?? location.sourceUrl;

  if (location.folderPath) {
    const folder = await ms365GraphGet<GraphDriveItem>(
      `/drives/${encodeURIComponent(drive.id)}/root:/${encodeGraphPath(location.folderPath)}`,
      {
        $select: "id,name,webUrl",
      }
    );

    rootItemId = folder.id;
    rootName = folder.name;
    resolvedWebUrl = folder.webUrl ?? resolvedWebUrl;
  }

  const suggestedLabel =
    parsedInput.label ?? (location.folderPath ? rootName : site.displayName ?? location.libraryName);
  const suggestedId = parsedInput.id ?? toSuggestedId(suggestedLabel);
  const suggestedEntry = {
    id: suggestedId,
    label: suggestedLabel,
    siteId: site.id,
    driveId: drive.id,
    ...(rootItemId ? { rootItemId } : {}),
    webUrl: resolvedWebUrl,
  };

  return {
    parsed: {
      hostname: location.hostname,
      sitePath: location.sitePath,
      libraryName: location.libraryName,
      folderPath: location.folderPath || null,
    },
    resolved: {
      siteId: site.id,
      siteName: site.displayName ?? null,
      siteWebUrl: site.webUrl ?? null,
      driveId: drive.id,
      driveName: drive.name ?? null,
      driveWebUrl: drive.webUrl ?? null,
      rootItemId: rootItemId ?? null,
      rootName,
      webUrl: resolvedWebUrl,
    },
    suggestedEntry,
  };
}
