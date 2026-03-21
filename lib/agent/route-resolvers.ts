import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";

export async function resolveMatterAccess(matterId: string, userId: string, organisationId: string) {
  await connectDB();

  const [matter, membership] = await Promise.all([
    Matter.findOne({ _id: matterId, organisationId }).lean(),
    MatterMember.findOne({ matterId, userId }).lean(),
  ]);

  if (!matter || !membership) {
    return null;
  }

  return {
    id: matter._id.toString(),
    code: matter.code,
    title: matter.title,
    description: matter.description ?? undefined,
    ownerUserId: matter.ownerUserId.toString(),
    status: matter.status,
  };
}

export async function resolveSessionRecord(sessionRecordId: string, organisationId: string) {
  await connectDB();

  const sessionRecord = await OpencodeSession.findOne({
    _id: sessionRecordId,
    organisationId,
  }).lean();
  if (!sessionRecord) {
    return null;
  }

  const assignment = await MatterSession.findOne({
    opencodeSessionId: sessionRecord._id,
  }).lean();

  return {
    id: sessionRecord._id.toString(),
    rawSessionId: sessionRecord.sessionId,
    createdByUserId: sessionRecord.createdByUserId.toString(),
    createdAt: sessionRecord.createdAt.toISOString(),
    matterId: assignment?.matterId?.toString(),
    addedByUserId: assignment?.addedByUserId?.toString(),
  };
}

export async function resolveMatterSessionRecord(
  matterId: string,
  sessionRecordId: string,
  userId: string,
  organisationId: string
) {
  const [matter, sessionRecord] = await Promise.all([
    resolveMatterAccess(matterId, userId, organisationId),
    resolveSessionRecord(sessionRecordId, organisationId),
  ]);

  if (!matter || !sessionRecord) {
    return null;
  }

  if (sessionRecord.matterId !== matterId) {
    return null;
  }

  return {
    matter,
    sessionRecord,
  };
}
