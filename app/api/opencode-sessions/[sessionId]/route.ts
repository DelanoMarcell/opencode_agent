import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  await connectDB();

  const sessionRecord = await OpencodeSession.findOne({
    sessionId,
    organisationId: new mongoose.Types.ObjectId(user.organisationId),
  }).lean();
  if (!sessionRecord) {
    return NextResponse.json({ error: "Session record not found" }, { status: 404 });
  }

  const assignment = await MatterSession.findOne({
    opencodeSessionId: sessionRecord._id,
  }).lean();

  return NextResponse.json({
    sessionRecord: {
      id: sessionRecord._id.toString(),
      rawSessionId: sessionRecord.sessionId,
      createdByUserId: sessionRecord.createdByUserId.toString(),
      createdAt: sessionRecord.createdAt.toISOString(),
      matterId: assignment?.matterId?.toString(),
      addedByUserId: assignment?.addedByUserId?.toString(),
    },
  });
}
