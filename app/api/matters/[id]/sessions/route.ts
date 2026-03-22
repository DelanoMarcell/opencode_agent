import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";

type RouteContext = {
  params: Promise<{
    id: string;
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

async function userCanAccessMatter(matterId: string, userId: string, organisationId: string) {
  // A user only has access if the matter exists in their org and they have a membership row for it.
  const [matter, membership] = await Promise.all([
    Matter.findOne({ _id: matterId, organisationId: new mongoose.Types.ObjectId(organisationId) }).lean(),
    MatterMember.findOne({ matterId, userId }).lean(),
  ]);

  if (!matter) {
    return false;
  }

  return Boolean(membership);
}

export async function GET(_: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await connectDB();

  // Reject reads for matters outside the current org, even if the raw id exists.
  if (!(await userCanAccessMatter(id, user.id, user.organisationId))) {
    return NextResponse.json({ error: "Matter not found" }, { status: 404 });
  }

  const assignments = await MatterSession.find({ matterId: id }).lean();
  const sessionRecords = await OpencodeSession.find({
    organisationId: new mongoose.Types.ObjectId(user.organisationId),
    _id: { $in: assignments.map((assignment) => assignment.opencodeSessionId) },
  })
    .sort({ createdAt: -1 })
    .lean();

  const sessionRecordsById = Object.fromEntries(
    sessionRecords.map((sessionRecord) => [sessionRecord._id.toString(), sessionRecord])
  );

  return NextResponse.json({
    sessions: assignments
      .map((assignment) => {
        const sessionRecord = sessionRecordsById[assignment.opencodeSessionId.toString()];
        if (!sessionRecord) return null;

        return {
          ...serializeSessionRecord(sessionRecord),
          matterId: assignment.matterId.toString(),
          addedByUserId: assignment.addedByUserId.toString(),
        };
      })
      .filter(Boolean),
  });
}

export async function POST(req: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const { sessionRecordId } = await req.json();

    if (!sessionRecordId) {
      return NextResponse.json({ error: "sessionRecordId is required" }, { status: 400 });
    }

    await connectDB();

    // Reject assignments into matters outside the current org, even if the raw id exists.
    if (!(await userCanAccessMatter(id, user.id, user.organisationId))) {
      return NextResponse.json({ error: "Matter not found" }, { status: 404 });
    }

    const sessionRecord = await OpencodeSession.findOne({
      _id: sessionRecordId,
      organisationId: new mongoose.Types.ObjectId(user.organisationId),
    }).lean();
    if (!sessionRecord) {
      return NextResponse.json({ error: "Session record not found" }, { status: 404 });
    }

    const existingAssignment = await MatterSession.findOne({
      opencodeSessionId: sessionRecordId,
    }).lean();

    if (existingAssignment) {
      if (existingAssignment.matterId.toString() !== id) {
        return NextResponse.json(
          { error: "Session record is already assigned to another matter" },
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
      opencodeSessionId: sessionRecordId,
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
    return NextResponse.json({ error: "Failed to assign session record to matter" }, { status: 500 });
  }
}
