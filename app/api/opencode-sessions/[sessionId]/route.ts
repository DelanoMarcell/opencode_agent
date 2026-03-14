import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return null;
  }

  return session.user;
}

export async function GET(_: Request, { params }: RouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  await connectDB();

  const trackedSession = await OpencodeSession.findOne({ sessionId }).lean();
  if (!trackedSession) {
    return NextResponse.json({ error: "Tracked session not found" }, { status: 404 });
  }

  const assignment = await MatterSession.findOne({
    opencodeSessionId: trackedSession._id,
  }).lean();

  return NextResponse.json({
    trackedSession: {
      id: trackedSession._id.toString(),
      rawSessionId: trackedSession.sessionId,
      createdByUserId: trackedSession.createdByUserId.toString(),
      createdAt: trackedSession.createdAt.toISOString(),
      matterId: assignment?.matterId?.toString(),
      addedByUserId: assignment?.addedByUserId?.toString(),
    },
  });
}
