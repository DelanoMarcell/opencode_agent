import type {
  ModelCostInfo,
  SessionOption,
  StoredMessage,
} from "@/lib/agent-runtime/types";

export type AgentWorkspaceMode = "chats" | "matters";

export type AgentBootstrapMatter = {
  id: string;
  code: string;
  title: string;
  description?: string;
  ownerUserId: string;
  status: "active" | "archived";
};

export type AgentBootstrapSessionRecord = {
  id: string;
  rawSessionId: string;
  createdByUserId: string;
  createdAt: string;
  matterId?: string;
  addedByUserId?: string;
};

export type AgentBootstrapUser = {
  id: string;
  email: string;
  name: string | null;
  organisationId: string;
  organisationSlug: string;
  organisationName: string;
};

export type AgentBootstrapModelCatalog = {
  loaded: boolean;
  contextLimits: Record<string, number>;
  costs: Record<string, ModelCostInfo>;
};

export type AgentBootstrapSessionSnapshot = {
  loaded: boolean;
  storedMessages: Array<StoredMessage>;
  status: "idle" | "busy" | "retry";
};

export type AgentBootstrap = {
  workspaceMode: AgentWorkspaceMode;
  user: AgentBootstrapUser;
  matters: Array<AgentBootstrapMatter>;
  availableSessions: Array<SessionOption>;
  availableSessionsLoaded: boolean;
  modelCatalog: AgentBootstrapModelCatalog;
  matterSessionIdsByMatterId: Record<string, string[]>;
  sessionRecordsByRawSessionId: Record<string, AgentBootstrapSessionRecord>;
  initialSessionSnapshot?: AgentBootstrapSessionSnapshot;
  initialMatterId?: string;
  initialSessionRecordId?: string;
  initialRawSessionId?: string;
};
