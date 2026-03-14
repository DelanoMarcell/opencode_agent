import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";
import type {
  AgentBootstrap,
  AgentBootstrapMatter,
  AgentBootstrapTrackedSession,
  AgentBootstrapUser,
} from "@/lib/agent/types";

type BuildAgentBootstrapOptions = {
  initialMatterId?: string;
  initialTrackedSessionId?: string;
  initialRawSessionId?: string;
};

export async function requireAuthenticatedAgentUser(): Promise<AgentBootstrapUser> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.email) {
    redirect("/auth/sign-in");
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
  };
}

export async function buildAgentBootstrap(
  user: AgentBootstrapUser,
  options: BuildAgentBootstrapOptions = {}
): Promise<AgentBootstrap> {
  await connectDB();

  const memberships = await MatterMember.find({ userId: user.id }).lean();
  const accessibleMatterIds = memberships.map((membership) => membership.matterId.toString());

  const [matterDocs, trackedSessionDocs, matterSessionDocs] = await Promise.all([
    Matter.find({ _id: { $in: accessibleMatterIds } }).sort({ updatedAt: -1 }).lean(),
    OpencodeSession.find({}).sort({ createdAt: -1 }).lean(),
    MatterSession.find({}).lean(),
  ]);

  const accessibleMatterIdSet = new Set(accessibleMatterIds);

  const matters: Array<AgentBootstrapMatter> = matterDocs.map((matter) => ({
    id: matter._id.toString(),
    code: matter.code,
    title: matter.title,
    description: matter.description ?? undefined,
    ownerUserId: matter.ownerUserId.toString(),
    status: matter.status,
  }));

  const assignmentByTrackedSessionId = new Map<string, (typeof matterSessionDocs)[number]>(
    matterSessionDocs.map((assignment) => [
      assignment.opencodeSessionId.toString(),
      assignment,
    ])
  );

  const trackedSessionsBySessionId: Record<string, AgentBootstrapTrackedSession> = {};
  const matterSessionIdsByMatterId: Record<string, string[]> = {};

  for (const trackedSession of trackedSessionDocs) {
    const trackedSessionId = trackedSession._id.toString();
    const assignment = assignmentByTrackedSessionId.get(trackedSessionId);

    if (assignment) {
      const assignmentMatterId = assignment.matterId.toString();
      if (!accessibleMatterIdSet.has(assignmentMatterId)) {
        continue;
      }

      matterSessionIdsByMatterId[assignmentMatterId] ??= [];
      matterSessionIdsByMatterId[assignmentMatterId].push(trackedSession.sessionId);
    }

    trackedSessionsBySessionId[trackedSession.sessionId] = {
      id: trackedSessionId,
      rawSessionId: trackedSession.sessionId,
      createdByUserId: trackedSession.createdByUserId.toString(),
      createdAt: trackedSession.createdAt.toISOString(),
      matterId: assignment?.matterId?.toString(),
      addedByUserId: assignment?.addedByUserId?.toString(),
    };
  }

  return {
    user,
    matters,
    matterSessionIdsByMatterId,
    trackedSessionsBySessionId,
    initialMatterId: options.initialMatterId,
    initialTrackedSessionId: options.initialTrackedSessionId,
    initialRawSessionId: options.initialRawSessionId,
  };
}
