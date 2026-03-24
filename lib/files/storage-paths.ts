export function sanitizeStoragePathSegment(value: string) {
  const normalized = value.normalize("NFKC").trim();
  const withoutSeparators = normalized.replace(/[\\/]/g, "-");
  const collapsedWhitespace = withoutSeparators.replace(/\s+/g, " ");
  const safe = collapsedWhitespace.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const trimmed = safe.replace(/^\.+/, "").slice(0, 180).trim();
  return trimmed || "item";
}

export function getOrganisationFolderName(organisationName: string) {
  return sanitizeStoragePathSegment(organisationName) || "organisation";
}

export function getMatterFolderName(matterCode: string) {
  return sanitizeStoragePathSegment(matterCode) || "matter";
}

export function buildSessionLibraryRelativePath(
  organisationName: string,
  rawSessionId: string
) {
  return [getOrganisationFolderName(organisationName), "session-files", rawSessionId]
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0)
    .join("/");
}

export function buildMatterLibraryRelativePath(organisationName: string, matterCode: string) {
  return [
    getOrganisationFolderName(organisationName),
    "matter-files",
    getMatterFolderName(matterCode),
  ]
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0)
    .join("/");
}
