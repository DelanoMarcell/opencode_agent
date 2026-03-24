import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { importAllowedMs365File } from "@/lib/ms365/import";
import type { Ms365ImportSelection } from "@/lib/ms365/types";
import { SessionFile } from "@/lib/models/session-file";
import type { SessionFileUploadResult } from "@/lib/session-files/types";
import {
  buildSessionFileSummary,
  findAccessibleSessionRecordByRawSessionId,
  listSessionFilesForSession,
  listStoredSessionFileNamesForSession,
  serializeSessionFile,
} from "@/lib/session-files/server";
import {
  buildStoredSessionFileName,
  deleteSessionFileFromDisk,
  deleteSessionFileFromRelativePath,
  saveSessionFileToDisk,
} from "@/lib/session-files/storage";

type RouteContext = {
  params: Promise<{
    sessionId: string;
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

  const { sessionId } = await params;
  await connectDB();

  const sessionRecord = await findAccessibleSessionRecordByRawSessionId(
    sessionId,
    user.organisationId
  );
  if (!sessionRecord) {
    return NextResponse.json({ error: "Session record not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { files?: unknown } | null;
  const selections = parseSelections(body?.files);

  if (selections.length === 0) {
    return NextResponse.json(
      { error: "At least one Microsoft 365 file is required" },
      { status: 400 }
    );
  }

  const existingStoredNames = await listStoredSessionFileNamesForSession(sessionRecord._id);
  const reservedStoredNames = new Set(existingStoredNames);
  const createdFileIds: string[] = [];
  const writtenFiles: Array<{ relativePath: string }> = [];
  const uploadResults: Array<SessionFileUploadResult> = [];

  try {
    for (const [index, selection] of selections.entries()) {
      const importedFile = await importAllowedMs365File({
        organisationId: user.organisationId,
        selection,
      });
      const checksumSha256 = buildChecksumSha256(importedFile.bytes);
      const existingDuplicate = await SessionFile.findOne({
        opencodeSessionId: sessionRecord._id,
        checksumSha256,
      })
        .select({
          fileId: 1,
          rawSessionId: 1,
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
          file: serializeSessionFile(existingDuplicate),
        });
        continue;
      }

      const fileId = `sf_${randomUUID().replace(/-/g, "")}`;
      let didPersistOrSkip = false;

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const storedName = buildStoredSessionFileName(
          importedFile.originalName,
          reservedStoredNames
        );
        const { relativePath } = await saveSessionFileToDisk(
          user.organisationName,
          sessionId,
          storedName,
          importedFile.bytes
        );

        try {
          const created = await SessionFile.create({
            organisationId: sessionRecord.organisationId,
            opencodeSessionId: sessionRecord._id,
            rawSessionId: sessionId,
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
            file: serializeSessionFile(created.toObject()),
          });
          didPersistOrSkip = true;
          break;
        } catch (error) {
          await deleteSessionFileFromDisk(user.organisationName, sessionId, storedName);

          if ((error as { code?: number } | undefined)?.code === 11000) {
            const duplicateAfterRace = await SessionFile.findOne({
              opencodeSessionId: sessionRecord._id,
              checksumSha256,
            })
              .select({
                fileId: 1,
                rawSessionId: 1,
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
                file: serializeSessionFile(duplicateAfterRace),
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

    const files = await listSessionFilesForSession(sessionId, user.organisationId);

    return NextResponse.json(
      {
        files: files.map(serializeSessionFile),
        summary: buildSessionFileSummary(files),
        uploadResults,
      },
      { status: 201 }
    );
  } catch (error) {
    if (createdFileIds.length > 0) {
      await SessionFile.deleteMany({ fileId: { $in: createdFileIds } });
    }

    for (const writtenFile of writtenFiles) {
      await deleteSessionFileFromRelativePath(writtenFile.relativePath);
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload Microsoft 365 session files",
      },
      { status: 500 }
    );
  }
}
