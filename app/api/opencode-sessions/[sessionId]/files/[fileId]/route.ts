import { NextResponse } from "next/server";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { SessionFile } from "@/lib/models/session-file";
import {
  buildSessionFileSummary,
  findAccessibleSessionRecordByRawSessionId,
  listSessionFilesForSession,
} from "@/lib/session-files/server";
import { deleteSessionFileFromRelativePath } from "@/lib/session-files/storage";

type RouteContext = {
  params: Promise<{
    sessionId: string;
    fileId: string;
  }>;
};

export async function DELETE(_: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId, fileId } = await params;
  await connectDB();

  const sessionRecord = await findAccessibleSessionRecordByRawSessionId(sessionId, user.organisationId);
  if (!sessionRecord) {
    return NextResponse.json({ error: "Session record not found" }, { status: 404 });
  }

  const file = await SessionFile.findOne({
    fileId,
    rawSessionId: sessionId,
    organisationId: sessionRecord.organisationId,
  }).lean();

  if (!file) {
    return NextResponse.json({ error: "Session file not found" }, { status: 404 });
  }

  await deleteSessionFileFromRelativePath(file.relativePath);
  await SessionFile.deleteOne({ _id: file._id });

  const files = await listSessionFilesForSession(sessionId, user.organisationId);

  return NextResponse.json({
    summary: buildSessionFileSummary(files),
  });
}
