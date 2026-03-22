import mongoose from "mongoose";

import { buildStoredFileSummary } from "@/lib/files/summary";
import type { StoredFileListItem, StoredFileSummary } from "@/lib/files/types";
import { Matter } from "@/lib/models/matter";
import { MatterFile } from "@/lib/models/matter-file";
import { MatterMember } from "@/lib/models/matter-member";

type SerializableMatterFile = {
  fileId: string;
  originalName: string;
  mime?: string | null;
  size: number;
  createdAt: Date;
};

export function buildMatterFileSummary(files: Array<unknown>): StoredFileSummary {
  return buildStoredFileSummary(files);
}

export function serializeMatterFile(file: SerializableMatterFile): StoredFileListItem {
  return {
    fileId: file.fileId,
    originalName: file.originalName,
    mime: file.mime ?? undefined,
    size: file.size,
    createdAt: file.createdAt.toISOString(),
  };
}

export async function findAccessibleMatterById(
  matterId: string,
  userId: string,
  organisationId: string
) {
  const organisationObjectId = new mongoose.Types.ObjectId(organisationId);
  const [matter, membership] = await Promise.all([
    Matter.findOne({ _id: matterId, organisationId: organisationObjectId }).lean(),
    MatterMember.findOne({ matterId, userId }).lean(),
  ]);

  if (!matter || !membership) {
    return null;
  }

  return matter;
}

export async function listMatterFilesForMatter(matterId: string, organisationId: string) {
  return MatterFile.find({
    matterId: new mongoose.Types.ObjectId(matterId),
    organisationId: new mongoose.Types.ObjectId(organisationId),
  })
    .sort({ createdAt: -1 })
    .lean();
}

export async function listStoredMatterFileNamesForMatter(matterId: mongoose.Types.ObjectId) {
  return MatterFile.find({
    matterId,
  }).distinct("storedName");
}
