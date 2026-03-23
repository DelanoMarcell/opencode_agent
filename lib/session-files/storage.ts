import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const WORKSPACE_STORAGE_ROOT_SEGMENTS = [".agent"] as const;

function sanitizeSegment(value: string) {
  const normalized = value.normalize("NFKC").trim();
  const withoutSeparators = normalized.replace(/[\\/]/g, "-");
  const collapsedWhitespace = withoutSeparators.replace(/\s+/g, " ");
  const safe = collapsedWhitespace.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const trimmed = safe.replace(/^\.+/, "").slice(0, 180).trim();
  return trimmed || "item";
}

function sanitizeFileName(name: string) {
  const trimmed = sanitizeSegment(name);
  return trimmed || "file";
}

function splitSafeFileName(name: string) {
  const safeName = sanitizeFileName(name);
  const parsed = path.parse(safeName);
  const extension = parsed.ext.slice(0, 20);
  const baseName = (parsed.name || "file").slice(0, 140).trim() || "file";

  return {
    baseName,
    extension,
  };
}

export function getSessionFilesRoot() {
  return path.join(process.cwd(), getWorkspaceStorageRootRelativePath());
}

export function getWorkspaceStorageRootRelativePath() {
  return path.posix.join(...WORKSPACE_STORAGE_ROOT_SEGMENTS);
}

export function toWorkspaceRelativeStoragePath(storageRelativePath: string) {
  return path.posix.join(getWorkspaceStorageRootRelativePath(), storageRelativePath);
}

export function toModelRelativeStoragePath(storageRelativePath: string) {
  return storageRelativePath;
}

export function getOrganisationFolderName(organisationName: string) {
  return sanitizeSegment(organisationName) || "organisation";
}

export function getMatterFolderName(matterCode: string) {
  return sanitizeSegment(matterCode) || "matter";
}

export function getSessionFolderPath(organisationName: string, rawSessionId: string) {
  return path.join(
    getSessionFilesRoot(),
    getOrganisationFolderName(organisationName),
    "session-files",
    rawSessionId
  );
}

export function getMatterFolderPath(organisationName: string, matterCode: string) {
  return path.join(
    getSessionFilesRoot(),
    getOrganisationFolderName(organisationName),
    "matter-files",
    getMatterFolderName(matterCode)
  );
}

export function buildStoredSessionFileName(
  originalName: string,
  existingNames: Iterable<string> = []
) {
  const { baseName, extension } = splitSafeFileName(originalName);
  const seen = new Set(Array.from(existingNames, (name) => name.toLowerCase()));
  const primaryCandidate = `${baseName}${extension}`;

  if (!seen.has(primaryCandidate.toLowerCase())) {
    return primaryCandidate;
  }

  for (let index = 1; index < 10_000; index += 1) {
    const nextCandidate = `${baseName} (${index})${extension}`;
    if (!seen.has(nextCandidate.toLowerCase())) {
      return nextCandidate;
    }
  }

  return `${baseName} (${Date.now()})${extension}`;
}

export async function saveSessionFileToDisk(
  organisationName: string,
  rawSessionId: string,
  storedName: string,
  bytes: Uint8Array
) {
  const organisationFolderName = getOrganisationFolderName(organisationName);
  const sessionFolderPath = getSessionFolderPath(organisationName, rawSessionId);
  await mkdir(sessionFolderPath, { recursive: true });

  const absolutePath = path.join(sessionFolderPath, storedName);
  await writeFile(absolutePath, bytes);

  return {
    absolutePath,
    relativePath: path.posix.join(organisationFolderName, "session-files", rawSessionId, storedName),
  };
}

export async function saveMatterFileToDisk(
  organisationName: string,
  matterCode: string,
  storedName: string,
  bytes: Uint8Array
) {
  const organisationFolderName = getOrganisationFolderName(organisationName);
  const matterFolderName = getMatterFolderName(matterCode);
  const matterFolderPath = getMatterFolderPath(organisationName, matterCode);
  await mkdir(matterFolderPath, { recursive: true });

  const absolutePath = path.join(matterFolderPath, storedName);
  await writeFile(absolutePath, bytes);

  return {
    absolutePath,
    relativePath: path.posix.join(organisationFolderName, "matter-files", matterFolderName, storedName),
  };
}

function getAbsolutePathFromRelativePath(relativePath: string) {
  const storageRoot = getSessionFilesRoot();
  const normalizedRelativePath = path.normalize(relativePath);
  const absolutePath = path.resolve(storageRoot, normalizedRelativePath);
  const relativeToRoot = path.relative(storageRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Session file path escapes the configured storage root");
  }

  return absolutePath;
}

export async function deleteSessionFileFromDisk(
  organisationName: string,
  rawSessionId: string,
  storedName: string
) {
  const absolutePath = path.join(getSessionFolderPath(organisationName, rawSessionId), storedName);

  try {
    await unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function deleteMatterFileFromDisk(
  organisationName: string,
  matterCode: string,
  storedName: string
) {
  const absolutePath = path.join(getMatterFolderPath(organisationName, matterCode), storedName);

  try {
    await unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function deleteSessionFileFromRelativePath(relativePath: string) {
  const absolutePath = getAbsolutePathFromRelativePath(relativePath);

  try {
    await unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      throw error;
    }
  }
}
