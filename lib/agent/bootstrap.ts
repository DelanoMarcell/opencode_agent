import { redirect } from "next/navigation";
import mongoose from "mongoose";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";
import { fetchOpenCodeBootstrap } from "@/lib/agent/opencode-server";
import type {
  AgentBootstrap,
  AgentBootstrapMatter,
  AgentBootstrapSessionRecord,
  AgentBootstrapUser,
  AgentWorkspaceMode,
} from "@/lib/agent/types";

type BuildWorkspaceBootstrapOptions = {
  initialMatterId?: string;
  initialSessionRecordId?: string;
  initialRawSessionId?: string;
};

type LoadedAgentWorkspaceData = {
  matters: Array<AgentBootstrapMatter>;
  matterSessionIdsByMatterId: Record<string, string[]>;
  sessionRecordsByRawSessionId: Record<string, AgentBootstrapSessionRecord>;
};

export async function requireAuthenticatedAgentUser(): Promise<AgentBootstrapUser> {
  const user = await getAuthenticatedOrganisationUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  return user;
}

async function loadAccessibleAgentWorkspaceData(
  user: AgentBootstrapUser
): Promise<LoadedAgentWorkspaceData> {
  await connectDB();

  const organisationObjectId = new mongoose.Types.ObjectId(user.organisationId);
  const memberships = await MatterMember.find({ userId: user.id }).lean();
  const accessibleMatterIds = memberships.map((membership) => membership.matterId.toString());

  const [matterDocs, sessionRecordDocs, matterSessionDocs] = await Promise.all([
    Matter.find({
      _id: { $in: accessibleMatterIds },
      organisationId: organisationObjectId,
    })
      .sort({ updatedAt: -1 })
      .lean(),
    OpencodeSession.find({ organisationId: organisationObjectId }).sort({ createdAt: -1 }).lean(),
    MatterSession.find({ matterId: { $in: accessibleMatterIds } }).lean(),
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

  const assignmentBySessionRecordId = new Map<string, (typeof matterSessionDocs)[number]>(
    matterSessionDocs.map((assignment) => [assignment.opencodeSessionId.toString(), assignment])
  );

  const sessionRecordsByRawSessionId: Record<string, AgentBootstrapSessionRecord> = {};
  const matterSessionIdsByMatterId: Record<string, string[]> = {};

  for (const sessionRecord of sessionRecordDocs) {
    const sessionRecordId = sessionRecord._id.toString();
    const assignment = assignmentBySessionRecordId.get(sessionRecordId);

    if (assignment) {
      const assignmentMatterId = assignment.matterId.toString();
      if (!accessibleMatterIdSet.has(assignmentMatterId)) {
        continue;
      }

      matterSessionIdsByMatterId[assignmentMatterId] ??= [];
      matterSessionIdsByMatterId[assignmentMatterId].push(sessionRecord.sessionId);
    }

    sessionRecordsByRawSessionId[sessionRecord.sessionId] = {
      id: sessionRecordId,
      rawSessionId: sessionRecord.sessionId,
      createdByUserId: sessionRecord.createdByUserId.toString(),
      createdAt: sessionRecord.createdAt.toISOString(),
      matterId: assignment?.matterId?.toString(),
      addedByUserId: assignment?.addedByUserId?.toString(),
    };
  }

  return {
    matters,
    matterSessionIdsByMatterId,
    sessionRecordsByRawSessionId,
  };
}

function buildChatsWorkspaceData(
  data: LoadedAgentWorkspaceData
): LoadedAgentWorkspaceData {
  const sessionRecordsByRawSessionId = Object.fromEntries(
    Object.entries(data.sessionRecordsByRawSessionId).filter(([, sessionRecord]) => !sessionRecord.matterId)
  );

  return {
    matters: [],
    matterSessionIdsByMatterId: {},
    sessionRecordsByRawSessionId,
  };
}

function buildMattersWorkspaceData(
  data: LoadedAgentWorkspaceData
): LoadedAgentWorkspaceData {
  const sessionRecordsByRawSessionId = Object.fromEntries(
    Object.entries(data.sessionRecordsByRawSessionId).filter(([, sessionRecord]) => Boolean(sessionRecord.matterId))
  );

  return {
    matters: data.matters,
    matterSessionIdsByMatterId: data.matterSessionIdsByMatterId,
    sessionRecordsByRawSessionId,
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
    visibleRawSessionIds: new Set(Object.keys(workspaceData.sessionRecordsByRawSessionId)),
  });

  return {
    workspaceMode,
    user,
    matters: workspaceData.matters,
    availableSessions: openCodeBootstrap.availableSessions,
    availableSessionsLoaded: openCodeBootstrap.availableSessionsLoaded,
    modelCatalog: openCodeBootstrap.modelCatalog,
    matterSessionIdsByMatterId: workspaceData.matterSessionIdsByMatterId,
    sessionRecordsByRawSessionId: workspaceData.sessionRecordsByRawSessionId,
    initialSessionSnapshot: openCodeBootstrap.initialSessionSnapshot,
    initialMatterId: options.initialMatterId,
    initialSessionRecordId: options.initialSessionRecordId,
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
