import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";

export async function resolveMatterAccess(matterId: string, userId: string) {
  await connectDB();

  const [matter, membership] = await Promise.all([
    Matter.findById(matterId).lean(),
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

export async function resolveTrackedSession(trackedSessionId: string) {
  await connectDB();

  const trackedSession = await OpencodeSession.findById(trackedSessionId).lean();
  if (!trackedSession) {
    return null;
  }

  const assignment = await MatterSession.findOne({
    opencodeSessionId: trackedSession._id,
  }).lean();

  return {
    id: trackedSession._id.toString(),
    rawSessionId: trackedSession.sessionId,
    createdByUserId: trackedSession.createdByUserId.toString(),
    createdAt: trackedSession.createdAt.toISOString(),
    matterId: assignment?.matterId?.toString(),
    addedByUserId: assignment?.addedByUserId?.toString(),
  };
}

export async function resolveMatterTrackedSession(
  matterId: string,
  trackedSessionId: string,
  userId: string
) {
  const [matter, trackedSession] = await Promise.all([
    resolveMatterAccess(matterId, userId),
    resolveTrackedSession(trackedSessionId),
  ]);

  if (!matter || !trackedSession) {
    return null;
  }

  if (trackedSession.matterId !== matterId) {
    return null;
  }

  return {
    matter,
    trackedSession,
  };
}
