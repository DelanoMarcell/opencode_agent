import { redirect } from "next/navigation";
import mongoose from "mongoose";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterFile } from "@/lib/models/matter-file";
import { MatterMember } from "@/lib/models/matter-member";
import { MatterSession } from "@/lib/models/matter-session";
import { OpencodeSession } from "@/lib/models/opencode-session";
import { SessionFile } from "@/lib/models/session-file";
import type { StoredFileSummary } from "@/lib/files/types";
import { fetchOpenCodeBootstrap } from "@/lib/agent/opencode-server";
import type {
  AgentBootstrap,
  AgentBootstrapMatter,
  AgentBootstrapSessionRecord,
  AgentBootstrapUser,
  AgentWorkspaceMode,
} from "@/lib/agent/types";
import { buildMatterFileSummary } from "@/lib/matter-files/server";
import { buildSessionFileSummary } from "@/lib/session-files/server";

type BuildWorkspaceBootstrapOptions = {
  initialMatterId?: string;
  initialSessionRecordId?: string;
  initialRawSessionId?: string;
};

type LoadedAgentWorkspaceData = {
  matters: Array<AgentBootstrapMatter>;
  matterFileSummaryByMatterId: Record<string, StoredFileSummary>;
  matterSessionIdsByMatterId: Record<string, string[]>;
  sessionFileSummaryByRawSessionId: Record<string, StoredFileSummary>;
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
  const rawSessionIds = sessionRecordDocs.map((sessionRecord) => sessionRecord.sessionId);
  const [sessionFileDocs, matterFileDocs] = await Promise.all([
    rawSessionIds.length > 0
      ? SessionFile.find({
          organisationId: organisationObjectId,
          rawSessionId: { $in: rawSessionIds },
        })
          .select({ rawSessionId: 1 })
          .lean()
      : Promise.resolve([]),
    accessibleMatterIds.length > 0
      ? MatterFile.find({
          organisationId: organisationObjectId,
          matterId: { $in: accessibleMatterIds },
        })
          .select({ matterId: 1 })
          .lean()
      : Promise.resolve([]),
  ]);

  const accessibleMatterIdSet = new Set(accessibleMatterIds);
  const matterFileSummaryByMatterId: Record<string, StoredFileSummary> = {};
  const matterSessionIdsByMatterId: Record<string, string[]> = {};
  const sessionFileSummaryByRawSessionId: Record<string, StoredFileSummary> = {};

  const sessionRecordsByRawSessionId: Record<string, AgentBootstrapSessionRecord> = {};

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

  const sessionFileDocsByRawSessionId = new Map<
    string,
    Array<(typeof sessionFileDocs)[number]>
  >();
  for (const sessionFile of sessionFileDocs) {
    const current = sessionFileDocsByRawSessionId.get(sessionFile.rawSessionId) ?? [];
    current.push(sessionFile);
    sessionFileDocsByRawSessionId.set(sessionFile.rawSessionId, current);
  }

  const matterFileDocsByMatterId = new Map<string, Array<(typeof matterFileDocs)[number]>>();
  for (const matterFile of matterFileDocs) {
    const matterId = matterFile.matterId.toString();
    const current = matterFileDocsByMatterId.get(matterId) ?? [];
    current.push(matterFile);
    matterFileDocsByMatterId.set(matterId, current);
  }

  for (const matter of matterDocs) {
    matterFileSummaryByMatterId[matter._id.toString()] = buildMatterFileSummary(
      matterFileDocsByMatterId.get(matter._id.toString()) ?? []
    );
  }

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
      title: sessionRecord.title ?? undefined,
      createdByUserId: sessionRecord.createdByUserId.toString(),
      createdAt: sessionRecord.createdAt.toISOString(),
      matterId: assignment?.matterId?.toString(),
      addedByUserId: assignment?.addedByUserId?.toString(),
    };
    sessionFileSummaryByRawSessionId[sessionRecord.sessionId] = buildSessionFileSummary(
      sessionFileDocsByRawSessionId.get(sessionRecord.sessionId) ?? []
    );
  }

  return {
    matters,
    matterFileSummaryByMatterId,
    matterSessionIdsByMatterId,
    sessionFileSummaryByRawSessionId,
    sessionRecordsByRawSessionId,
  };
}

function buildChatsWorkspaceData(
  data: LoadedAgentWorkspaceData
): LoadedAgentWorkspaceData {
  const sessionRecordsByRawSessionId: Record<string, AgentBootstrapSessionRecord> = Object.fromEntries(
    Object.entries(data.sessionRecordsByRawSessionId).filter(([, sessionRecord]) => !sessionRecord.matterId)
  );
  const visibleRawSessionIds = new Set(Object.keys(sessionRecordsByRawSessionId));
  const sessionFileSummaryByRawSessionId: Record<string, StoredFileSummary> = Object.fromEntries(
    Object.entries(data.sessionFileSummaryByRawSessionId).filter(([rawSessionId]) =>
      visibleRawSessionIds.has(rawSessionId)
    )
  );

  return {
    matters: [],
    matterFileSummaryByMatterId: {},
    matterSessionIdsByMatterId: {},
    sessionFileSummaryByRawSessionId,
    sessionRecordsByRawSessionId,
  };
}

function buildMattersWorkspaceData(
  data: LoadedAgentWorkspaceData
): LoadedAgentWorkspaceData {
  const sessionRecordsByRawSessionId: Record<string, AgentBootstrapSessionRecord> = Object.fromEntries(
    Object.entries(data.sessionRecordsByRawSessionId).filter(([, sessionRecord]) => Boolean(sessionRecord.matterId))
  );
  const visibleRawSessionIds = new Set(Object.keys(sessionRecordsByRawSessionId));
  const sessionFileSummaryByRawSessionId: Record<string, StoredFileSummary> = Object.fromEntries(
    Object.entries(data.sessionFileSummaryByRawSessionId).filter(([rawSessionId]) =>
      visibleRawSessionIds.has(rawSessionId)
    )
  );

  return {
    matters: data.matters,
    matterFileSummaryByMatterId: data.matterFileSummaryByMatterId,
    matterSessionIdsByMatterId: data.matterSessionIdsByMatterId,
    sessionFileSummaryByRawSessionId,
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
    matterFileSummaryByMatterId: workspaceData.matterFileSummaryByMatterId,
    matterSessionIdsByMatterId: workspaceData.matterSessionIdsByMatterId,
    sessionFileSummaryByRawSessionId: workspaceData.sessionFileSummaryByRawSessionId,
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
