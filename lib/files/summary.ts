import type { StoredFileSummary } from "@/lib/files/types";

export function buildStoredFileSummary(files: Array<unknown>): StoredFileSummary {
  const fileCount = files.length;

  return {
    fileCount,
    hasFiles: fileCount > 0,
  };
}
