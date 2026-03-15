import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import { getModelKey, toModelCostInfo } from "@/lib/agent-runtime/helpers";
import type {
  ModelCostInfo,
  SessionOption,
  StoredMessage,
} from "@/lib/agent-runtime/types";
import type {
  AgentBootstrapModelCatalog,
  AgentBootstrapSessionSnapshot,
} from "@/lib/agent/types";

const DEFAULT_OPENCODE_BASE_URL =
  process.env.OPENCODE_BASE_URL ??
  process.env.NEXT_PUBLIC_OPENCODE_BASE_URL ??
  "http://localhost:4096";

function createServerOpencodeClient() {
  return createOpencodeClient({
    baseUrl: DEFAULT_OPENCODE_BASE_URL,
  });
}

type ProviderListItem = {
  id: string;
  models?: Record<
    string,
    {
      id: string;
      limit?: {
        context?: number;
      };
      cost?: unknown;
    }
  >;
};

function buildModelCatalog(providers: Array<ProviderListItem>): AgentBootstrapModelCatalog {
  const contextLimits: Record<string, number> = {};
  const costs: Record<string, ModelCostInfo> = {};

  for (const provider of providers) {
    const providerID = provider.id;
    const models = provider.models ?? {};

    for (const model of Object.values(models)) {
      const modelKey = getModelKey(providerID, model.id);
      const contextLimit = model.limit?.context;
      if (typeof contextLimit === "number" && Number.isFinite(contextLimit)) {
        contextLimits[modelKey] = Math.max(0, Math.floor(contextLimit));
      }

      const costInfo = toModelCostInfo(model.cost);
      if (costInfo) {
        costs[modelKey] = costInfo;
      }
    }
  }

  return {
    loaded: true,
    contextLimits,
    costs,
  };
}

type FetchOpenCodeBootstrapOptions = {
  initialRawSessionId?: string;
  trackedRawSessionIds: Set<string>;
};

export async function fetchOpenCodeBootstrap({
  initialRawSessionId,
  trackedRawSessionIds,
}: FetchOpenCodeBootstrapOptions): Promise<{
  availableSessions: Array<SessionOption>;
  availableSessionsLoaded: boolean;
  modelCatalog: AgentBootstrapModelCatalog;
  initialSessionSnapshot?: AgentBootstrapSessionSnapshot;
}> {
  const client = createServerOpencodeClient();

  const [providerResult, sessionsResult, messagesResult, statusResult] = await Promise.all([
    client.provider.list().catch((error) => ({ transportError: error } as const)),
    client.session.list().catch((error) => ({ transportError: error } as const)),
    initialRawSessionId
      ? client.session
          .messages({
            sessionID: initialRawSessionId,
            limit: 1000,
          })
          .catch((error) => ({ transportError: error } as const))
      : Promise.resolve(null),
    initialRawSessionId
      ? client.session.status().catch((error) => ({ transportError: error } as const))
      : Promise.resolve(null),
  ]);

  const modelCatalog =
    providerResult && "data" in providerResult && !providerResult.error
      ? buildModelCatalog(providerResult.data?.all ?? [])
      : {
          loaded: false,
          contextLimits: {},
          costs: {},
        };

  const availableSessions =
    sessionsResult && "data" in sessionsResult && !sessionsResult.error
      ? [...(sessionsResult.data ?? [])]
          .sort((left, right) => right.time.updated - left.time.updated)
          .filter((session) => trackedRawSessionIds.has(session.id))
          .map((session) => ({
            id: session.id,
            title: session.title,
            updated: session.time.updated,
            created: session.time.created,
          }))
      : [];

  const availableSessionsLoaded =
    Boolean(sessionsResult) && "data" in sessionsResult && !sessionsResult.error;

  let initialSessionSnapshot: AgentBootstrapSessionSnapshot | undefined;
  if (initialRawSessionId) {
    const storedMessages =
      messagesResult && "data" in messagesResult && !messagesResult.error
        ? ((messagesResult.data ?? []) as Array<StoredMessage>)
        : null;

    const sessionStatusMap =
      statusResult && "data" in statusResult && !statusResult.error ? statusResult.data ?? {} : null;

    if (storedMessages && sessionStatusMap) {
      const sessionStatus = sessionStatusMap[initialRawSessionId] ?? { type: "idle" };
      initialSessionSnapshot = {
        loaded: true,
        storedMessages,
        status:
          sessionStatus.type === "busy" || sessionStatus.type === "retry"
            ? sessionStatus.type
            : "idle",
      };
    }
  }

  return {
    availableSessions,
    availableSessionsLoaded,
    modelCatalog,
    initialSessionSnapshot,
  };
}
