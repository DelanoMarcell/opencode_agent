import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import type {
  SessionOption,
  StoredMessage,
} from "@/lib/agent-runtime/types";
import {
  buildAgentModelCatalog,
  type ProviderCatalogListItem,
} from "@/lib/agent/model-catalog";
import type {
  AgentBootstrapModelCatalog,
  AgentModelSelectionPolicy,
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

function getOpencodeErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load OpenCode provider metadata";
}

export async function fetchOpenCodeProviderCatalog(): Promise<{
  providers: Array<ProviderCatalogListItem>;
  connectedProviderIDs: Array<string>;
  defaultModelIDs: Record<string, string>;
}> {
  const client = createServerOpencodeClient();
  const result = await client.provider.list();

  if (result.error) {
    throw new Error(getOpencodeErrorMessage(result.error));
  }

  return {
    providers: (result.data?.all ?? []) as Array<ProviderCatalogListItem>,
    connectedProviderIDs: result.data?.connected ?? [],
    defaultModelIDs: result.data?.default ?? {},
  };
}

type FetchOpenCodeBootstrapOptions = {
  initialRawSessionId?: string;
  visibleRawSessionIds: Set<string>;
  modelSelectionPolicy?: AgentModelSelectionPolicy | null;
};

export async function fetchOpenCodeBootstrap({
  initialRawSessionId,
  visibleRawSessionIds,
  modelSelectionPolicy,
}: FetchOpenCodeBootstrapOptions): Promise<{
  availableSessions: Array<SessionOption>;
  availableSessionsLoaded: boolean;
  modelCatalog: AgentBootstrapModelCatalog;
  initialSessionSnapshot?: AgentBootstrapSessionSnapshot;
}> {
  const client = createServerOpencodeClient();

  const [providerResult, sessionsResult, messagesResult, statusResult] = await Promise.all([
    fetchOpenCodeProviderCatalog().catch((error) => ({ transportError: error } as const)),
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
    providerResult && "providers" in providerResult
      ? buildAgentModelCatalog({
          providers: providerResult.providers,
          connectedProviderIDs: providerResult.connectedProviderIDs,
          defaultModelIDs: providerResult.defaultModelIDs,
          policy: modelSelectionPolicy,
        })
      : {
          loaded: false,
          contextLimits: {},
          costs: {},
          variants: {},
          selectableModels: [],
          defaultModelKey: null,
          preferredVariantByModelKey: {},
        };

  const availableSessions =
    sessionsResult && "data" in sessionsResult && !sessionsResult.error
      ? [...(sessionsResult.data ?? [])]
          .sort((left, right) => right.time.updated - left.time.updated)
          .filter((session) => visibleRawSessionIds.has(session.id))
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
