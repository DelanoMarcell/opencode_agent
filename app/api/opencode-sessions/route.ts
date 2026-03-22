import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";

function serializeSessionRecord(sessionRecord: {
  _id: { toString(): string };
  sessionId: string;
  title?: string | null;
  createdByUserId: { toString(): string };
  createdAt: Date;
}) {
  return {
    id: sessionRecord._id.toString(),
    rawSessionId: sessionRecord.sessionId,
    title: sessionRecord.title ?? undefined,
    createdByUserId: sessionRecord.createdByUserId.toString(),
    createdAt: sessionRecord.createdAt.toISOString(),
  };
}

export async function POST(req: Request) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { sessionId, title } = await req.json();

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    await connectDB();

    const organisationObjectId = new mongoose.Types.ObjectId(user.organisationId);
    let sessionRecord = await OpencodeSession.findOne({
      sessionId,
      organisationId: organisationObjectId,
    }).lean();
    if (!sessionRecord) {
      const created = await OpencodeSession.create({
        organisationId: organisationObjectId,
        sessionId,
        title: typeof title === "string" && title.trim() ? title.trim() : undefined,
        createdByUserId: user.id,
      });
      sessionRecord = created.toObject();
    }

    const assignment = await MatterSession.findOne({
      opencodeSessionId: sessionRecord._id,
    }).lean();

    return NextResponse.json(
      {
        sessionRecord: {
          ...serializeSessionRecord(sessionRecord),
          matterId: assignment?.matterId?.toString(),
          addedByUserId: assignment?.addedByUserId?.toString(),
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Failed to register session record" }, { status: 500 });
  }
}
