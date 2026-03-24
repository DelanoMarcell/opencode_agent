import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
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

function isUploadedFile(entry: FormDataEntryValue): entry is File {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "arrayBuffer" in entry &&
    "name" in entry &&
    "size" in entry &&
    typeof (entry as File).name === "string" &&
    typeof (entry as File).size === "number" &&
    (entry as File).size > 0
  );
}

function buildChecksumSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function GET(_: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  await connectDB();

  const sessionRecord = await findAccessibleSessionRecordByRawSessionId(sessionId, user.organisationId);
  if (!sessionRecord) {
    return NextResponse.json({ error: "Session record not found" }, { status: 404 });
  }

  const files = await listSessionFilesForSession(sessionId, user.organisationId);

  return NextResponse.json({
    files: files.map(serializeSessionFile),
    summary: buildSessionFileSummary(files),
    sessionRecordId: sessionRecord._id.toString(),
  });
}

export async function POST(req: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  await connectDB();

  const sessionRecord = await findAccessibleSessionRecordByRawSessionId(sessionId, user.organisationId);
  if (!sessionRecord) {
    return NextResponse.json({ error: "Session record not found" }, { status: 404 });
  }

  const formData = await req.formData();
  const filesToUpload = formData.getAll("files").filter(isUploadedFile);

  if (filesToUpload.length === 0) {
    return NextResponse.json({ error: "At least one file is required" }, { status: 400 });
  }

  const existingStoredNames = await listStoredSessionFileNamesForSession(sessionRecord._id);
  const reservedStoredNames = new Set(existingStoredNames);
  const createdFileIds: string[] = [];
  const writtenFiles: Array<{ relativePath: string }> = [];
  const uploadResults: Array<SessionFileUploadResult> = [];

  try {
    for (const [index, file] of filesToUpload.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const checksumSha256 = buildChecksumSha256(bytes);
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
        const storedName = buildStoredSessionFileName(file.name, reservedStoredNames);
        const { relativePath } = await saveSessionFileToDisk(
          user.organisationName,
          sessionId,
          storedName,
          bytes
        );

        try {
          const created = await SessionFile.create({
            organisationId: sessionRecord.organisationId,
            opencodeSessionId: sessionRecord._id,
            rawSessionId: sessionId,
            fileId,
            originalName: file.name,
            source: "device",
            storedName,
            relativePath,
            checksumSha256,
            mime: file.type || undefined,
            size: file.size,
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
        throw new Error(`Failed to allocate a stored filename for ${file.name}`);
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
  } catch {
    if (createdFileIds.length > 0) {
      await SessionFile.deleteMany({ fileId: { $in: createdFileIds } });
    }

    for (const writtenFile of writtenFiles) {
      await deleteSessionFileFromRelativePath(writtenFile.relativePath);
    }

    return NextResponse.json({ error: "Failed to upload session files" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  await connectDB();

  const sessionRecord = await findAccessibleSessionRecordByRawSessionId(sessionId, user.organisationId);
  if (!sessionRecord) {
    return NextResponse.json({ error: "Session record not found" }, { status: 404 });
  }

  const payload = (await req.json().catch(() => null)) as { fileIds?: unknown } | null;
  const fileIds = Array.isArray(payload?.fileIds)
    ? payload.fileIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (fileIds.length === 0) {
    return NextResponse.json({ error: "fileIds must contain at least one file id" }, { status: 400 });
  }

  const uniqueFileIds = Array.from(new Set(fileIds));
  const files = await SessionFile.find({
    fileId: { $in: uniqueFileIds },
    rawSessionId: sessionId,
    organisationId: sessionRecord.organisationId,
  }).lean();

  for (const file of files) {
    await deleteSessionFileFromRelativePath(file.relativePath);
  }

  if (files.length > 0) {
    await SessionFile.deleteMany({
      _id: { $in: files.map((file) => file._id) },
    });
  }

  const remainingFiles = await listSessionFilesForSession(sessionId, user.organisationId);

  return NextResponse.json({
    deletedFileIds: files.map((file) => file.fileId),
    files: remainingFiles.map(serializeSessionFile),
    summary: buildSessionFileSummary(remainingFiles),
  });
}
