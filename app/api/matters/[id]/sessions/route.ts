import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { MatterMember } from "@/lib/models/matter-member";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

async function userCanAccessMatter(matterId: string, userId: string) {
  const membership = await MatterMember.findOne({ matterId, userId }).lean();
  return Boolean(membership);
}

export async function GET(_: Request, { params }: RouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await connectDB();

  if (!(await userCanAccessMatter(id, user.id))) {
    return NextResponse.json({ error: "Matter not found" }, { status: 404 });
  }

  const assignments = await MatterSession.find({ matterId: id }).lean();
  const trackedSessions = await OpencodeSession.find({
    _id: { $in: assignments.map((assignment) => assignment.opencodeSessionId) },
  })
    .sort({ createdAt: -1 })
    .lean();

  const trackedSessionsById = Object.fromEntries(
    trackedSessions.map((trackedSession) => [trackedSession._id.toString(), trackedSession])
  );

  return NextResponse.json({
    sessions: assignments
      .map((assignment) => {
        const trackedSession = trackedSessionsById[assignment.opencodeSessionId.toString()];
        if (!trackedSession) return null;

        return {
          ...serializeTrackedSession(trackedSession),
          matterId: assignment.matterId.toString(),
          addedByUserId: assignment.addedByUserId.toString(),
        };
      })
      .filter(Boolean),
  });
}

export async function POST(req: Request, { params }: RouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const { trackedSessionId } = await req.json();

    if (!trackedSessionId) {
      return NextResponse.json({ error: "trackedSessionId is required" }, { status: 400 });
    }

    await connectDB();

    if (!(await userCanAccessMatter(id, user.id))) {
      return NextResponse.json({ error: "Matter not found" }, { status: 404 });
    }

    const trackedSession = await OpencodeSession.findById(trackedSessionId).lean();
    if (!trackedSession) {
      return NextResponse.json({ error: "Tracked session not found" }, { status: 404 });
    }

    const existingAssignment = await MatterSession.findOne({
      opencodeSessionId: trackedSessionId,
    }).lean();

    if (existingAssignment) {
      if (existingAssignment.matterId.toString() !== id) {
        return NextResponse.json(
          { error: "Tracked session is already assigned to another matter" },
          { status: 409 }
        );
      }

      return NextResponse.json({
        matterSession: {
          id: existingAssignment._id.toString(),
          matterId: existingAssignment.matterId.toString(),
          opencodeSessionId: existingAssignment.opencodeSessionId.toString(),
          addedByUserId: existingAssignment.addedByUserId.toString(),
          createdAt: existingAssignment.createdAt.toISOString(),
        },
        addedByUserId: existingAssignment.addedByUserId.toString(),
      });
    }

    const matterSession = await MatterSession.create({
      matterId: id,
      opencodeSessionId: trackedSessionId,
      addedByUserId: user.id,
    });

    return NextResponse.json(
      {
        matterSession: {
          id: matterSession._id.toString(),
          matterId: matterSession.matterId.toString(),
          opencodeSessionId: matterSession.opencodeSessionId.toString(),
          addedByUserId: matterSession.addedByUserId.toString(),
          createdAt: matterSession.createdAt.toISOString(),
        },
        addedByUserId: matterSession.addedByUserId.toString(),
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Failed to assign session to matter" }, { status: 500 });
  }
}
