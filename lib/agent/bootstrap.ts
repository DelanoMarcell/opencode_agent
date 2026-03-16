import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";
import { fetchOpenCodeBootstrap } from "@/lib/agent/opencode-server";
import type {
  AgentBootstrap,
  AgentBootstrapMatter,
  AgentBootstrapTrackedSession,
  AgentBootstrapUser,
  AgentWorkspaceMode,
} from "@/lib/agent/types";

type BuildWorkspaceBootstrapOptions = {
  initialMatterId?: string;
  initialTrackedSessionId?: string;
  initialRawSessionId?: string;
};

type LoadedAgentWorkspaceData = {
  matters: Array<AgentBootstrapMatter>;
  matterSessionIdsByMatterId: Record<string, string[]>;
  trackedSessionsBySessionId: Record<string, AgentBootstrapTrackedSession>;
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

async function loadAccessibleAgentWorkspaceData(
  user: AgentBootstrapUser
): Promise<LoadedAgentWorkspaceData> {
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
    matterSessionDocs.map((assignment) => [assignment.opencodeSessionId.toString(), assignment])
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
    matters,
    matterSessionIdsByMatterId,
    trackedSessionsBySessionId,
  };
}

function buildChatsWorkspaceData(
  data: LoadedAgentWorkspaceData
): LoadedAgentWorkspaceData {
  const trackedSessionsBySessionId = Object.fromEntries(
    Object.entries(data.trackedSessionsBySessionId).filter(([, trackedSession]) => !trackedSession.matterId)
  );

  return {
    matters: [],
    matterSessionIdsByMatterId: {},
    trackedSessionsBySessionId,
  };
}

function buildMattersWorkspaceData(
  data: LoadedAgentWorkspaceData
): LoadedAgentWorkspaceData {
  const trackedSessionsBySessionId = Object.fromEntries(
    Object.entries(data.trackedSessionsBySessionId).filter(([, trackedSession]) => Boolean(trackedSession.matterId))
  );

  return {
    matters: data.matters,
    matterSessionIdsByMatterId: data.matterSessionIdsByMatterId,
    trackedSessionsBySessionId,
  };
}

async function buildWorkspaceBootstrap(
  user: AgentBootstrapUser,
  workspaceMode: AgentWorkspaceMode,
  options: BuildWorkspaceBootstrapOptions = {}
): Promise<AgentBootstrap> {
  const workspaceData =
    workspaceMode === "chats"
      ? buildChatsWorkspaceData(await loadAccessibleAgentWorkspaceData(user))
      : buildMattersWorkspaceData(await loadAccessibleAgentWorkspaceData(user));

  const openCodeBootstrap = await fetchOpenCodeBootstrap({
    initialRawSessionId: options.initialRawSessionId,
    visibleRawSessionIds: new Set(Object.keys(workspaceData.trackedSessionsBySessionId)),
  });

  return {
    workspaceMode,
    user,
    matters: workspaceData.matters,
    availableSessions: openCodeBootstrap.availableSessions,
    availableSessionsLoaded: openCodeBootstrap.availableSessionsLoaded,
    modelCatalog: openCodeBootstrap.modelCatalog,
    matterSessionIdsByMatterId: workspaceData.matterSessionIdsByMatterId,
    trackedSessionsBySessionId: workspaceData.trackedSessionsBySessionId,
    initialSessionSnapshot: openCodeBootstrap.initialSessionSnapshot,
    initialMatterId: options.initialMatterId,
    initialTrackedSessionId: options.initialTrackedSessionId,
    initialRawSessionId: options.initialRawSessionId,
  };
}

export async function buildChatWorkspaceBootstrap(
  user: AgentBootstrapUser,
  options: BuildWorkspaceBootstrapOptions = {}
) {
  return buildWorkspaceBootstrap(user, "chats", options);
}

export async function buildMatterWorkspaceBootstrap(
  user: AgentBootstrapUser,
  options: BuildWorkspaceBootstrapOptions = {}
) {
  return buildWorkspaceBootstrap(user, "matters", options);
}
