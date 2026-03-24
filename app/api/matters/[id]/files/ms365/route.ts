import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { importAllowedMs365File } from "@/lib/ms365/import";
import type { Ms365ImportSelection } from "@/lib/ms365/types";
import { MatterFile } from "@/lib/models/matter-file";
import type { StoredFileUploadResult } from "@/lib/files/types";
import {
  buildMatterFileSummary,
  findAccessibleMatterById,
  listMatterFilesForMatter,
  listStoredMatterFileNamesForMatter,
  serializeMatterFile,
} from "@/lib/matter-files/server";
import {
  buildStoredSessionFileName,
  deleteMatterFileFromDisk,
  deleteSessionFileFromRelativePath,
  saveMatterFileToDisk,
} from "@/lib/session-files/storage";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function buildChecksumSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseSelections(value: unknown): Array<Ms365ImportSelection> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as Ms365ImportSelection).locationId !== "string" ||
      typeof (entry as Ms365ImportSelection).driveId !== "string" ||
      typeof (entry as Ms365ImportSelection).itemId !== "string"
    ) {
      return [];
    }

    const locationId = (entry as Ms365ImportSelection).locationId.trim();
    const driveId = (entry as Ms365ImportSelection).driveId.trim();
    const itemId = (entry as Ms365ImportSelection).itemId.trim();

    if (!locationId || !driveId || !itemId) {
      return [];
    }

    return [{ locationId, driveId, itemId }];
  });
}

export async function POST(req: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await connectDB();

  const matter = await findAccessibleMatterById(id, user.id, user.organisationId);
  if (!matter) {
    return NextResponse.json({ error: "Matter not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { files?: unknown } | null;
  const selections = parseSelections(body?.files);

  if (selections.length === 0) {
    return NextResponse.json(
      { error: "At least one Microsoft 365 file is required" },
      { status: 400 }
    );
  }

  const existingStoredNames = await listStoredMatterFileNamesForMatter(matter._id);
  const reservedStoredNames = new Set(existingStoredNames);
  const createdFileIds: string[] = [];
  const writtenFiles: Array<{ relativePath: string }> = [];
  const uploadResults: Array<StoredFileUploadResult> = [];

  try {
    for (const [index, selection] of selections.entries()) {
      const importedFile = await importAllowedMs365File({
        organisationId: user.organisationId,
        selection,
      });
      const checksumSha256 = buildChecksumSha256(importedFile.bytes);
      const existingDuplicate = await MatterFile.findOne({
        matterId: matter._id,
        checksumSha256,
      })
        .select({
          fileId: 1,
          originalName: 1,
          source: 1,
          ms365LocationId: 1,
          ms365DriveId: 1,
          ms365ItemId: 1,
          ms365WebUrl: 1,
          mime: 1,
          size: 1,
          createdAt: 1,
        })
        .lean();

      if (existingDuplicate) {
        uploadResults.push({
          index,
          status: "duplicate",
          file: serializeMatterFile(existingDuplicate),
        });
        continue;
      }

      const fileId = `mf_${randomUUID().replace(/-/g, "")}`;
      let didPersistOrSkip = false;

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const storedName = buildStoredSessionFileName(
          importedFile.originalName,
          reservedStoredNames
        );
        const { relativePath } = await saveMatterFileToDisk(
          user.organisationName,
          matter.code,
          storedName,
          importedFile.bytes
        );

        try {
          const created = await MatterFile.create({
            organisationId: matter.organisationId,
            matterId: matter._id,
            fileId,
            originalName: importedFile.originalName,
            source: "ms365",
            ms365LocationId: importedFile.ms365LocationId,
            ms365DriveId: importedFile.ms365DriveId,
            ms365ItemId: importedFile.ms365ItemId,
            ms365WebUrl: importedFile.webUrl,
            storedName,
            relativePath,
            checksumSha256,
            mime: importedFile.mime,
            size: importedFile.size,
            createdByUserId: user.id,
          });

          reservedStoredNames.add(storedName);
          writtenFiles.push({ relativePath });
          createdFileIds.push(fileId);
          uploadResults.push({
            index,
            status: "uploaded",
            file: serializeMatterFile(created.toObject()),
          });
          didPersistOrSkip = true;
          break;
        } catch (error) {
          await deleteMatterFileFromDisk(user.organisationName, matter.code, storedName);

          if ((error as { code?: number } | undefined)?.code === 11000) {
            const duplicateAfterRace = await MatterFile.findOne({
              matterId: matter._id,
              checksumSha256,
            })
              .select({
                fileId: 1,
                originalName: 1,
                source: 1,
                ms365LocationId: 1,
                ms365DriveId: 1,
                ms365ItemId: 1,
                ms365WebUrl: 1,
                mime: 1,
                size: 1,
                createdAt: 1,
              })
              .lean();

            if (duplicateAfterRace) {
              uploadResults.push({
                index,
                status: "duplicate",
                file: serializeMatterFile(duplicateAfterRace),
              });
              didPersistOrSkip = true;
              break;
            }

            reservedStoredNames.add(storedName);
            continue;
          }

          throw error;
        }
      }

      if (!didPersistOrSkip) {
        throw new Error(
          `Failed to allocate a stored filename for ${importedFile.originalName}`
        );
      }
    }

    const files = await listMatterFilesForMatter(id, user.organisationId);

    return NextResponse.json(
      {
        files: files.map(serializeMatterFile),
        summary: buildMatterFileSummary(files),
        uploadResults,
      },
      { status: 201 }
    );
  } catch (error) {
    if (createdFileIds.length > 0) {
      await MatterFile.deleteMany({ fileId: { $in: createdFileIds } });
    }

    for (const writtenFile of writtenFiles) {
      await deleteSessionFileFromRelativePath(writtenFile.relativePath);
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload Microsoft 365 matter files",
      },
      { status: 500 }
    );
  }
}
