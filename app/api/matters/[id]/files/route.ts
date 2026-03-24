import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { buildStoredFileSummary } from "@/lib/files/summary";
import type { StoredFileUploadResult } from "@/lib/files/types";
import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { MatterFile } from "@/lib/models/matter-file";
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

  const { id } = await params;
  await connectDB();

  const matter = await findAccessibleMatterById(id, user.id, user.organisationId);
  if (!matter) {
    return NextResponse.json({ error: "Matter not found" }, { status: 404 });
  }

  const files = await listMatterFilesForMatter(id, user.organisationId);

  return NextResponse.json({
    files: files.map(serializeMatterFile),
    summary: buildMatterFileSummary(files),
    matterId: matter._id.toString(),
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

  const formData = await req.formData();
  const filesToUpload = formData.getAll("files").filter(isUploadedFile);

  if (filesToUpload.length === 0) {
    return NextResponse.json({ error: "At least one file is required" }, { status: 400 });
  }

  const existingStoredNames = await listStoredMatterFileNamesForMatter(matter._id);
  const reservedStoredNames = new Set(existingStoredNames);
  const createdFileIds: string[] = [];
  const writtenFiles: Array<{ relativePath: string }> = [];
  const uploadResults: Array<StoredFileUploadResult> = [];

  try {
    for (const [index, file] of filesToUpload.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const checksumSha256 = buildChecksumSha256(bytes);
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
        const storedName = buildStoredSessionFileName(file.name, reservedStoredNames);
        const { relativePath } = await saveMatterFileToDisk(
          user.organisationName,
          matter.code,
          storedName,
          bytes
        );

        try {
          const created = await MatterFile.create({
            organisationId: matter.organisationId,
            matterId: matter._id,
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
        throw new Error(`Failed to allocate a stored filename for ${file.name}`);
      }
    }

    const files = await listMatterFilesForMatter(id, user.organisationId);

    return NextResponse.json(
      {
        files: files.map(serializeMatterFile),
        summary: buildStoredFileSummary(files),
        uploadResults,
      },
      { status: 201 }
    );
  } catch {
    if (createdFileIds.length > 0) {
      await MatterFile.deleteMany({ fileId: { $in: createdFileIds } });
    }

    for (const writtenFile of writtenFiles) {
      await deleteSessionFileFromRelativePath(writtenFile.relativePath);
    }

    return NextResponse.json({ error: "Failed to upload matter files" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
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

  const payload = (await req.json().catch(() => null)) as { fileIds?: unknown } | null;
  const fileIds = Array.isArray(payload?.fileIds)
    ? payload.fileIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (fileIds.length === 0) {
    return NextResponse.json({ error: "fileIds must contain at least one file id" }, { status: 400 });
  }

  const uniqueFileIds = Array.from(new Set(fileIds));
  const files = await MatterFile.find({
    fileId: { $in: uniqueFileIds },
    matterId: matter._id,
    organisationId: matter.organisationId,
  }).lean();

  for (const file of files) {
    await deleteSessionFileFromRelativePath(file.relativePath);
  }

  if (files.length > 0) {
    await MatterFile.deleteMany({
      _id: { $in: files.map((file) => file._id) },
    });
  }

  const remainingFiles = await listMatterFilesForMatter(id, user.organisationId);

  return NextResponse.json({
    deletedFileIds: files.map((file) => file.fileId),
    files: remainingFiles.map(serializeMatterFile),
    summary: buildMatterFileSummary(remainingFiles),
  });
}
