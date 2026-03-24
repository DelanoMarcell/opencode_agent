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
      ...serializeSessionRecord(sessionRecord),
      matterId: assignment?.matterId?.toString(),
      addedByUserId: assignment?.addedByUserId?.toString(),
    },
  });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  try {
    const { title } = await req.json();
    const trimmedTitle = typeof title === "string" ? title.trim() : "";

    if (!trimmedTitle) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    await connectDB();

    const sessionRecord = await OpencodeSession.findOneAndUpdate(
      {
        sessionId,
        organisationId: new mongoose.Types.ObjectId(user.organisationId),
      },
      {
        $set: {
          title: trimmedTitle,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).lean();

    if (!sessionRecord) {
      return NextResponse.json({ error: "Session record not found" }, { status: 404 });
    }

    const assignment = await MatterSession.findOne({
      opencodeSessionId: sessionRecord._id,
    }).lean();

    return NextResponse.json({
      sessionRecord: {
        ...serializeSessionRecord(sessionRecord),
        matterId: assignment?.matterId?.toString(),
        addedByUserId: assignment?.addedByUserId?.toString(),
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to rename session" }, { status: 500 });
  }
}
