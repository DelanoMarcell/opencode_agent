import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";

function serializeTrackedSession(trackedSession: {
  _id: { toString(): string };
  sessionId: string;
  createdByUserId: { toString(): string };
  createdAt: Date;
}) {
  return {
    id: trackedSession._id.toString(),
    rawSessionId: trackedSession.sessionId,
    createdByUserId: trackedSession.createdByUserId.toString(),
    createdAt: trackedSession.createdAt.toISOString(),
  };
}

async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return null;
  }

  return session.user;
}

export async function POST(req: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { sessionId } = await req.json();

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    await connectDB();

    let trackedSession = await OpencodeSession.findOne({ sessionId }).lean();
    if (!trackedSession) {
      const created = await OpencodeSession.create({
        sessionId,
        createdByUserId: user.id,
      });
      trackedSession = created.toObject();
    }

    const assignment = await MatterSession.findOne({
      opencodeSessionId: trackedSession._id,
    }).lean();

    return NextResponse.json(
      {
        trackedSession: {
          ...serializeTrackedSession(trackedSession),
          matterId: assignment?.matterId?.toString(),
          addedByUserId: assignment?.addedByUserId?.toString(),
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Failed to register tracked session" }, { status: 500 });
  }
}
