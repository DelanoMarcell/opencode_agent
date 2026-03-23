import mongoose from "mongoose";

import { OpencodeSession } from "@/lib/models/opencode-session";
import { SessionFile } from "@/lib/models/session-file";
import type { SessionFileListItem, SessionFileSummary } from "@/lib/session-files/types";

type SerializableSessionFile = {
  fileId: string;
  rawSessionId: string;
  originalName: string;
  source?: "device" | "ms365";
  ms365LocationId?: string | null;
  ms365DriveId?: string | null;
  ms365ItemId?: string | null;
  ms365WebUrl?: string | null;
  mime?: string | null;
  size: number;
  createdAt: Date;
};

export function buildSessionFileSummary(files: Array<unknown>): SessionFileSummary {
  const fileCount = files.length;

  return {
    fileCount,
    hasFiles: fileCount > 0,
  };
}

export function serializeSessionFile(file: SerializableSessionFile): SessionFileListItem {
  return {
    fileId: file.fileId,
    rawSessionId: file.rawSessionId,
    originalName: file.originalName,
    source: file.source === "ms365" ? "ms365" : "device",
    ms365LocationId: file.ms365LocationId ?? undefined,
    ms365DriveId: file.ms365DriveId ?? undefined,
    ms365ItemId: file.ms365ItemId ?? undefined,
    ms365WebUrl: file.ms365WebUrl ?? undefined,
    mime: file.mime ?? undefined,
    size: file.size,
    createdAt: file.createdAt.toISOString(),
  };
}

export async function findAccessibleSessionRecordByRawSessionId(
  rawSessionId: string,
  organisationId: string
) {
  return OpencodeSession.findOne({
    sessionId: rawSessionId,
    organisationId: new mongoose.Types.ObjectId(organisationId),
  }).lean();
}

export async function listSessionFilesForSession(
  rawSessionId: string,
  organisationId: string
) {
  return SessionFile.find({
    rawSessionId,
    organisationId: new mongoose.Types.ObjectId(organisationId),
  })
    .sort({ createdAt: -1 })
    .lean();
}

export async function listStoredSessionFileNamesForSession(opencodeSessionId: mongoose.Types.ObjectId) {
  return SessionFile.find({
    opencodeSessionId,
  }).distinct("storedName");
}
