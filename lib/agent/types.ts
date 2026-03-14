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

export type AgentBootstrap = {
  user: AgentBootstrapUser;
  matters: Array<AgentBootstrapMatter>;
  matterSessionIdsByMatterId: Record<string, string[]>;
  trackedSessionsBySessionId: Record<string, AgentBootstrapTrackedSession>;
  initialMatterId?: string;
  initialTrackedSessionId?: string;
  initialRawSessionId?: string;
};
