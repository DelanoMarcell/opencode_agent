"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createOpencodeClient,
  type Part,
  type PermissionRequest,
  type QuestionInfo,
  type QuestionRequest,
} from "@opencode-ai/sdk/v2/client";

import { AgentComposer } from "@/components/agent-shell/agent-composer";
import { AgentInteractivePanel } from "@/components/agent-shell/agent-interactive-panel";
import { AgentSessionHeader } from "@/components/agent-shell/agent-session-header";
import { AgentTimeline } from "@/components/agent-shell/agent-timeline";
import { AgentTracePanel } from "@/components/agent-shell/agent-trace-panel";
import {
  MatterChatSidebar,
  type MatterChatSidebarMatter,
  type MatterChatSidebarSession,
} from "@/components/agent-shell/matter-chat-sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentUsage } from "@/hooks/agent/use-agent-usage";
import {
  buildMessageStateFromStoredMessages,
  buildQuestionAnswer,
  buildSessionCostFormulaGroups,
  buildTimelineFromMessageState,
  createEmptyQuestionDraft,
  didSnapshotCaptureActiveRun,
  findMessageEntry,
  getAssistantError,
  getAssistantTextFromMessageParts,
  getCreatedAt,
  getLatestAssistantSnapshot,
  getModelKey,
  getToolCallCacheSignature,
  getToolSignature,
  isTextPartRunning,
  mergeAssistantText,
  normalizeEvent,
  parseAssistantUsageFromInfo,
  preferMoreCompleteToolCall,
  sortMessageEntries,
  sortMessagePartEntries,
  sortStoredParts,
  toErrorMessage,
  toCompactJSON,
  toModelCostInfo,
  toRuntimeToolCall,
  updateUserMessageText,
  upsertMessageEntry,
  upsertMessagePart,
  waitFor,
  formatToolUpdate,
  formatTokenCount,
  formatUsdAmount,
  getTokenUsageTotal,
} from "@/lib/agent-runtime/helpers";
import type {
  AgentEvent,
  AgentPart,
  ActiveRun,
  MessageEntry,
  MessagePartEntry,
  ModelCostInfo,
  PendingOptimisticUserMessage,
  QuestionDraft,
  RuntimeToolCall,
  SessionOption,
  StoredMessage,
  StreamEvent,
  TimelineItem,
} from "@/lib/agent-runtime/types";
import type {
  AgentBootstrap,
  AgentBootstrapTrackedSession,
} from "@/lib/agent/types";

const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_OPENCODE_BASE_URL ?? "http://localhost:4096";
const RECONNECT_DELAYS_MS = [250, 1000, 2000, 5000] as const;
const HEARTBEAT_STALE_MS = 15_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 1_000;
const INTERACTIVE_REFRESH_DEBOUNCE_MS = 150;
const STATUS_POLL_INTERVAL_MS = 2_500;
const IDENTIFIER_PREFIXES = {
  session: "ses",
  message: "msg",
  permission: "per",
  question: "que",
  user: "usr",
  part: "prt",
  pty: "pty",
  tool: "tool",
  workspace: "wrk",
} as const;
const IDENTIFIER_RANDOM_LENGTH = 14;

let lastIdentifierTimestamp = 0;
let identifierCounter = 0;

function createAscendingIdentifier(prefix: keyof typeof IDENTIFIER_PREFIXES): string {
  const currentTimestamp = Date.now();
  if (currentTimestamp !== lastIdentifierTimestamp) {
    lastIdentifierTimestamp = currentTimestamp;
    identifierCounter = 0;
  }
  identifierCounter += 1;

  const encoded = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(identifierCounter);
  const timeBytes = new Uint8Array(6);
  for (let index = 0; index < timeBytes.length; index += 1) {
    timeBytes[index] = Number((encoded >> BigInt(40 - 8 * index)) & BigInt(0xff));
  }

  const timeHex = Array.from(timeBytes, (value) => value.toString(16).padStart(2, "0")).join("");
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const randomBytes = new Uint8Array(IDENTIFIER_RANDOM_LENGTH);
  crypto.getRandomValues(randomBytes);
  const randomSuffix = Array.from(randomBytes, (value) => chars[value % chars.length]).join("");

  return `${IDENTIFIER_PREFIXES[prefix]}_${timeHex}${randomSuffix}`;
}

type AgentClientRuntimeProps = {
  bootstrap: AgentBootstrap;
};

function buildChatRoute(trackedSessionID: string, matterID?: string) {
  return matterID
    ? `/agent/matters/${matterID}/chats/${trackedSessionID}`
    : `/agent/chats/${trackedSessionID}`;
}

function collectToolCallsFromMessageParts(
  partsByMessageID: Map<string, Array<MessagePartEntry>>
): Map<string, RuntimeToolCall> {
  const toolCalls = new Map<string, RuntimeToolCall>();

  for (const parts of partsByMessageID.values()) {
    for (const part of parts) {
      if (part.kind !== "tool") continue;
      toolCalls.set(part.toolCall.toolCallId, part.toolCall);
    }
  }

  return toolCalls;
}

function getResumedRunPartsByMessageID(
  messages: Array<MessageEntry>,
  partsByMessageID: Map<string, Array<MessagePartEntry>>
): Map<string, Array<MessagePartEntry>> {
  const orderedMessages = [...messages].sort(
    (left, right) =>
      left.createdAt - right.createdAt ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
  const latestUserMessage = [...orderedMessages]
    .reverse()
    .find((message) => message.role === "user");

  const relevantAssistantMessages =
    latestUserMessage !== undefined
      ? orderedMessages.filter(
          (message) =>
            message.role === "assistant" &&
            (message.parentID === latestUserMessage.id ||
              message.createdAt > latestUserMessage.createdAt)
        )
      : orderedMessages.slice(-1).filter((message) => message.role === "assistant");

  return new Map(
    relevantAssistantMessages
      .map((message) => [message.id, partsByMessageID.get(message.id) ?? []] as const)
      .filter(([, parts]) => parts.length > 0)
  );
}

function deriveRunUiPhaseFromMessageParts(
  partsByMessageID: Map<string, Array<MessagePartEntry>>
): "thinking" | "tool-active" | "assistant-output" {
  let hasRunningToolCalls = false;
  let hasRunningAssistantText = false;

  for (const parts of partsByMessageID.values()) {
    for (const part of parts) {
      if (part.kind === "tool") {
        if (part.toolCall.status === "pending" || part.toolCall.status === "running") {
          hasRunningToolCalls = true;
        }
        continue;
      }

      if (part.running) {
        hasRunningAssistantText = true;
      }
    }
  }

  if (hasRunningToolCalls) return "tool-active";
  if (hasRunningAssistantText) return "assistant-output";
  return "thinking";
}

function getLatestAssistantModelLabel(storedMessages: Array<StoredMessage>): string | undefined {
  let latestAssistant: StoredMessage | null = null;

  for (const message of storedMessages) {
    if (message.info.role !== "assistant") continue;
    if (!latestAssistant || message.info.time.created >= latestAssistant.info.time.created) {
      latestAssistant = message;
    }
  }

  if (!latestAssistant) return undefined;

  const providerID =
    typeof latestAssistant.info.providerID === "string" ? latestAssistant.info.providerID : null;
  const modelID =
    typeof latestAssistant.info.modelID === "string" ? latestAssistant.info.modelID : null;

  if (!providerID || !modelID) return undefined;
  return `${providerID}/${modelID}`;
}

function buildBootstrapSessionState(bootstrap: AgentBootstrap): {
  isHydrated: boolean;
  messages: Array<MessageEntry>;
  partsByMessageID: Map<string, Array<MessagePartEntry>>;
  timeline: Array<TimelineItem>;
  sessionStatus: "idle" | "busy" | "retry";
  storedMessages: Array<StoredMessage>;
} {
  const initialSnapshot = bootstrap.initialSessionSnapshot;
  if (!bootstrap.initialRawSessionId || !initialSnapshot?.loaded) {
    return {
      isHydrated: false,
      messages: [],
      partsByMessageID: new Map(),
      timeline: [],
      sessionStatus: "idle",
      storedMessages: [],
    };
  }

  const nextState = buildMessageStateFromStoredMessages(initialSnapshot.storedMessages);
  return {
    isHydrated: true,
    messages: nextState.messages,
    partsByMessageID: nextState.partsByMessageID,
    timeline: buildTimelineFromMessageState(nextState.messages, nextState.partsByMessageID),
    sessionStatus: initialSnapshot.status,
    storedMessages: initialSnapshot.storedMessages,
  };
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }
  if (error && typeof error === "object" && "name" in error) {
    return String((error as { name?: unknown }).name) === "AbortError";
  }
  return false;
}

export default function AgentClientRuntime({ bootstrap }: AgentClientRuntimeProps) {
  const bootstrapSessionState = buildBootstrapSessionState(bootstrap);
  const pathname = usePathname();
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [sessionID, setSessionID] = useState<string | null>(
    bootstrapSessionState.isHydrated ? bootstrap.initialRawSessionId ?? null : null
  );
  const [availableSessions, setAvailableSessions] = useState<Array<SessionOption>>(
    bootstrap.availableSessions
  );
  const [selectedSessionID, setSelectedSessionID] = useState(bootstrap.initialRawSessionId ?? "");
  const [selectedTrackedSessionID, setSelectedTrackedSessionID] = useState(
    bootstrap.initialTrackedSessionId ?? ""
  );
  const [selectedMatterID, setSelectedMatterID] = useState(bootstrap.initialMatterId ?? "");
  const [isLoadingSessionOptions, setIsLoadingSessionOptions] = useState(
    !bootstrap.availableSessionsLoaded
  );
  const [isLoadingSelectedSession, setIsLoadingSelectedSession] = useState(
    Boolean(bootstrap.initialRawSessionId) && !bootstrapSessionState.isHydrated
  );
  const [matterSessionIdsByMatterId, setMatterSessionIdsByMatterId] = useState<
    Record<string, string[]>
  >(bootstrap.matterSessionIdsByMatterId);
  const [trackedSessionsBySessionId, setTrackedSessionsBySessionId] = useState<
    Record<string, AgentBootstrapTrackedSession>
  >(bootstrap.trackedSessionsBySessionId);
  const [timeline, setTimeline] = useState<Array<TimelineItem>>(bootstrapSessionState.timeline);
  const [inputText, setInputText] = useState("");
  const [traceLines, setTraceLines] = useState<Array<string>>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<Array<QuestionRequest>>([]);
  const [pendingPermissions, setPendingPermissions] = useState<
    Array<PermissionRequest>
  >([]);
  const [questionDrafts, setQuestionDrafts] = useState<
    Record<string, Array<QuestionDraft>>
  >({});
  const [activeQuestionIndexByRequest, setActiveQuestionIndexByRequest] = useState<
    Record<string, number>
  >({});
  const [isBusy, setIsBusy] = useState(
    bootstrapSessionState.isHydrated &&
      (bootstrapSessionState.sessionStatus === "busy" ||
        bootstrapSessionState.sessionStatus === "retry")
  );
  const [runUiPhase, setRunUiPhase] = useState<
    "thinking" | "tool-active" | "assistant-output"
  >(
    bootstrapSessionState.isHydrated &&
      (bootstrapSessionState.sessionStatus === "busy" ||
        bootstrapSessionState.sessionStatus === "retry")
      ? deriveRunUiPhaseFromMessageParts(bootstrapSessionState.partsByMessageID)
      : "thinking"
  );
  const [showTrace, setShowTrace] = useState(false);
  const matters = bootstrap.matters;
  const {
    activeContextLimit,
    activeModelKey,
    assistantUsageByMessageIDRef,
    latestContextUsage,
    modelCostByKeyRef,
    rebuildSessionUsageFromStoredMessages,
    replaceModelCatalog,
    resetModelCatalog,
    resetSessionTokenTracking,
    sessionSpendTotal,
    sessionUsageTotals,
    upsertAssistantUsage,
  } = useAgentUsage({
    modelCatalog: bootstrap.modelCatalog.loaded
      ? {
          contextLimits: bootstrap.modelCatalog.contextLimits,
          costs: bootstrap.modelCatalog.costs,
        }
      : undefined,
    storedMessages: bootstrapSessionState.storedMessages,
  });

  const configuredBaseURLRef = useRef<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionIDRef = useRef<string | null>(
    bootstrapSessionState.isHydrated ? bootstrap.initialRawSessionId ?? null : null
  );
  const sdkClientRef = useRef<ReturnType<typeof createOpencodeClient> | null>(null);
  const eventStreamSupervisorAbortRef = useRef<AbortController | null>(null);
  const eventStreamAbortRef = useRef<AbortController | null>(null);
  const eventStreamTaskRef = useRef<Promise<void> | null>(null);
  const streamLastEventAtRef = useRef(0);
  const isBusyRef = useRef(false);
  const statusPollTimerRef = useRef<number | null>(null);
  const statusPollInFlightRef = useRef(false);
  const interactiveRefreshInFlightRef = useRef(false);
  const interactiveRefreshDirtyRef = useRef(false);
  const interactiveRefreshTimerRef = useRef<number | null>(null);
  const runCompletionInFlightRef = useRef<string | null>(null);
  const timelinePublishFrameRef = useRef<number | null>(null);
  const messageEntriesRef = useRef<Array<MessageEntry>>(bootstrapSessionState.messages);
  const messagePartsByMessageIDRef = useRef<Map<string, Array<MessagePartEntry>>>(
    bootstrapSessionState.partsByMessageID
  );
  const messageRoleByIDRef = useRef<Map<string, "user" | "assistant">>(new Map());
  const partTextSeenRef = useRef<Map<string, string>>(new Map());
  const toolStateSeenRef = useRef<Map<string, string>>(new Map());
  const activeAssistantServerMessageIDRef = useRef<string | null>(null);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const timelineScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pendingOptimisticUserRef = useRef<PendingOptimisticUserMessage | null>(null);
  const trackedSessionWriteInFlightRef = useRef<
    Map<string, Promise<AgentBootstrapTrackedSession>>
  >(new Map());
  const resumeRequestIDRef = useRef(0);
  const sessionOptionsRequestIDRef = useRef(0);
  const sessionOptionsAbortRef = useRef<AbortController | null>(null);
  const resumeAbortRef = useRef<AbortController | null>(null);
  const lastRouteSyncKeyRef = useRef("");

  useEffect(() => {
    sessionIDRef.current = sessionID;
  }, [sessionID]);

  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  useEffect(() => {
    let timeoutID: number | null = null;
    let innerFrameID: number | null = null;
    const outerFrameID = window.requestAnimationFrame(() => {
      innerFrameID = window.requestAnimationFrame(() => {
        composerTextareaRef.current?.focus();
        timeoutID = window.setTimeout(() => {
          composerTextareaRef.current?.focus();
        }, 40);
      });
    });

    return () => {
      window.cancelAnimationFrame(outerFrameID);
      if (innerFrameID !== null) {
        window.cancelAnimationFrame(innerFrameID);
      }
      if (timeoutID !== null) {
        window.clearTimeout(timeoutID);
      }
    };
  }, [pathname]);

  const trackedSessions = useMemo<Array<AgentBootstrapTrackedSession>>(
    () => Object.values(trackedSessionsBySessionId),
    [trackedSessionsBySessionId]
  );

  const trackedSessionsByTrackedID = useMemo<Record<string, AgentBootstrapTrackedSession>>(
    () =>
      Object.fromEntries(trackedSessions.map((trackedSession) => [trackedSession.id, trackedSession])),
    [trackedSessions]
  );
  const routeSyncKey = useMemo(
    () =>
      [
        pathname,
        bootstrap.initialMatterId ?? "",
        bootstrap.initialTrackedSessionId ?? "",
        bootstrap.initialRawSessionId ?? "",
      ].join("|"),
    [
      bootstrap.initialMatterId,
      bootstrap.initialRawSessionId,
      bootstrap.initialTrackedSessionId,
      pathname,
    ]
  );

  const flushTimelineFromMessageState = useCallback(() => {
    timelinePublishFrameRef.current = null;
    const nextTimeline = buildTimelineFromMessageState(
      messageEntriesRef.current,
      messagePartsByMessageIDRef.current
    );
    setTimeline(nextTimeline);
  }, []);

  const publishTimelineFromMessageState = useCallback(() => {
    if (timelinePublishFrameRef.current !== null) return;
    timelinePublishFrameRef.current = window.requestAnimationFrame(() => {
      flushTimelineFromMessageState();
    });
  }, [flushTimelineFromMessageState]);

  const replaceMessageState = useCallback(
    (
      messages: Array<MessageEntry>,
      partsByMessageID: Map<string, Array<MessagePartEntry>>
    ) => {
      messageEntriesRef.current = sortMessageEntries(messages);
      messagePartsByMessageIDRef.current = new Map(
        [...partsByMessageID.entries()].map(([messageID, parts]) => [
          messageID,
          sortMessagePartEntries(parts),
        ])
      );
      publishTimelineFromMessageState();
    },
    [publishTimelineFromMessageState]
  );

  const mutateMessageState = useCallback(
    (
      mutate: (
        messages: Array<MessageEntry>,
        partsByMessageID: Map<string, Array<MessagePartEntry>>
      ) => void
    ) => {
      const nextMessages = [...messageEntriesRef.current];
      const nextPartsByMessageID = new Map<string, Array<MessagePartEntry>>();
      for (const [messageID, parts] of messagePartsByMessageIDRef.current.entries()) {
        nextPartsByMessageID.set(messageID, [...parts]);
      }

      mutate(nextMessages, nextPartsByMessageID);
      replaceMessageState(nextMessages, nextPartsByMessageID);
    },
    [replaceMessageState]
  );

  const getAssistantTextForMessage = useCallback((messageID: string) => {
    return getAssistantTextFromMessageParts(messagePartsByMessageIDRef.current.get(messageID));
  }, []);

  const getTimelineViewport = useCallback(() => {
    if (!timelineScrollAreaRef.current) return null;
    return timelineScrollAreaRef.current.querySelector(
      '[data-slot="scroll-area-viewport"]'
    ) as HTMLDivElement | null;
  }, []);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({
      behavior: isBusy ? "auto" : "smooth",
      block: "end",
    });
  }, [timeline, isBusy, runUiPhase]);

  useEffect(() => {
    const viewport = getTimelineViewport();
    if (!viewport) return;

    const updateAutoScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom < 96;
    };

    updateAutoScroll();
    viewport.addEventListener("scroll", updateAutoScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", updateAutoScroll);
  }, [getTimelineViewport, sessionID]);

  const appendTrace = useCallback((line: string) => {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${line}`;
    setTraceLines((previous) => [...previous.slice(-299), formatted]);
  }, []);

  const appendUserCard = useCallback(
    (messageID: string, text: string, createdAt = Date.now(), localOnly = true) => {
      messageRoleByIDRef.current.set(messageID, "user");
      mutateMessageState((messages) => {
        messages.push({
          id: messageID,
          role: "user",
          parentID: undefined,
          createdAt,
          text,
          localOnly,
        });
      });
    },
    [mutateMessageState]
  );

  const reconcileOptimisticUserMessage = useCallback(
    (serverMessageID: string, sessionID: string, createdAt: number) => {
      const pendingOptimisticUser = pendingOptimisticUserRef.current;
      if (
        !pendingOptimisticUser ||
        (pendingOptimisticUser.sessionID !== null &&
          pendingOptimisticUser.sessionID !== sessionID)
      ) {
        return false;
      }

      let reconciled = false;
      mutateMessageState((messages, partsByMessageID) => {
        const localIndex = messages.findIndex(
          (message) =>
            message.id === pendingOptimisticUser.localMessageID &&
            message.role === "user" &&
            message.localOnly
        );
        if (localIndex < 0) return;

        const localMessage = messages[localIndex];
        const serverIndex = messages.findIndex((message) => message.id === serverMessageID);
        if (serverIndex >= 0) {
          const serverMessage = messages[serverIndex];
          if (serverMessage.role === "user") {
            messages[serverIndex] = {
              ...serverMessage,
              createdAt,
              text: serverMessage.text || localMessage.text,
              localOnly: false,
            };
          }
          messages.splice(localIndex, 1);
        } else {
          messages[localIndex] = {
            ...localMessage,
            id: serverMessageID,
            createdAt,
            localOnly: false,
          };
        }

        const localParts = partsByMessageID.get(pendingOptimisticUser.localMessageID);
        if (localParts && !partsByMessageID.has(serverMessageID)) {
          partsByMessageID.set(serverMessageID, localParts);
        }
        partsByMessageID.delete(pendingOptimisticUser.localMessageID);
        reconciled = true;
      });

      if (!reconciled) return false;

      messageRoleByIDRef.current.delete(pendingOptimisticUser.localMessageID);
      messageRoleByIDRef.current.set(serverMessageID, "user");
      pendingOptimisticUserRef.current = null;
      return true;
    },
    [mutateMessageState]
  );

  const maybeReconcileOptimisticUserFromTextPart = useCallback(
    (serverMessageID: string, sessionID: string, text: string) => {
      const pendingOptimisticUser = pendingOptimisticUserRef.current;
      if (
        !pendingOptimisticUser ||
        (pendingOptimisticUser.sessionID !== null &&
          pendingOptimisticUser.sessionID !== sessionID) ||
        text !== pendingOptimisticUser.text
      ) {
        return false;
      }

      return reconcileOptimisticUserMessage(
        serverMessageID,
        sessionID,
        pendingOptimisticUser.createdAt
      );
    },
    [reconcileOptimisticUserMessage]
  );

  const upsertAssistantMessageEntry = useCallback(
    (messageID: string, createdAt = Date.now(), parentID?: string) => {
      mutateMessageState((messages) => {
        const existing = findMessageEntry(messages, messageID);
        upsertMessageEntry(messages, {
          id: messageID,
          role: "assistant",
          parentID: existing?.parentID ?? parentID,
          createdAt: existing?.createdAt ?? createdAt,
          text: "",
          localOnly: false,
        });
      });
    },
    [mutateMessageState]
  );

  const upsertAssistantTextPart = useCallback(
    (messageID: string, partID: string, text: string, running: boolean) => {
      mutateMessageState((messages, partsByMessageID) => {
        const existing = findMessageEntry(messages, messageID);
        upsertMessageEntry(messages, {
          id: messageID,
          role: "assistant",
          parentID: existing?.parentID,
          createdAt: existing?.createdAt ?? Date.now(),
          text: "",
          localOnly: false,
        });

        const parts = partsByMessageID.get(messageID) ?? [];
        upsertMessagePart(parts, {
          id: `assistant-text-${partID}`,
          kind: "assistant-text",
          partID,
          text,
          running,
        });
        partsByMessageID.set(messageID, parts);
      });
    },
    [mutateMessageState]
  );

  const applyAssistantTextDelta = useCallback(
    (messageID: string, partID: string, delta: string) => {
      if (!delta) return;

      mutateMessageState((messages, partsByMessageID) => {
        const existing = findMessageEntry(messages, messageID);
        upsertMessageEntry(messages, {
          id: messageID,
          role: "assistant",
          parentID: existing?.parentID,
          createdAt: existing?.createdAt ?? Date.now(),
          text: "",
          localOnly: false,
        });

        const parts = partsByMessageID.get(messageID) ?? [];
        const index = parts.findIndex((part) => part.partID === partID);
        const previous = index >= 0 ? parts[index] : null;
        const currentText =
          previous?.kind === "assistant-text" ? previous.text : "";

        upsertMessagePart(parts, {
          id: `assistant-text-${partID}`,
          kind: "assistant-text",
          partID,
          text: `${currentText}${delta}`,
          running: true,
        });
        partsByMessageID.set(messageID, parts);
      });
    },
    [mutateMessageState]
  );

  const upsertToolCard = useCallback(
    (messageID: string, partID: string, toolCall: RuntimeToolCall) => {
      mutateMessageState((messages, partsByMessageID) => {
        const existing = findMessageEntry(messages, messageID);
        upsertMessageEntry(messages, {
          id: messageID,
          role: "assistant",
          parentID: existing?.parentID,
          createdAt: existing?.createdAt ?? Date.now(),
          text: "",
          localOnly: false,
        });

        const parts = partsByMessageID.get(messageID) ?? [];
        upsertMessagePart(parts, {
          id: `tool-${partID}`,
          kind: "tool",
          partID,
          toolCall,
        });
        partsByMessageID.set(messageID, parts);
      });
    },
    [mutateMessageState]
  );

  const markAssistantCardsComplete = useCallback(() => {
    mutateMessageState((_, partsByMessageID) => {
      for (const [messageID, parts] of partsByMessageID.entries()) {
        const nextParts = parts.map((part) =>
          part.kind === "assistant-text" && part.running
            ? { ...part, running: false }
            : part
        );
        partsByMessageID.set(messageID, nextParts);
      }
    });
  }, [mutateMessageState]);

  const ensureClients = useCallback(() => {
    if (
      sessionIDRef.current &&
      configuredBaseURLRef.current !== null &&
      configuredBaseURLRef.current !== baseUrl
    ) {
      throw new Error(
        "Cannot change base URL while a session is active. Start a new session first."
      );
    }

    if (configuredBaseURLRef.current === baseUrl && sdkClientRef.current) {
      return;
    }

    sdkClientRef.current = createOpencodeClient({ baseUrl });
    configuredBaseURLRef.current = baseUrl;
    resetModelCatalog();
  }, [baseUrl, resetModelCatalog]);

  const applyModelCatalogSnapshot = useCallback(
    (catalog: AgentBootstrap["modelCatalog"]) => {
      if (!catalog.loaded) return false;
      replaceModelCatalog(
        new Map<string, number>(Object.entries(catalog.contextLimits)),
        new Map<string, ModelCostInfo>(Object.entries(catalog.costs))
      );
      return true;
    },
    [replaceModelCatalog]
  );

  const refreshModelContextLimits = useCallback(async () => {
    try {
      ensureClients();
      const client = sdkClientRef.current;
      if (!client) return;

      const result = await client.provider.list();
      if (result.error) {
        const message = getAssistantError(result.error);
        if (message) appendTrace(`provider metadata error: ${message}`);
        return;
      }

      const nextLimits = new Map<string, number>();
      const nextCosts = new Map<string, ModelCostInfo>();
      for (const provider of result.data?.all ?? []) {
        const providerID = provider.id;
        const models = provider.models ?? {};

        for (const model of Object.values(models)) {
          const modelKey = getModelKey(providerID, model.id);
          const contextLimit = model.limit?.context;
          if (typeof contextLimit === "number" && Number.isFinite(contextLimit)) {
            nextLimits.set(modelKey, Math.max(0, Math.floor(contextLimit)));
          }

          const costInfo = toModelCostInfo(model.cost);
          if (costInfo) nextCosts.set(modelKey, costInfo);
        }
      }
      replaceModelCatalog(nextLimits, nextCosts);
    } catch (error) {
      appendTrace(`provider metadata error: ${toErrorMessage(error)}`);
    }
  }, [appendTrace, ensureClients, replaceModelCatalog]);

  const refreshPendingInteractiveRequests = useCallback(async () => {
    if (interactiveRefreshInFlightRef.current) {
      interactiveRefreshDirtyRef.current = true;
      return;
    }

    const client = sdkClientRef.current;
    const currentSessionID = sessionIDRef.current;
    if (!client || !currentSessionID) {
      setPendingQuestions([]);
      setPendingPermissions([]);
      return;
    }

    interactiveRefreshInFlightRef.current = true;
    try {
      const [questionResult, permissionResult] = await Promise.all([
        client.question.list(),
        client.permission.list(),
      ]);

      if (sessionIDRef.current !== currentSessionID) return;

      const sessionQuestions = (questionResult.data ?? []).filter(
        (request) => request.sessionID === currentSessionID
      );
      const sessionPermissions = (permissionResult.data ?? []).filter(
        (request) => request.sessionID === currentSessionID
      );

      setPendingQuestions(sessionQuestions);
      setPendingPermissions(sessionPermissions);
    } catch (error) {
      appendTrace(`interactive control error: ${toErrorMessage(error)}`);
    } finally {
      interactiveRefreshInFlightRef.current = false;
      if (interactiveRefreshDirtyRef.current) {
        interactiveRefreshDirtyRef.current = false;
        void refreshPendingInteractiveRequests();
      }
    }
  }, [appendTrace]);

  const scheduleInteractiveRefresh = useCallback(
    (delayMs = INTERACTIVE_REFRESH_DEBOUNCE_MS) => {
      if (interactiveRefreshTimerRef.current !== null) {
        window.clearTimeout(interactiveRefreshTimerRef.current);
      }
      interactiveRefreshTimerRef.current = window.setTimeout(() => {
        interactiveRefreshTimerRef.current = null;
        void refreshPendingInteractiveRequests();
      }, delayMs);
    },
    [refreshPendingInteractiveRequests]
  );

  const getLatestAssistantText = useCallback(async (targetSessionID: string) => {
    const client = sdkClientRef.current;
    if (!client) return "";

    const { data: sessionMessages } = await client.session.messages({
      sessionID: targetSessionID,
      limit: 50,
    });

    if (!sessionMessages?.length) return "";

    const latestAssistant = [...sessionMessages]
      .reverse()
      .find((message) => message.info.role === "assistant");

    if (!latestAssistant) return "";

    return sortStoredParts(latestAssistant.parts)
      .filter(
        (part): part is Extract<Part, { type: "text" }> => part.type === "text"
      )
      .map((part) => part.text)
      .join("");
  }, []);

  const rebuildEventCachesFromMessageState = useCallback(
    (
      messages: Array<MessageEntry>,
      partsByMessageID: Map<string, Array<MessagePartEntry>>
    ) => {
      messageRoleByIDRef.current.clear();
      partTextSeenRef.current.clear();
      toolStateSeenRef.current.clear();
      activeAssistantServerMessageIDRef.current = null;

      for (const message of sortMessageEntries(messages)) {
        messageRoleByIDRef.current.set(message.id, message.role);
        if (message.role === "assistant") {
          activeAssistantServerMessageIDRef.current = message.id;
        }

        const parts = sortMessagePartEntries(partsByMessageID.get(message.id) ?? []);
        for (const part of parts) {
          if (part.kind === "assistant-text") {
            partTextSeenRef.current.set(part.partID, part.text);
            continue;
          }

          toolStateSeenRef.current.set(
            part.partID,
            getToolCallCacheSignature(part.toolCall)
          );
        }
      }
    },
    []
  );

  const reconcileMessageStateWithStoredMessages = useCallback(
    (
      storedMessages: Array<StoredMessage>,
      preserveLive: boolean
    ): {
      messages: Array<MessageEntry>;
      partsByMessageID: Map<string, Array<MessagePartEntry>>;
      latestAssistantText: string;
    } => {
      const nextState = buildMessageStateFromStoredMessages(storedMessages);
      const pendingOptimisticUser = pendingOptimisticUserRef.current;
      const matchedPendingStoredUserID =
        pendingOptimisticUser === null
          ? null
          : [...nextState.messages]
              .reverse()
              .find(
                (message) =>
                  message.role === "user" && message.text === pendingOptimisticUser.text
              )?.id ?? null;

      if (!preserveLive) return nextState;

      const storedMessageIDs = new Set(nextState.messages.map((message) => message.id));

      for (const message of messageEntriesRef.current) {
        if (message.role === "user") {
          if (
            pendingOptimisticUser &&
            matchedPendingStoredUserID &&
            message.id === pendingOptimisticUser.localMessageID
          ) {
            pendingOptimisticUserRef.current = null;
            continue;
          }
          if (!storedMessageIDs.has(message.id)) {
            upsertMessageEntry(nextState.messages, message);
            storedMessageIDs.add(message.id);
          }
          continue;
        }

        const liveParts = messagePartsByMessageIDRef.current.get(message.id);
        if (!liveParts?.length) continue;

        if (!storedMessageIDs.has(message.id)) {
          upsertMessageEntry(nextState.messages, message);
          storedMessageIDs.add(message.id);
          nextState.partsByMessageID.set(message.id, [...liveParts]);
          continue;
        }

        const storedParts = nextState.partsByMessageID.get(message.id) ?? [];
        const mergedParts = [...storedParts];

        for (const livePart of liveParts) {
          const existingIndex = mergedParts.findIndex(
            (storedPart) => storedPart.partID === livePart.partID
          );
          if (existingIndex < 0) {
            mergedParts.push(livePart);
            continue;
          }

          const storedPart = mergedParts[existingIndex];
          if (storedPart.kind === "tool" && livePart.kind === "tool") {
            mergedParts[existingIndex] = {
              ...storedPart,
              toolCall: preferMoreCompleteToolCall(storedPart.toolCall, livePart.toolCall),
            };
            continue;
          }

          if (
            storedPart.kind === "assistant-text" &&
            livePart.kind === "assistant-text"
          ) {
            const mergedText = livePart.text.startsWith(storedPart.text)
              ? livePart.text
              : storedPart.text.startsWith(livePart.text)
                ? storedPart.text
                : storedPart.text;

            mergedParts[existingIndex] = {
              ...storedPart,
              text: mergedText,
              running: storedPart.running || livePart.running,
            };
          }
        }

        nextState.partsByMessageID.set(message.id, mergedParts);
      }

      const latestAssistantMessage = [...sortMessageEntries(nextState.messages)]
        .reverse()
        .find((message) => message.role === "assistant");

      return {
        ...nextState,
        latestAssistantText: latestAssistantMessage
          ? getAssistantTextFromMessageParts(
              nextState.partsByMessageID.get(latestAssistantMessage.id)
            )
          : "",
      };
    },
    []
  );

  const applySessionSnapshot = useCallback(
    (storedMessages: Array<StoredMessage>, preserveLive: boolean) => {
      const reconciled = reconcileMessageStateWithStoredMessages(storedMessages, preserveLive);
      replaceMessageState(reconciled.messages, reconciled.partsByMessageID);
      rebuildSessionUsageFromStoredMessages(storedMessages);
      rebuildEventCachesFromMessageState(reconciled.messages, reconciled.partsByMessageID);
      return reconciled.latestAssistantText;
    },
    [
      reconcileMessageStateWithStoredMessages,
      rebuildEventCachesFromMessageState,
      rebuildSessionUsageFromStoredMessages,
      replaceMessageState,
    ]
  );

  const resyncActiveSession = useCallback(
    async (reason: string) => {
      const currentSessionID = sessionIDRef.current;
      const client = sdkClientRef.current;
      if (!client || !currentSessionID) return;

      try {
        const messagesResult = await client.session.messages({
          sessionID: currentSessionID,
          limit: 1000,
        });
        if (messagesResult.error) {
          throw new Error(
            getAssistantError(messagesResult.error) ?? "Failed to reload session messages"
          );
        }

        if (sessionIDRef.current !== currentSessionID) return;
        const storedMessages = (messagesResult.data ?? []) as Array<StoredMessage>;
        const currentRun = activeRunRef.current;
        const localUserCount = messageEntriesRef.current.reduce(
          (count, message) => (message.role === "user" ? count + 1 : count),
          0
        );
        const preserveLive =
          isBusyRef.current &&
          currentRun !== null &&
          currentRun.sessionID === currentSessionID;
        const latestAssistantText = applySessionSnapshot(storedMessages, preserveLive);

        if (currentRun && currentRun.sessionID === currentSessionID) {
          if (didSnapshotCaptureActiveRun(storedMessages, localUserCount)) {
            currentRun.startObserved = true;
          }
          currentRun.assistantText = mergeAssistantText(
            currentRun.assistantText,
            latestAssistantText
          );
        } else {
          markAssistantCardsComplete();
        }

        scheduleInteractiveRefresh(0);

        appendTrace(`session resynced (${reason})`);
      } catch (error) {
        appendTrace(`session resync error (${reason}): ${toErrorMessage(error)}`);
      }
    },
    [
      applySessionSnapshot,
      appendTrace,
      scheduleInteractiveRefresh,
    ]
  );

  const finalizeActiveRun = useCallback(
    async (
      targetRunID: string,
      targetSessionID: string,
      trigger: "session.idle" | "session.status.idle" | "status-poll"
    ) => {
      const activeRun = activeRunRef.current;
      if (!activeRun || activeRun.id !== targetRunID || activeRun.sessionID !== targetSessionID) {
        return;
      }
      if (runCompletionInFlightRef.current === targetRunID) return;

      const requiresCanonicalRefresh =
        trigger !== "session.idle" || activeRun.pollRecoveryEligible;
      runCompletionInFlightRef.current = targetRunID;
      try {
        if (requiresCanonicalRefresh) {
          const client = sdkClientRef.current;
          if (!client) throw new Error("OpenCode client is not initialized");

          const messagesResult = await client.session.messages({
            sessionID: targetSessionID,
            limit: 1000,
          });
          if (messagesResult.error) {
            throw new Error(
              getAssistantError(messagesResult.error) ?? "Failed to reload session messages"
            );
          }

          const currentRun = activeRunRef.current;
          if (
            !currentRun ||
            currentRun.id !== targetRunID ||
            currentRun.sessionID !== targetSessionID
          ) {
            return;
          }

          const storedMessages = (messagesResult.data ?? []) as Array<StoredMessage>;
          const localUserCount = messageEntriesRef.current.reduce(
            (count, message) => (message.role === "user" ? count + 1 : count),
            0
          );
          const snapshotCapturedActiveRun = didSnapshotCaptureActiveRun(
            storedMessages,
            localUserCount
          );
          if (
            trigger !== "session.idle" &&
            !currentRun.startObserved &&
            !snapshotCapturedActiveRun
          ) {
            currentRun.pollRecoveryEligible = true;
            return;
          }
          if (snapshotCapturedActiveRun) {
            currentRun.startObserved = true;
          }

          const latestAssistantText = getLatestAssistantSnapshot(storedMessages).text;
          const mergedAssistantText = mergeAssistantText(
            currentRun.assistantText,
            latestAssistantText
          );
          currentRun.assistantText = mergedAssistantText;

          applySessionSnapshot(storedMessages, true);
        } else if (!activeRun.assistantText.trim()) {
          const fallbackText = await getLatestAssistantText(targetSessionID);
          const currentRun = activeRunRef.current;
          if (
            !currentRun ||
            currentRun.id !== targetRunID ||
            currentRun.sessionID !== targetSessionID
          ) {
            return;
          }
          if (fallbackText) {
            currentRun.assistantText = fallbackText;
            const fallbackMessageID =
              activeAssistantServerMessageIDRef.current ??
              createAscendingIdentifier("message");
            upsertAssistantMessageEntry(fallbackMessageID);
            upsertAssistantTextPart(
              fallbackMessageID,
              `fallback-${targetRunID}`,
              fallbackText,
              false
            );
          }
        }

        const currentRun = activeRunRef.current;
        if (
          !currentRun ||
          currentRun.id !== targetRunID ||
          currentRun.sessionID !== targetSessionID
        ) {
          return;
        }

        markAssistantCardsComplete();
        appendTrace(
          currentRun.model
            ? `turn finished [model: ${currentRun.model}]${
                trigger === "session.idle" ? "" : ` (${trigger})`
              }`
            : `turn finished${trigger === "session.idle" ? "" : ` (${trigger})`}`
        );
        currentRun.finish();
        scheduleInteractiveRefresh(0);
      } catch (error) {
        const currentRun = activeRunRef.current;
        if (
          currentRun &&
          currentRun.id === targetRunID &&
          currentRun.sessionID === targetSessionID
        ) {
          appendTrace(`turn finalization error: ${toErrorMessage(error)}`);
          if (requiresCanonicalRefresh) {
            currentRun.pollRecoveryEligible = true;
            return;
          }
          markAssistantCardsComplete();
          currentRun.finish();
        }
      } finally {
        if (runCompletionInFlightRef.current === targetRunID) {
          runCompletionInFlightRef.current = null;
        }
      }
    },
    [
      applySessionSnapshot,
      appendTrace,
      getLatestAssistantText,
      markAssistantCardsComplete,
      scheduleInteractiveRefresh,
      upsertAssistantMessageEntry,
      upsertAssistantTextPart,
    ]
  );

  const pollActiveRunStatus = useCallback(async () => {
    if (statusPollInFlightRef.current) return;

    const activeRun = activeRunRef.current;
    const client = sdkClientRef.current;
    if (!activeRun || !client) return;
    const targetRunID = activeRun.id;
    const targetSessionID = activeRun.sessionID;

    statusPollInFlightRef.current = true;
    try {
      const statusResult = await client.session.status();
      if (statusResult.error) {
        throw new Error(getAssistantError(statusResult.error) ?? "Failed to poll session status");
      }

      const currentRun = activeRunRef.current;
      if (
        !currentRun ||
        currentRun.id !== targetRunID ||
        currentRun.sessionID !== targetSessionID
      ) {
        return;
      }

      const statusBySession = statusResult.data ?? {};
      const status = statusBySession[targetSessionID] ?? { type: "idle" };
      if (status?.type === "busy" || status?.type === "retry") {
        currentRun.startObserved = true;
        return;
      }

      if (status.type === "idle") {
        void finalizeActiveRun(targetRunID, targetSessionID, "status-poll");
      }
    } catch (error) {
      appendTrace(`session status poll error: ${toErrorMessage(error)}`);
    } finally {
      statusPollInFlightRef.current = false;
    }
  }, [appendTrace, finalizeActiveRun]);

  const processEvent = useCallback(
    (event: AgentEvent) => {
      const currentSessionID = sessionIDRef.current;
      const activeRun = activeRunRef.current;
      const eventType = event.type as string;

      if (event.type === "message.updated") {
        const info = event.properties.info;
        if (!currentSessionID || info.sessionID !== currentSessionID) return;

        messageRoleByIDRef.current.set(info.id, info.role);
        const createdAt = getCreatedAt(info as Record<string, unknown>);
        if (info.role === "user") {
          if (reconcileOptimisticUserMessage(info.id, info.sessionID, createdAt)) {
            return;
          }
          mutateMessageState((messages) => {
            const existing = findMessageEntry(messages, info.id);
            upsertMessageEntry(messages, {
              id: info.id,
              role: "user",
              parentID: undefined,
              createdAt,
              text: existing?.role === "user" ? existing.text : "",
              localOnly: false,
            });
          });
          return;
        }

        upsertAssistantMessageEntry(
          info.id,
          createdAt,
          "parentID" in info && typeof info.parentID === "string"
            ? String(info.parentID)
            : undefined
        );
        activeAssistantServerMessageIDRef.current = info.id;

        const usageSnapshot = parseAssistantUsageFromInfo(info as Record<string, unknown>);
        if (usageSnapshot) {
          upsertAssistantUsage(usageSnapshot);
        }

        if (activeRun && activeRun.sessionID === info.sessionID) {
          activeRun.startObserved = true;
          const provider = "providerID" in info ? String(info.providerID) : "unknown";
          const model = "modelID" in info ? String(info.modelID) : "unknown";
          activeRun.model = `${provider}/${model}`;

          const assistantError = getAssistantError(
            "error" in info ? info.error : undefined
          );
          if (assistantError) appendTrace(`assistant error: ${assistantError}`);
        }
        return;
      }

      if (event.type === "message.part.delta") {
        const { sessionID, messageID, partID, field, delta } = event.properties;
        if (!currentSessionID || sessionID !== currentSessionID) return;
        if (field !== "text" || !delta) return;
        if (activeRun && activeRun.sessionID === sessionID) {
          activeRun.startObserved = true;
        }

        const messageRole = messageRoleByIDRef.current.get(messageID);
        const existingMessage = findMessageEntry(messageEntriesRef.current, messageID);
        if (messageRole === "user" || existingMessage?.role === "user") {
          mutateMessageState((messages) => {
            updateUserMessageText(messages, messageID, delta, "append");
          });
          return;
        }

        activeAssistantServerMessageIDRef.current = messageID;
        applyAssistantTextDelta(messageID, partID, delta);
        const nextText = getAssistantTextForMessage(messageID);
        partTextSeenRef.current.set(partID, nextText);
        if (activeRun && activeRun.sessionID === sessionID) {
          activeRun.assistantText = nextText;
          setRunUiPhase("assistant-output");
        }
        return;
      }

      if (event.type === "message.part.updated") {
        const {
          part,
          delta,
        } = event.properties as {
          part: AgentPart;
          delta?: string;
        };
        if (!currentSessionID || part.sessionID !== currentSessionID) return;
        if (activeRun && activeRun.sessionID === part.sessionID) {
          activeRun.startObserved = true;
        }

        if (part.type === "text") {
          if (maybeReconcileOptimisticUserFromTextPart(part.messageID, part.sessionID, part.text)) {
            mutateMessageState((messages) => {
              updateUserMessageText(messages, part.messageID, part.text, "replace");
            });
            return;
          }

          const messageRole = messageRoleByIDRef.current.get(part.messageID);
          const existingMessage = findMessageEntry(messageEntriesRef.current, part.messageID);
          if (messageRole === "user" || existingMessage?.role === "user") {
            mutateMessageState((messages) => {
              updateUserMessageText(messages, part.messageID, part.text, "replace");
            });
            return;
          }
          activeAssistantServerMessageIDRef.current = part.messageID;

          if (typeof delta === "string" && delta.length > 0) {
            applyAssistantTextDelta(part.messageID, part.id, delta);
            const nextText = getAssistantTextForMessage(part.messageID);
            partTextSeenRef.current.set(part.id, nextText);
            if (activeRun && activeRun.sessionID === part.sessionID) {
              activeRun.assistantText = nextText;
              setRunUiPhase("assistant-output");
            }
            return;
          }

          upsertAssistantTextPart(
            part.messageID,
            part.id,
            part.text,
            isTextPartRunning(part)
          );
          partTextSeenRef.current.set(part.id, part.text);
          if (activeRun && activeRun.sessionID === part.sessionID) {
            activeRun.assistantText = getAssistantTextForMessage(part.messageID);
            if (part.text || isTextPartRunning(part)) {
              setRunUiPhase("assistant-output");
            }
          }
          return;
        }

        if (part.type === "tool") {
          const signature = getToolSignature(part);
          if (toolStateSeenRef.current.get(part.id) !== signature) {
            toolStateSeenRef.current.set(part.id, signature);
            appendTrace(formatToolUpdate(part));
          }

          const previous =
            activeRun && activeRun.sessionID === part.sessionID
              ? activeRun.toolCalls.get(String(part.callID ?? part.id))
              : undefined;
          const next = toRuntimeToolCall(part, previous);
          upsertToolCard(part.messageID, part.id, next);

          if (activeRun && activeRun.sessionID === part.sessionID) {
            activeRun.toolCalls.set(next.toolCallId, next);
            const hasRunningToolCalls = [...activeRun.toolCalls.values()].some(
              (toolCall) => toolCall.status === "pending" || toolCall.status === "running"
            );
            setRunUiPhase(hasRunningToolCalls ? "tool-active" : "thinking");
          }

          if (part.tool === "question" || part.tool === "permission") {
            scheduleInteractiveRefresh();
          }

          return;
        }

        if (part.type === "step-start") {
          appendTrace("step started");
          return;
        }

        if (part.type === "step-finish") {
          appendTrace(`step finished: ${part.reason}`);
          return;
        }

        if (part.type === "subtask") {
          appendTrace(`subtask: ${part.description}`);
          return;
        }

        if (part.type === "agent") {
          appendTrace(`agent selected: ${part.name}`);
          return;
        }

        if (part.type === "patch") {
          appendTrace(
            `patch generated: ${part.files.length} file(s) | ${part.files.join(", ")}`
          );
        }

        return;
      }

      if (event.type === "message.part.removed") {
        if (!currentSessionID || event.properties.sessionID !== currentSessionID) return;

        mutateMessageState((_, partsByMessageID) => {
          const parts = partsByMessageID.get(event.properties.messageID);
          if (!parts) return;
          const nextParts = parts.filter((part) => part.partID !== event.properties.partID);
          if (nextParts.length === 0) {
            partsByMessageID.delete(event.properties.messageID);
            return;
          }
          partsByMessageID.set(event.properties.messageID, nextParts);
        });
        return;
      }

      if (event.type === "message.removed") {
        if (!currentSessionID || event.properties.sessionID !== currentSessionID) return;

        mutateMessageState((messages, partsByMessageID) => {
          const nextMessages = messages.filter((message) => message.id !== event.properties.messageID);
          messages.splice(0, messages.length, ...nextMessages);
          partsByMessageID.delete(event.properties.messageID);
        });
        return;
      }

      if (event.type === "command.executed") {
        const args = event.properties.arguments?.trim();
        const command = args
          ? `/${event.properties.name} ${args}`
          : `/${event.properties.name}`;
        appendTrace(`command executed: ${command}`);
        return;
      }

      if (event.type === "pty.created") {
        const info = event.properties.info;
        const command = [info.command, ...info.args].join(" ").trim();
        appendTrace(
          `terminal started (${info.id}) status=${info.status} cmd=${
            command || "(none)"
          }`
        );
        return;
      }

      if (event.type === "pty.updated") {
        appendTrace(
          `terminal status (${event.properties.info.id}): ${event.properties.info.status}`
        );
        return;
      }

      if (event.type === "pty.exited") {
        appendTrace(
          `terminal exited (${event.properties.id}) code=${event.properties.exitCode}`
        );
        return;
      }

      if (event.type === "session.error") {
        const message = getAssistantError(event.properties.error) ?? "Unknown error";
        appendTrace(`session error: ${message}`);

        if (
          activeRun &&
          (!event.properties.sessionID || event.properties.sessionID === activeRun.sessionID)
        ) {
          activeRun.fail(new Error(message));
        }
        return;
      }

      if (event.type === "session.diff") {
        const summary = event.properties.diff
          .map(
            (file: { file: string; additions: number; deletions: number }) =>
              `${file.file}(+${file.additions}/-${file.deletions})`
          )
          .join(", ");
        appendTrace(`session diff: ${summary || "no changes"}`);
        return;
      }

      if (event.type === "file.edited") {
        appendTrace(`file edited: ${event.properties.file}`);
        return;
      }

      if (event.type === "todo.updated") {
        const counts = event.properties.todos.reduce(
          (
            accumulator: { total: number; completed: number; inProgress: number },
            todo: { status: string }
          ) => {
            accumulator.total += 1;
            if (todo.status === "completed") accumulator.completed += 1;
            if (todo.status === "in_progress") accumulator.inProgress += 1;
            return accumulator;
          },
          { total: 0, completed: 0, inProgress: 0 }
        );

        appendTrace(
          `todo updated: total=${counts.total} in_progress=${counts.inProgress} completed=${counts.completed}`
        );
        return;
      }

      if (eventType === "permission.updated" || eventType === "permission.asked") {
        const details = event.properties as Record<string, unknown>;
        const id = typeof details.id === "string" ? details.id : "unknown";
        const pattern =
          details.pattern === undefined
            ? ""
            : ` pattern=${toCompactJSON(details.pattern, 120)}`;
        appendTrace(`permission requested (${id})${pattern}`);
        scheduleInteractiveRefresh();
        return;
      }

      if (event.type === "permission.replied") {
        const details = event.properties as Record<string, unknown>;
        const requestID =
          typeof details.permissionID === "string"
            ? details.permissionID
            : typeof details.requestID === "string"
              ? details.requestID
              : "unknown";
        const response =
          typeof details.response === "string"
            ? details.response
            : typeof details.reply === "string"
              ? details.reply
              : "unknown";
        appendTrace(
          `permission replied (${requestID}): ${response}`
        );
        scheduleInteractiveRefresh();
        return;
      }

      if (event.type === "session.status") {
        if (activeRun && activeRun.sessionID === event.properties.sessionID) {
          if (
            event.properties.status.type === "busy" ||
            event.properties.status.type === "retry"
          ) {
            activeRun.startObserved = true;
          }
        }

        if (event.properties.status.type === "retry") {
          appendTrace(
            `session status: retry attempt=${event.properties.status.attempt} next=${event.properties.status.next}`
          );
        } else {
          appendTrace(`session status: ${event.properties.status.type}`);
        }

        if (
          event.properties.status.type === "idle" &&
          activeRun &&
          activeRun.sessionID === event.properties.sessionID
        ) {
          void finalizeActiveRun(activeRun.id, event.properties.sessionID, "session.status.idle");
        }

        return;
      }

      if (event.type === "session.idle") {
        if (!activeRun || activeRun.sessionID !== event.properties.sessionID) return;
        void finalizeActiveRun(activeRun.id, event.properties.sessionID, "session.idle");
        return;
      }

      if (eventType.startsWith("permission.") || eventType.startsWith("question.")) {
        scheduleInteractiveRefresh();
      }
    },
    [
      applyAssistantTextDelta,
      appendTrace,
      finalizeActiveRun,
      getAssistantTextForMessage,
      maybeReconcileOptimisticUserFromTextPart,
      mutateMessageState,
      reconcileOptimisticUserMessage,
      scheduleInteractiveRefresh,
      upsertAssistantMessageEntry,
      upsertAssistantTextPart,
      upsertAssistantUsage,
      upsertToolCard,
    ]
  );

  const ensureEventStream = useCallback(async () => {
    if (eventStreamTaskRef.current) return;

    const supervisor = new AbortController();
    eventStreamSupervisorAbortRef.current = supervisor;
    let task: Promise<void> | null = null;
    task = (async () => {
      let reconnectDelayIndex = 0;
      let hasConnectedOnce = false;

      while (!supervisor.signal.aborted) {
        const client = sdkClientRef.current;
        if (!client) {
          await waitFor(RECONNECT_DELAYS_MS[0], supervisor.signal);
          continue;
        }

        const controller = new AbortController();
        eventStreamAbortRef.current = controller;
        let connectedThisAttempt = false;
        let heartbeatTimer: number | null = null;

        try {
          const subscription = await client.event.subscribe(undefined, {
            signal: controller.signal,
          });
          const stream = subscription.stream as AsyncIterable<StreamEvent>;
          connectedThisAttempt = true;
          appendTrace(hasConnectedOnce ? "event stream reconnected" : "event stream connected");
          streamLastEventAtRef.current = Date.now();

          if (hasConnectedOnce) {
            void resyncActiveSession("reconnect");
          }

          heartbeatTimer = window.setInterval(() => {
            if (controller.signal.aborted || supervisor.signal.aborted) return;
            if (!isBusyRef.current) return;
            const staleMs = Date.now() - streamLastEventAtRef.current;
            if (staleMs < HEARTBEAT_STALE_MS) return;
            if (activeRunRef.current) {
              activeRunRef.current.pollRecoveryEligible = true;
            }
            appendTrace(
              `event stream stale (${Math.floor(staleMs / 1000)}s without events), reconnecting`
            );
            controller.abort();
          }, HEARTBEAT_CHECK_INTERVAL_MS);

          let sawFirstEvent = false;
          for await (const rawEvent of stream) {
            streamLastEventAtRef.current = Date.now();
            if (!sawFirstEvent) {
              sawFirstEvent = true;
              reconnectDelayIndex = 0;
            }
            processEvent(normalizeEvent(rawEvent));
          }

          if (!controller.signal.aborted) {
            if (isBusyRef.current && activeRunRef.current) {
              activeRunRef.current.pollRecoveryEligible = true;
            }
            appendTrace("event stream closed");
          }
        } catch (error) {
          if (!controller.signal.aborted && !supervisor.signal.aborted) {
            if (isBusyRef.current && activeRunRef.current) {
              activeRunRef.current.pollRecoveryEligible = true;
            }
            appendTrace(`event stream error: ${toErrorMessage(error)}`);
          }
        } finally {
          if (heartbeatTimer !== null) {
            window.clearInterval(heartbeatTimer);
          }
          if (eventStreamAbortRef.current === controller) {
            eventStreamAbortRef.current = null;
          }
        }

        if (connectedThisAttempt) {
          hasConnectedOnce = true;
        }

        if (supervisor.signal.aborted) break;
        const delayMs =
          RECONNECT_DELAYS_MS[
            Math.min(reconnectDelayIndex, RECONNECT_DELAYS_MS.length - 1)
          ];
        reconnectDelayIndex = Math.min(
          reconnectDelayIndex + 1,
          RECONNECT_DELAYS_MS.length - 1
        );
        appendTrace(`event stream reconnecting in ${delayMs}ms`);
        await waitFor(delayMs, supervisor.signal);
      }
    })().finally(() => {
      if (eventStreamSupervisorAbortRef.current === supervisor) {
        eventStreamSupervisorAbortRef.current = null;
      }
      if (eventStreamTaskRef.current === task) {
        eventStreamTaskRef.current = null;
      }
    });

    eventStreamTaskRef.current = task;
  }, [appendTrace, processEvent, resyncActiveSession]);

  const hydrateSessionFromBootstrap = useCallback(
    async (
      targetSessionID: string,
      snapshot: NonNullable<AgentBootstrap["initialSessionSnapshot"]>
    ) => {
      const resumeRequestID = ++resumeRequestIDRef.current;
      const isCurrentResumeRequest = () => resumeRequestIDRef.current === resumeRequestID;

      resumeAbortRef.current?.abort();
      resumeAbortRef.current = null;

      setErrorText(null);
      setIsBusy(false);
      setIsLoadingSelectedSession(false);
      setSessionID(null);
      setSelectedSessionID(targetSessionID);
      setRunUiPhase("thinking");

      sessionIDRef.current = null;
      messageEntriesRef.current = [];
      messagePartsByMessageIDRef.current = new Map();
      pendingOptimisticUserRef.current = null;
      partTextSeenRef.current.clear();
      toolStateSeenRef.current.clear();
      activeAssistantServerMessageIDRef.current = null;
      activeRunRef.current = null;
      runCompletionInFlightRef.current = null;
      statusPollInFlightRef.current = false;
      setPendingQuestions([]);
      setPendingPermissions([]);
      setQuestionDrafts({});
      setActiveQuestionIndexByRequest({});
      resetSessionTokenTracking();

      const storedMessages = snapshot.storedMessages;
      const nextState = buildMessageStateFromStoredMessages(storedMessages);
      const localUserCount = nextState.messages.reduce(
        (count, message) => (message.role === "user" ? count + 1 : count),
        0
      );

      rebuildSessionUsageFromStoredMessages(storedMessages);
      rebuildEventCachesFromMessageState(nextState.messages, nextState.partsByMessageID);
      shouldAutoScrollRef.current = true;
      replaceMessageState(nextState.messages, nextState.partsByMessageID);

      sessionIDRef.current = targetSessionID;
      setSessionID(targetSessionID);
      setSelectedSessionID(targetSessionID);

      if (snapshot.status === "busy" || snapshot.status === "retry") {
        const resumedRunPartsByMessageID = getResumedRunPartsByMessageID(
          nextState.messages,
          nextState.partsByMessageID
        );
        const runID = crypto.randomUUID();
        const fail = (error: Error) => {
          if (activeRunRef.current?.id === runID) {
            activeRunRef.current = null;
          }
          setIsBusy(false);
          setErrorText(error.message);
          markAssistantCardsComplete();
        };

        const finish = () => {
          if (activeRunRef.current?.id === runID) {
            activeRunRef.current = null;
          }
          setIsBusy(false);
        };

        activeRunRef.current = {
          id: runID,
          sessionID: targetSessionID,
          assistantText: "",
          startObserved: didSnapshotCaptureActiveRun(storedMessages, localUserCount),
          pollRecoveryEligible: true,
          model: getLatestAssistantModelLabel(storedMessages),
          toolCalls: collectToolCallsFromMessageParts(resumedRunPartsByMessageID),
          fail,
          finish,
        };
        streamLastEventAtRef.current = Date.now();
        setIsBusy(true);
        setRunUiPhase(deriveRunUiPhaseFromMessageParts(resumedRunPartsByMessageID));
      } else {
        activeRunRef.current = null;
        markAssistantCardsComplete();
        setIsBusy(false);
        setRunUiPhase("thinking");
      }

      appendTrace(`session hydrated from server: ${targetSessionID} [status: ${snapshot.status}]`);
      scheduleInteractiveRefresh(0);

      try {
        ensureClients();
        await ensureEventStream();
        if (!bootstrap.modelCatalog.loaded) {
          await refreshModelContextLimits();
        }
      } catch (error) {
        if (!isCurrentResumeRequest()) {
          return;
        }
        appendTrace(`server snapshot live-connect error: ${toErrorMessage(error)}`);
      }
    },
    [
      appendTrace,
      bootstrap.modelCatalog.loaded,
      ensureClients,
      ensureEventStream,
      markAssistantCardsComplete,
      rebuildEventCachesFromMessageState,
      rebuildSessionUsageFromStoredMessages,
      refreshModelContextLimits,
      replaceMessageState,
      resetSessionTokenTracking,
      scheduleInteractiveRefresh,
    ]
  );

  const loadSessionOptions = useCallback(async () => {
    const requestID = ++sessionOptionsRequestIDRef.current;
    const isCurrentRequest = () => sessionOptionsRequestIDRef.current === requestID;
    sessionOptionsAbortRef.current?.abort();
    const controller = new AbortController();
    sessionOptionsAbortRef.current = controller;
    setIsLoadingSessionOptions(true);
    try {
      ensureClients();
      void refreshModelContextLimits();
      const client = sdkClientRef.current;
      if (!client) return;

      const sessionsResult = await client.session.list(undefined, {
        signal: controller.signal,
      });
      if (sessionsResult.error) {
        throw new Error(getAssistantError(sessionsResult.error) ?? "Failed to list sessions");
      }
      if (!isCurrentRequest()) return;

      const sorted = [...(sessionsResult.data ?? [])]
        .sort((left, right) => right.time.updated - left.time.updated)
        .filter((session) => session.id in trackedSessionsBySessionId)
        .map((session) => ({
          id: session.id,
          title: session.title,
          updated: session.time.updated,
          created: session.time.created,
        }));

      setAvailableSessions(sorted);
      setSelectedSessionID((previous) => {
        if (previous) return previous;
        if (sessionIDRef.current) return sessionIDRef.current;
        if (bootstrap.initialRawSessionId) return bootstrap.initialRawSessionId;
        return "";
      });
    } catch (error) {
      if (isAbortError(error)) return;
      if (!isCurrentRequest()) return;
      setErrorText(toErrorMessage(error));
    } finally {
      if (sessionOptionsAbortRef.current === controller) {
        sessionOptionsAbortRef.current = null;
      }
      if (isCurrentRequest()) {
        setIsLoadingSessionOptions(false);
      }
    }
  }, [bootstrap.initialRawSessionId, ensureClients, refreshModelContextLimits, trackedSessionsBySessionId]);

  const syncTrackedSession = useCallback((trackedSession: AgentBootstrapTrackedSession) => {
    setTrackedSessionsBySessionId((previous) => ({
      ...previous,
      [trackedSession.rawSessionId]: trackedSession,
    }));

    setMatterSessionIdsByMatterId((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).map(([matterID, sessionIDs]) => [
          matterID,
          sessionIDs.filter((sessionID) => sessionID !== trackedSession.rawSessionId),
        ])
      );

      if (trackedSession.matterId) {
        const current = next[trackedSession.matterId] ?? [];
        next[trackedSession.matterId] = current.includes(trackedSession.rawSessionId)
          ? current
          : [...current, trackedSession.rawSessionId];
      }

      return next;
    });
  }, []);

  const assignTrackedSessionToMatter = useCallback(
    async (trackedSession: AgentBootstrapTrackedSession, matterID: string) => {
      const response = await fetch(`/api/matters/${matterID}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trackedSessionId: trackedSession.id,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; addedByUserId?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to assign session to matter");
      }

      const nextTrackedSession: AgentBootstrapTrackedSession = {
        ...trackedSession,
        matterId: matterID,
        addedByUserId: payload?.addedByUserId,
      };

      syncTrackedSession(nextTrackedSession);
      return nextTrackedSession;
    },
    [syncTrackedSession]
  );

  const registerTrackedSession = useCallback(
    async (rawSessionID: string, matterID?: string) => {
      const existingTrackedSession = trackedSessionsBySessionId[rawSessionID];
      if (existingTrackedSession) {
        if (matterID && existingTrackedSession.matterId !== matterID) {
          return assignTrackedSessionToMatter(existingTrackedSession, matterID);
        }
        return existingTrackedSession;
      }

      const inflight = trackedSessionWriteInFlightRef.current.get(rawSessionID);
      if (inflight) {
        const trackedSession = await inflight;
        if (matterID && trackedSession.matterId !== matterID) {
          return assignTrackedSessionToMatter(trackedSession, matterID);
        }
        return trackedSession;
      }

      const request = (async () => {
        const response = await fetch("/api/opencode-sessions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: rawSessionID,
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | { error?: string; trackedSession?: AgentBootstrapTrackedSession }
          | null;

        if (!response.ok || !payload?.trackedSession) {
          throw new Error(payload?.error ?? "Failed to register tracked session");
        }

        let trackedSession = payload.trackedSession;
        syncTrackedSession(trackedSession);

        if (matterID && trackedSession.matterId !== matterID) {
          trackedSession = await assignTrackedSessionToMatter(trackedSession, matterID);
        }

        return trackedSession;
      })();

      trackedSessionWriteInFlightRef.current.set(rawSessionID, request);

      try {
        return await request;
      } finally {
        trackedSessionWriteInFlightRef.current.delete(rawSessionID);
      }
    },
    [
      assignTrackedSessionToMatter,
      syncTrackedSession,
      trackedSessionsBySessionId,
    ]
  );

  const resumeSession = useCallback(async (targetSessionID: string) => {
    const liveSelectedSessionID = targetSessionID;
    const resumeRequestID = ++resumeRequestIDRef.current;
    const isCurrentResumeRequest = () => resumeRequestIDRef.current === resumeRequestID;
    resumeAbortRef.current?.abort();
    const controller = new AbortController();
    resumeAbortRef.current = controller;

    setErrorText(null);
    setIsBusy(false);
    setIsLoadingSelectedSession(true);
    setSessionID(null);
    setSelectedSessionID(liveSelectedSessionID);
    setRunUiPhase("thinking");

    sessionIDRef.current = null;
    messageEntriesRef.current = [];
    messagePartsByMessageIDRef.current = new Map();
    pendingOptimisticUserRef.current = null;
    partTextSeenRef.current.clear();
    toolStateSeenRef.current.clear();
    activeAssistantServerMessageIDRef.current = null;
    activeRunRef.current = null;
    runCompletionInFlightRef.current = null;
    statusPollInFlightRef.current = false;
    resetSessionTokenTracking();

    try {
      ensureClients();
      await ensureEventStream();
      await refreshModelContextLimits();

      const client = sdkClientRef.current;
      if (!client) throw new Error("OpenCode client is not initialized");

      const messagesResult = await client.session.messages({
        sessionID: liveSelectedSessionID,
        limit: 1000,
      }, {
        signal: controller.signal,
      });
      if (messagesResult.error) {
        throw new Error(
          getAssistantError(messagesResult.error) ?? "Failed to load session history"
        );
      }
      if (!isCurrentResumeRequest()) {
        return;
      }

      const storedMessages = (messagesResult.data ?? []) as Array<StoredMessage>;
      const nextState = buildMessageStateFromStoredMessages(storedMessages);
      const localUserCount = nextState.messages.reduce(
        (count, message) => (message.role === "user" ? count + 1 : count),
        0
      );
      rebuildSessionUsageFromStoredMessages(storedMessages);
      rebuildEventCachesFromMessageState(nextState.messages, nextState.partsByMessageID);
      shouldAutoScrollRef.current = true;
      replaceMessageState(nextState.messages, nextState.partsByMessageID);
      sessionIDRef.current = liveSelectedSessionID;
      setSessionID(liveSelectedSessionID);
      setSelectedSessionID(liveSelectedSessionID);

      const statusResult = await client.session.status(undefined, {
        signal: controller.signal,
      });
      if (statusResult.error) {
        throw new Error(getAssistantError(statusResult.error) ?? "Failed to load session status");
      }
      if (!isCurrentResumeRequest() || sessionIDRef.current !== liveSelectedSessionID) {
        return;
      }

      const statusBySession = statusResult.data ?? {};
      const sessionStatus = statusBySession[liveSelectedSessionID] ?? { type: "idle" };

      if (sessionStatus.type === "busy" || sessionStatus.type === "retry") {
        const resumedRunPartsByMessageID = getResumedRunPartsByMessageID(
          messageEntriesRef.current,
          messagePartsByMessageIDRef.current
        );
        const runID = crypto.randomUUID();
        const fail = (error: Error) => {
          if (activeRunRef.current?.id === runID) {
            activeRunRef.current = null;
          }
          setIsBusy(false);
          setErrorText(error.message);
          markAssistantCardsComplete();
        };

        const finish = () => {
          if (activeRunRef.current?.id === runID) {
            activeRunRef.current = null;
          }
          setIsBusy(false);
        };

        activeRunRef.current = {
          id: runID,
          sessionID: liveSelectedSessionID,
          assistantText: "",
          startObserved: didSnapshotCaptureActiveRun(storedMessages, localUserCount),
          // A resumed busy run is reconstructed from a potentially stale snapshot, so force
          // one canonical refresh when it finishes even if we only see the trailing idle event.
          pollRecoveryEligible: true,
          model: getLatestAssistantModelLabel(storedMessages),
          toolCalls: collectToolCallsFromMessageParts(resumedRunPartsByMessageID),
          fail,
          finish,
        };
        streamLastEventAtRef.current = Date.now();
        setIsBusy(true);
        setRunUiPhase(deriveRunUiPhaseFromMessageParts(resumedRunPartsByMessageID));
      } else {
        activeRunRef.current = null;
        markAssistantCardsComplete();
        setIsBusy(false);
        setRunUiPhase("thinking");
      }

      appendTrace(`session resumed: ${liveSelectedSessionID} [status: ${sessionStatus.type}]`);
      scheduleInteractiveRefresh(0);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      if (!isCurrentResumeRequest()) {
        return;
      }
      const message = toErrorMessage(error);
      setErrorText(message);
      appendTrace(`resume error: ${message}`);
    } finally {
      if (resumeAbortRef.current === controller) {
        resumeAbortRef.current = null;
      }
      if (isCurrentResumeRequest()) {
        setIsLoadingSelectedSession(false);
      }
    }
  }, [
    appendTrace,
    rebuildEventCachesFromMessageState,
    rebuildSessionUsageFromStoredMessages,
    ensureClients,
    ensureEventStream,
    markAssistantCardsComplete,
    replaceMessageState,
    refreshModelContextLimits,
    resetSessionTokenTracking,
    scheduleInteractiveRefresh,
  ]);

  const handleSelectMatter = useCallback(
    (matterID: string) => {
      setSelectedMatterID(matterID);
      setSelectedTrackedSessionID("");
      setSelectedSessionID("");
      router.push(`/agent/matters/${matterID}`);
    },
    [router]
  );

  const handleSelectTrackedSession = useCallback(
    (trackedSessionID: string) => {
      const trackedSession = trackedSessionsByTrackedID[trackedSessionID];
      if (!trackedSession) return;

      setSelectedTrackedSessionID(trackedSessionID);
      setSelectedMatterID(trackedSession.matterId ?? "");
      setSelectedSessionID(trackedSession.rawSessionId);
      router.push(buildChatRoute(trackedSessionID, trackedSession.matterId));
    },
    [router, trackedSessionsByTrackedID]
  );

  const handleCreateMatter = useCallback(() => {
    setErrorText("Matter creation UI is not implemented yet.");
  }, []);

  const handleResumeCurrentSession = useCallback(() => {
    const targetSessionID = selectedSessionID || sessionIDRef.current;
    if (!targetSessionID) return;
    void resumeSession(targetSessionID);
  }, [resumeSession, selectedSessionID]);

  useEffect(() => {
    if (lastRouteSyncKeyRef.current === routeSyncKey) {
      return;
    }
    lastRouteSyncKeyRef.current = routeSyncKey;

    setSelectedMatterID(bootstrap.initialMatterId ?? "");
    setSelectedTrackedSessionID(bootstrap.initialTrackedSessionId ?? "");
    setSelectedSessionID(bootstrap.initialRawSessionId ?? "");
    setTrackedSessionsBySessionId(bootstrap.trackedSessionsBySessionId);
    setMatterSessionIdsByMatterId(bootstrap.matterSessionIdsByMatterId);
    setAvailableSessions(bootstrap.availableSessions);
    setIsLoadingSessionOptions(!bootstrap.availableSessionsLoaded);
    setIsLoadingSelectedSession(
      Boolean(bootstrap.initialRawSessionId) && !bootstrap.initialSessionSnapshot?.loaded
    );

    if (!applyModelCatalogSnapshot(bootstrap.modelCatalog)) {
      void refreshModelContextLimits();
    }

    if (!bootstrap.availableSessionsLoaded) {
      void loadSessionOptions();
    }

    if (bootstrap.initialRawSessionId && bootstrap.initialSessionSnapshot?.loaded) {
      void hydrateSessionFromBootstrap(
        bootstrap.initialRawSessionId,
        bootstrap.initialSessionSnapshot
      );
      return;
    }

    if (bootstrap.initialRawSessionId) {
      void resumeSession(bootstrap.initialRawSessionId);
      return;
    }

    if (!bootstrap.initialRawSessionId) {
      resumeAbortRef.current?.abort();
      resumeAbortRef.current = null;
      sessionIDRef.current = null;
      activeRunRef.current = null;
      runCompletionInFlightRef.current = null;
      statusPollInFlightRef.current = false;
      pendingOptimisticUserRef.current = null;
      activeAssistantServerMessageIDRef.current = null;
      messageEntriesRef.current = [];
      messagePartsByMessageIDRef.current = new Map();
      messageRoleByIDRef.current.clear();
      partTextSeenRef.current.clear();
      toolStateSeenRef.current.clear();
      shouldAutoScrollRef.current = true;
      resetSessionTokenTracking();
      setSessionID(null);
      setTimeline([]);
      setIsBusy(false);
      setRunUiPhase("thinking");
      setPendingQuestions([]);
      setPendingPermissions([]);
      setQuestionDrafts({});
      setActiveQuestionIndexByRequest({});
      markAssistantCardsComplete();
    }
  }, [
    applyModelCatalogSnapshot,
    bootstrap.availableSessions,
    bootstrap.availableSessionsLoaded,
    bootstrap.initialSessionSnapshot,
    loadSessionOptions,
    markAssistantCardsComplete,
    hydrateSessionFromBootstrap,
    refreshModelContextLimits,
    resetSessionTokenTracking,
    routeSyncKey,
    resumeSession,
    bootstrap.modelCatalog,
  ]);

  useEffect(() => {
    if (statusPollTimerRef.current !== null) {
      window.clearInterval(statusPollTimerRef.current);
      statusPollTimerRef.current = null;
    }

    if (!isBusy) {
      statusPollInFlightRef.current = false;
      return;
    }

    statusPollTimerRef.current = window.setInterval(() => {
      void pollActiveRunStatus();
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      if (statusPollTimerRef.current !== null) {
        window.clearInterval(statusPollTimerRef.current);
        statusPollTimerRef.current = null;
      }
    };
  }, [isBusy, pollActiveRunStatus]);

  useEffect(
    () => () => {
      if (timelinePublishFrameRef.current !== null) {
        window.cancelAnimationFrame(timelinePublishFrameRef.current);
        timelinePublishFrameRef.current = null;
      }
      eventStreamSupervisorAbortRef.current?.abort();
      eventStreamSupervisorAbortRef.current = null;
      eventStreamAbortRef.current?.abort();
      eventStreamAbortRef.current = null;
      eventStreamTaskRef.current = null;

      if (interactiveRefreshTimerRef.current !== null) {
        window.clearTimeout(interactiveRefreshTimerRef.current);
        interactiveRefreshTimerRef.current = null;
      }
      if (statusPollTimerRef.current !== null) {
        window.clearInterval(statusPollTimerRef.current);
        statusPollTimerRef.current = null;
      }
    },
    []
  );

  const ensureSession = useCallback(async (): Promise<string> => {
    ensureClients();
    void refreshModelContextLimits();
    await ensureEventStream();

    if (sessionIDRef.current) return sessionIDRef.current;

    const client = sdkClientRef.current;
    if (!client) throw new Error("OpenCode client is not initialized");

    const sessionResult = await client.session.create();
    if (sessionResult.error) {
      throw new Error(getAssistantError(sessionResult.error) ?? "Failed to create session");
    }

    const createdSession = sessionResult.data;
    const trackedSession = await registerTrackedSession(createdSession.id, selectedMatterID || undefined);
    resetSessionTokenTracking();
    sessionIDRef.current = createdSession.id;
    setSessionID(createdSession.id);
    setSelectedSessionID(createdSession.id);
    setSelectedTrackedSessionID(trackedSession.id);
    setSelectedMatterID(trackedSession.matterId ?? selectedMatterID);
    appendTrace(`session created: ${createdSession.id}`);
    void loadSessionOptions();

    return createdSession.id;
  }, [
    appendTrace,
    ensureClients,
    ensureEventStream,
    loadSessionOptions,
    registerTrackedSession,
    refreshModelContextLimits,
    resetSessionTokenTracking,
    selectedMatterID,
  ]);

  const sendPrompt = useCallback(async () => {
    const prompt = inputText.trim();
    if (!prompt || isBusy || isLoadingSelectedSession) return;
    const userMessageID = `msg_ffffffffffff${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const userCreatedAt = Date.now();

    setInputText("");
    setErrorText(null);
    setPendingQuestions([]);
    setPendingPermissions([]);

    partTextSeenRef.current.clear();
    toolStateSeenRef.current.clear();
    activeAssistantServerMessageIDRef.current = null;

    appendTrace(`prompt sent (${prompt.length} chars)`);

    const runID = crypto.randomUUID();
    shouldAutoScrollRef.current = true;
    appendUserCard(userMessageID, prompt, userCreatedAt, true);
    pendingOptimisticUserRef.current = {
      localMessageID: userMessageID,
      sessionID: null,
      text: prompt,
      createdAt: userCreatedAt,
    };

    setIsBusy(true);
    setRunUiPhase("thinking");

    try {
      const liveSessionID = await ensureSession();
      const client = sdkClientRef.current;
      if (!client) throw new Error("OpenCode client is not initialized");

      const fail = (error: Error) => {
        if (activeRunRef.current?.id === runID) {
          activeRunRef.current = null;
        }
        setIsBusy(false);
        setErrorText(error.message);
        markAssistantCardsComplete();
      };

      const finish = () => {
        if (activeRunRef.current?.id === runID) {
          activeRunRef.current = null;
        }
        setIsBusy(false);
      };

      activeRunRef.current = {
        id: runID,
        sessionID: liveSessionID,
        assistantText: "",
        startObserved: false,
        pollRecoveryEligible: false,
        toolCalls: new Map<string, RuntimeToolCall>(),
        fail,
        finish,
      };
      pendingOptimisticUserRef.current = {
        localMessageID: userMessageID,
        sessionID: liveSessionID,
        text: prompt,
        createdAt: userCreatedAt,
      };
      streamLastEventAtRef.current = Date.now();

      await client.session.promptAsync({
        sessionID: liveSessionID,
        parts: [{ type: "text", text: prompt }],
      });

      scheduleInteractiveRefresh(0);
    } catch (error) {
      const message = toErrorMessage(error);
      pendingOptimisticUserRef.current = null;
      setErrorText(message);
      setIsBusy(false);
      appendTrace(`prompt error: ${message}`);

      if (activeRunRef.current?.id === runID) {
        activeRunRef.current = null;
      }
      markAssistantCardsComplete();
    }
  }, [
    appendUserCard,
    appendTrace,
    ensureSession,
    inputText,
    isBusy,
    isLoadingSelectedSession,
    markAssistantCardsComplete,
    scheduleInteractiveRefresh,
  ]);

  const handlePermissionReply = useCallback(
    async (requestID: string, reply: "once" | "always" | "reject") => {
      const client = sdkClientRef.current;
      if (!client) return;

      setErrorText(null);
      try {
        await client.permission.reply({ requestID, reply });
        appendTrace(`permission replied (${requestID}): ${reply}`);
        scheduleInteractiveRefresh(0);
      } catch (error) {
        const message = toErrorMessage(error);
        setErrorText(message);
        appendTrace(`permission reply error: ${message}`);
      }
    },
    [appendTrace, scheduleInteractiveRefresh]
  );

  const updateQuestionDraft = useCallback(
    (
      requestID: string,
      questionIndex: number,
      updater: (draft: QuestionDraft) => QuestionDraft
    ) => {
      setQuestionDrafts((previous) => {
        const requestDrafts = previous[requestID] ? [...previous[requestID]] : [];
        const currentDraft = requestDrafts[questionIndex] ?? createEmptyQuestionDraft();
        requestDrafts[questionIndex] = updater(currentDraft);
        return { ...previous, [requestID]: requestDrafts };
      });
    },
    []
  );

  const handleQuestionOptionToggle = useCallback(
    (
      requestID: string,
      questionIndex: number,
      question: QuestionInfo,
      optionLabel: string
    ) => {
      updateQuestionDraft(requestID, questionIndex, (draft) => {
        const alreadySelected = draft.selectedOptions.includes(optionLabel);
        if (question.multiple) {
          return {
            ...draft,
            selectedOptions: alreadySelected
              ? draft.selectedOptions.filter((label) => label !== optionLabel)
              : [...draft.selectedOptions, optionLabel],
          };
        }

        return {
          selectedOptions: alreadySelected ? [] : [optionLabel],
          customText: "",
        };
      });
    },
    [updateQuestionDraft]
  );

  const handleQuestionCustomInputChange = useCallback(
    (requestID: string, questionIndex: number, question: QuestionInfo, value: string) => {
      updateQuestionDraft(requestID, questionIndex, (draft) => ({
        selectedOptions:
          !question.multiple && value.trim().length > 0 ? [] : draft.selectedOptions,
        customText: value,
      }));
    },
    [updateQuestionDraft]
  );

  const handleQuestionStepChange = useCallback((requestID: string, questionIndex: number) => {
    setActiveQuestionIndexByRequest((previous) => ({
      ...previous,
      [requestID]: questionIndex,
    }));
  }, []);

  const handleQuestionReply = useCallback(
    async (request: QuestionRequest) => {
      const client = sdkClientRef.current;
      if (!client) return;

      const requestDrafts = questionDrafts[request.id] ?? [];
      const answers = request.questions.map((question, index) => {
        return buildQuestionAnswer(question, requestDrafts[index]);
      });

      const firstUnansweredIndex = answers.findIndex((answer) => answer.length === 0);
      if (firstUnansweredIndex >= 0) {
        const pendingQuestion = request.questions[firstUnansweredIndex];
        setActiveQuestionIndexByRequest((previous) => ({
          ...previous,
          [request.id]: firstUnansweredIndex,
        }));
        setErrorText(
          `Answer required for ${pendingQuestion.header || `question ${firstUnansweredIndex + 1}`}.`
        );
        return;
      }

      setErrorText(null);
      try {
        await client.question.reply({
          requestID: request.id,
          answers,
        });

        appendTrace(`question replied (${request.id})`);
        setPendingQuestions((previous) =>
          previous.filter((pendingRequest) => pendingRequest.id !== request.id)
        );
        setQuestionDrafts((previous) => {
          if (!(request.id in previous)) return previous;
          const next = { ...previous };
          delete next[request.id];
          return next;
        });
        setActiveQuestionIndexByRequest((previous) => {
          if (!(request.id in previous)) return previous;
          const next = { ...previous };
          delete next[request.id];
          return next;
        });
        scheduleInteractiveRefresh(0);
      } catch (error) {
        const message = toErrorMessage(error);
        setErrorText(message);
        appendTrace(`question reply error: ${message}`);
      }
    },
    [appendTrace, questionDrafts, scheduleInteractiveRefresh]
  );

  const resetSession = useCallback(() => {
      eventStreamSupervisorAbortRef.current?.abort();
      eventStreamSupervisorAbortRef.current = null;
      eventStreamAbortRef.current?.abort();
      eventStreamAbortRef.current = null;
      eventStreamTaskRef.current = null;
      streamLastEventAtRef.current = 0;

      if (interactiveRefreshTimerRef.current !== null) {
        window.clearTimeout(interactiveRefreshTimerRef.current);
        interactiveRefreshTimerRef.current = null;
      }
      if (statusPollTimerRef.current !== null) {
        window.clearInterval(statusPollTimerRef.current);
        statusPollTimerRef.current = null;
      }
      sessionOptionsAbortRef.current?.abort();
      sessionOptionsAbortRef.current = null;
      resumeAbortRef.current?.abort();
      resumeAbortRef.current = null;
      interactiveRefreshInFlightRef.current = false;
      interactiveRefreshDirtyRef.current = false;
      statusPollInFlightRef.current = false;
      runCompletionInFlightRef.current = null;

      sdkClientRef.current = null;
      configuredBaseURLRef.current = null;

      sessionIDRef.current = null;
      activeRunRef.current = null;
      pendingOptimisticUserRef.current = null;
      messageEntriesRef.current = [];
      messagePartsByMessageIDRef.current = new Map();
      messageRoleByIDRef.current.clear();
      partTextSeenRef.current.clear();
      toolStateSeenRef.current.clear();
      activeAssistantServerMessageIDRef.current = null;
      resetSessionTokenTracking();

      setSessionID(null);
      setSelectedSessionID("");
      setSelectedTrackedSessionID("");
      shouldAutoScrollRef.current = true;
      setTimeline([]);
      setInputText("");
      setTraceLines([]);
      setErrorText(null);
      setPendingQuestions([]);
      setPendingPermissions([]);
      setQuestionDrafts({});
      setActiveQuestionIndexByRequest({});
      setIsBusy(false);
      setIsLoadingSelectedSession(false);
      setRunUiPhase("thinking");
      void loadSessionOptions();
      const targetRoute = selectedMatterID ? `/agent/matters/${selectedMatterID}` : "/agent";
      router.push(targetRoute);
  }, [loadSessionOptions, resetSessionTokenTracking, router, selectedMatterID]);

  const handleCreateChat = useCallback(() => {
    resetSession();
  }, [resetSession]);

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      void sendPrompt();
    },
    [sendPrompt]
  );

  const canEditBaseUrl = !sessionID && !isBusy;
  const basePort = (() => {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.port) return parsed.port;
      if (parsed.protocol === "https:") return "443";
      if (parsed.protocol === "http:") return "80";
      return "-";
    } catch {
      const match = baseUrl.match(/:(\d+)(?:\/|$)/);
      return match?.[1] ?? "-";
    }
  })();
  const modelLabel = activeModelKey ?? "-";
  const contextUsedEstimate = latestContextUsage ? getTokenUsageTotal(latestContextUsage) : 0;
  const contextUsagePercent =
    activeContextLimit && activeContextLimit > 0
      ? Math.min(999.9, (contextUsedEstimate / activeContextLimit) * 100)
      : null;
  const contextUsageText =
    contextUsagePercent !== null
      ? `${formatTokenCount(contextUsedEstimate)} tokens · ${Math.round(
          contextUsagePercent
        )}% used`
      : `${formatTokenCount(contextUsedEstimate)} tokens`;
  const sessionSpendText = formatUsdAmount(sessionSpendTotal);
  const contextBreakdownRows = latestContextUsage
    ? [
        { label: "Input", value: formatTokenCount(latestContextUsage.input) },
        { label: "Output", value: formatTokenCount(latestContextUsage.output) },
        { label: "Reasoning", value: formatTokenCount(latestContextUsage.reasoning) },
        { label: "Cache Read", value: formatTokenCount(latestContextUsage.cacheRead) },
        { label: "Cache Write", value: formatTokenCount(latestContextUsage.cacheWrite) },
        { label: "Total", value: formatTokenCount(contextUsedEstimate) },
        {
          label: "Limit",
          value:
            activeContextLimit && activeContextLimit > 0
              ? formatTokenCount(activeContextLimit)
              : "—",
        },
        {
          label: "Usage",
          value: contextUsagePercent !== null ? `${Math.round(contextUsagePercent)}%` : "—",
        },
      ]
    : [];
  const sessionTotalsRows = [
    { label: "Input", value: formatTokenCount(sessionUsageTotals.input) },
    { label: "Output", value: formatTokenCount(sessionUsageTotals.output) },
    { label: "Reasoning", value: formatTokenCount(sessionUsageTotals.reasoning) },
    { label: "Cache Read", value: formatTokenCount(sessionUsageTotals.cacheRead) },
    { label: "Cache Write", value: formatTokenCount(sessionUsageTotals.cacheWrite) },
    { label: "Total", value: formatTokenCount(getTokenUsageTotal(sessionUsageTotals)) },
    { label: "Spend", value: sessionSpendText },
  ];
  const sessionCostFormulaGroups = buildSessionCostFormulaGroups(
    assistantUsageByMessageIDRef.current.values(),
    modelCostByKeyRef.current
  );
  const sessionCostFormulaTotal = sessionCostFormulaGroups.reduce(
    (sum, group) => sum + group.total,
    0
  );
  const showThinkingCard = isBusy && runUiPhase === "thinking";
  const shouldShowRouteChatLoader =
    isLoadingSelectedSession && Boolean(bootstrap.initialRawSessionId);
  const sidebarSessions: Array<MatterChatSidebarSession> = availableSessions.flatMap((session) => {
    const trackedSession = trackedSessionsBySessionId[session.id];
    if (!trackedSession) return [];

    return [
      {
        trackedSessionId: trackedSession.id,
        rawSessionId: session.id,
        title: session.title?.trim() ? session.title.trim() : "Untitled",
        updatedLabel: new Date(session.updated || session.created).toLocaleDateString(),
        shortID: trackedSession.id.slice(0, 8),
      },
    ];
  });
  const recentChats = sidebarSessions.filter(
    (session) => !trackedSessionsByTrackedID[session.trackedSessionId]?.matterId
  );
  const matterFolders: Array<MatterChatSidebarMatter> = matters.map((matter) => {
    const rawSessionIds = matterSessionIdsByMatterId[matter.id] ?? [];
    const rawSessionIdSet = new Set(rawSessionIds);

    return {
      id: matter.id,
      code: matter.code,
      title: matter.title,
      chats: sidebarSessions.filter((session) => rawSessionIdSet.has(session.rawSessionId)),
    };
  });

  return (
    <main className="agent-page h-dvh overflow-hidden p-3 text-foreground sm:p-4">
      <div
        className={`agent-layout grid h-full gap-3 ${
          showTrace
            ? "lg:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_340px]"
            : "lg:grid-cols-[auto_minmax(0,1fr)]"
        }`}
      >
        <MatterChatSidebar
          isLoadingRecentChats={isLoadingSessionOptions}
          matters={matterFolders}
          recentChats={recentChats}
          selectedMatterID={selectedMatterID}
          selectedTrackedSessionID={selectedTrackedSessionID}
          userEmail={bootstrap.user.email}
          onCreateChat={handleCreateChat}
          onCreateMatter={handleCreateMatter}
          onSelectMatter={handleSelectMatter}
          onSelectSession={handleSelectTrackedSession}
        />

        <Card className="agent-panel min-h-0 min-w-0 gap-0 overflow-hidden rounded-none border-2 py-0 shadow-none">
          <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col px-0">
            <AgentSessionHeader
              availableSessions={availableSessions}
              isBusy={isBusy}
              selectedSessionID={selectedSessionID}
              onLoadSessionOptions={() => void loadSessionOptions()}
              onResetSession={resetSession}
              onResumeSession={handleResumeCurrentSession}
              onToggleTrace={() => setShowTrace((value) => !value)}
              showTrace={showTrace}
            />

            <div ref={timelineScrollAreaRef} className="min-h-0 flex-1 min-w-0">
              <ScrollArea type="always" className="h-full min-w-0">
                <AgentTimeline
                  isLoadingSelectedSession={shouldShowRouteChatLoader}
                  messagesEndRef={messagesEndRef}
                  showThinkingCard={showThinkingCard}
                  timeline={timeline}
                />
              </ScrollArea>
            </div>
          </CardContent>

          <AgentInteractivePanel
            activeQuestionIndexByRequest={activeQuestionIndexByRequest}
            onPermissionReply={(requestID, decision) => void handlePermissionReply(requestID, decision)}
            onQuestionCustomInputChange={handleQuestionCustomInputChange}
            onQuestionOptionToggle={handleQuestionOptionToggle}
            onQuestionReply={(request) => void handleQuestionReply(request)}
            onQuestionStepChange={handleQuestionStepChange}
            pendingPermissions={pendingPermissions}
            pendingQuestions={pendingQuestions}
            questionDrafts={questionDrafts}
          />

          {errorText ? (
            <p className="border-t-2 border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {errorText}
            </p>
          ) : null}

          <AgentComposer
            contextBreakdownRows={contextBreakdownRows}
            contextUsageText={contextUsageText}
            inputText={inputText}
            isBusy={isBusy}
            isLoadingSelectedSession={isLoadingSelectedSession}
            latestContextUsage={latestContextUsage}
            modelLabel={modelLabel}
            onInputTextChange={setInputText}
            onKeyDown={handleComposerKeyDown}
            onSend={() => void sendPrompt()}
            sendDisabled={!inputText.trim() || isBusy || isLoadingSelectedSession}
            sessionCostFormulaGroups={sessionCostFormulaGroups}
            sessionCostFormulaTotal={sessionCostFormulaTotal}
            sessionSpendText={sessionSpendText}
            sessionTotalsRows={sessionTotalsRows}
            textareaRef={composerTextareaRef}
          />
        </Card>

        {showTrace ? (
          <AgentTracePanel
            basePort={basePort}
            baseUrl={baseUrl}
            canEditBaseUrl={canEditBaseUrl}
            onBaseUrlChange={setBaseUrl}
            onHide={() => setShowTrace(false)}
            traceLines={traceLines}
          />
        ) : null}
      </div>
    </main>
  );
}
