import { NextResponse } from "next/server";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { MatterFile } from "@/lib/models/matter-file";
import {
  buildMatterFileSummary,
  findAccessibleMatterById,
  listMatterFilesForMatter,
} from "@/lib/matter-files/server";
import { deleteSessionFileFromRelativePath } from "@/lib/session-files/storage";

type RouteContext = {
  params: Promise<{
    id: string;
    fileId: string;
  }>;
};

export async function DELETE(_: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  await connectDB();

  const matter = await findAccessibleMatterById(id, user.id, user.organisationId);
  if (!matter) {
    return NextResponse.json({ error: "Matter not found" }, { status: 404 });
  }

  const file = await MatterFile.findOne({
    fileId,
    matterId: matter._id,
    organisationId: matter.organisationId,
  }).lean();

  if (!file) {
    return NextResponse.json({ error: "Matter file not found" }, { status: 404 });
  }

  await deleteSessionFileFromRelativePath(file.relativePath);
  await MatterFile.deleteOne({ _id: file._id });

  const files = await listMatterFilesForMatter(id, user.organisationId);

  return NextResponse.json({
    summary: buildMatterFileSummary(files),
  });
}
