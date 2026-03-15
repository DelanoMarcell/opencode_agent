import type {
  ModelCostInfo,
  SessionOption,
  StoredMessage,
} from "@/lib/agent-runtime/types";

export type AgentBootstrapMatter = {
  id: string;
  code: string;
  title: string;
  description?: string;
  ownerUserId: string;
  status: "active" | "archived";
};

export type AgentBootstrapTrackedSession = {
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
  user: AgentBootstrapUser;
  matters: Array<AgentBootstrapMatter>;
  availableSessions: Array<SessionOption>;
  availableSessionsLoaded: boolean;
  modelCatalog: AgentBootstrapModelCatalog;
  matterSessionIdsByMatterId: Record<string, string[]>;
  trackedSessionsBySessionId: Record<string, AgentBootstrapTrackedSession>;
  initialSessionSnapshot?: AgentBootstrapSessionSnapshot;
  initialMatterId?: string;
  initialTrackedSessionId?: string;
  initialRawSessionId?: string;
};
