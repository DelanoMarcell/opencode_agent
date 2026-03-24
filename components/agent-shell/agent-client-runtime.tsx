"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { SessionFilesDialog } from "@/components/agent-shell/session-files-dialog";
import { MatterOverviewEmptyState } from "@/components/agent-shell/matter-overview-empty-state";
import { MattersWorkspaceEmptyState } from "@/components/agent-shell/matters-workspace-empty-state";
import { AgentSessionHeader } from "@/components/agent-shell/agent-session-header";
import { AgentTimeline } from "@/components/agent-shell/agent-timeline";
import { AgentTracePanel } from "@/components/agent-shell/agent-trace-panel";
import {
  MatterChatSidebar,
  type MatterChatSidebarMatter,
  type MatterChatSidebarSession,
} from "@/components/agent-shell/matter-chat-sidebar";
import type { EditableSession } from "@/components/agent-shell/rename-session-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentUsage } from "@/hooks/agent/use-agent-usage";
import {
  buildAgentModelCatalog,
  type ProviderCatalogListItem,
} from "@/lib/agent/model-catalog";
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
  getRunningStoredReasoningPartIDs,
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
  toRuntimeToolCall,
  updateUserMessageText,
  upsertMessageEntry,
  upsertMessagePart,
  waitFor,
  formatToolUpdate,
  formatTokenCount,
  formatUsdAmount,
  getTokenUsageTotal,
  parseAttachedFilesFromText,
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
  AgentBootstrapMatter,
  AgentModelSelectionPolicy,
  AgentSelectableModel,
  AgentBootstrapSessionRecord,
} from "@/lib/agent/types";
import type {
  StoredFileListItem,
  StoredFileSummary,
  StoredFileUploadResult,
} from "@/lib/files/types";
import type { Ms365AttachmentSelection } from "@/lib/ms365/types";

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

type PendingSidebarSession = {
  sessionRecordId: string;
  rawSessionId: string;
  matterId?: string;
  title: string;
  updated: number;
  created: number;
};

type FilesDialogScope = "session" | "matter";
type PendingAttachedFile = Pick<
  StoredFileListItem,
  "fileId" | "originalName" | "relativePath" | "source"
>;

function buildFilesApiEndpoint(scope: FilesDialogScope, resourceId: string) {
  return scope === "matter"
    ? `/api/matters/${encodeURIComponent(resourceId)}/files`
    : `/api/opencode-sessions/${encodeURIComponent(resourceId)}/files`;
}

function buildMs365FilesApiEndpoint(scope: FilesDialogScope, resourceId: string) {
  return scope === "matter"
    ? `/api/matters/${encodeURIComponent(resourceId)}/files/ms365`
    : `/api/opencode-sessions/${encodeURIComponent(resourceId)}/files/ms365`;
}

function buildChatRoute(sessionRecordID: string, matterID?: string) {
  return matterID
    ? `/agent/matters/${matterID}/chats/${sessionRecordID}`
    : `/agent/chats/${sessionRecordID}`;
}

function isDefaultSessionTitle(title: string | null | undefined) {
  const normalized = title?.trim().toLowerCase();
  return !normalized || normalized === "untitled" || normalized === "untitled session";
}

function resolveDisplayedSessionTitle(
  storedTitle: string | null | undefined,
  opencodeTitle: string | null | undefined
) {
  if (!isDefaultSessionTitle(storedTitle)) {
    return storedTitle!.trim();
  }

  if (opencodeTitle?.trim()) {
    return opencodeTitle.trim();
  }

  if (storedTitle?.trim()) {
    return storedTitle.trim();
  }

  return "Untitled";
}

function buildAttachedFilesBlock(attachedFiles: Array<PendingAttachedFile>) {
  if (attachedFiles.length === 0) {
    return "";
  }

  return `<attached_files>\nThese are the only attached files for this request.\nUse only these exact paths when accessing attached files for this request.\nDo not use any other local files unless the user explicitly asks you to.\nRefer to attached files by filename only in your response, not by full path.\n${attachedFiles
    .map((file) => file.relativePath)
    .join("\n")}\n</attached_files>`;
}

function buildPromptFromComposerState(
  promptText: string,
  attachedFiles: Array<PendingAttachedFile>
) {
  const trimmedPrompt = promptText.trim();
  const attachedFilesBlock = buildAttachedFilesBlock(attachedFiles);
  const runtimePrompt =
    trimmedPrompt && attachedFilesBlock
      ? `${trimmedPrompt}\n\n${attachedFilesBlock}`
      : trimmedPrompt || attachedFilesBlock;

  return {
    displayPrompt: trimmedPrompt,
    runtimePrompt,
  };
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

function getStoredMessageModelSelection(message: StoredMessage): {
  modelKey: string | null;
  variant: string | null;
} {
  const info = message.info as Record<string, unknown>;
  const nestedModel =
    info.model && typeof info.model === "object" ? (info.model as Record<string, unknown>) : null;
  const providerID =
    typeof info.providerID === "string"
      ? info.providerID
      : typeof nestedModel?.providerID === "string"
        ? nestedModel.providerID
        : null;
  const modelID =
    typeof info.modelID === "string"
      ? info.modelID
      : typeof nestedModel?.modelID === "string"
        ? nestedModel.modelID
        : null;
  const variant =
    typeof info.variant === "string" && info.variant.trim().length > 0 ? info.variant.trim() : null;

  return {
    modelKey: providerID && modelID ? getModelKey(providerID, modelID) : null,
    variant,
  };
}

function getLatestUserModelSelection(storedMessages: Array<StoredMessage>): {
  modelKey: string | null;
  variant: string | null;
} {
  let latestUser: StoredMessage | null = null;

  for (const message of storedMessages) {
    if (message.info.role !== "user") continue;
    if (!latestUser || message.info.time.created >= latestUser.info.time.created) {
      latestUser = message;
    }
  }

  return latestUser
    ? getStoredMessageModelSelection(latestUser)
    : {
        modelKey: null,
        variant: null,
      };
}

function splitModelKey(modelKey: string): { providerID: string; modelID: string } | null {
  const separatorIndex = modelKey.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === modelKey.length - 1) return null;

  return {
    providerID: modelKey.slice(0, separatorIndex),
    modelID: modelKey.slice(separatorIndex + 1),
  };
}

function resolveStoredModelSelectionState(storedMessages: Array<StoredMessage>): {
  selectedModelKey: string | null;
  selectedVariantByModelKey: Record<string, string>;
} {
  const latestUserSelection = getLatestUserModelSelection(storedMessages);
  const selectedModelKey =
    latestUserSelection.modelKey ?? getLatestAssistantModelLabel(storedMessages) ?? null;

  return {
    selectedModelKey,
    selectedVariantByModelKey:
      latestUserSelection.modelKey && latestUserSelection.variant
        ? {
            [latestUserSelection.modelKey]: latestUserSelection.variant,
          }
        : {},
  };
}

function resolvePreferredSelectableModelKey(input: {
  selectableModels: Array<AgentSelectableModel>;
  defaultModelKey: string | null;
}): string | null {
  const selectableModelKeySet = new Set(input.selectableModels.map((model) => model.key));

  if (input.defaultModelKey && selectableModelKeySet.has(input.defaultModelKey)) {
    return input.defaultModelKey;
  }

  return input.selectableModels[0]?.key ?? null;
}

function buildPreferredVariantSelection(
  variantsByModelKey: Record<string, string[]>,
  preferredVariantByModelKey: Record<string, string>
) {
  const next: Record<string, string> = {};

  for (const [modelKey, variant] of Object.entries(preferredVariantByModelKey)) {
    if (variantsByModelKey[modelKey]?.includes(variant)) {
      next[modelKey] = variant;
    }
  }

  return next;
}

function mergeVariantSelectionState(input: {
  storedSelection: Record<string, string>;
  preferredSelection: Record<string, string>;
}) {
  return {
    ...input.preferredSelection,
    ...input.storedSelection,
  };
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
  const bootstrapPreferredVariantSelection = buildPreferredVariantSelection(
    bootstrap.modelCatalog.variants,
    bootstrap.modelCatalog.preferredVariantByModelKey
  );
  const initialModelSelectionState = resolveStoredModelSelectionState(
    bootstrapSessionState.storedMessages
  );
  const initialSelectableModelKey =
    initialModelSelectionState.selectedModelKey ??
    resolvePreferredSelectableModelKey({
      selectableModels: bootstrap.modelCatalog.selectableModels,
      defaultModelKey: bootstrap.modelCatalog.defaultModelKey,
    });
  const pathname = usePathname();
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [sessionID, setSessionID] = useState<string | null>(
    bootstrapSessionState.isHydrated ? bootstrap.initialRawSessionId ?? null : null
  );
  const [availableSessions, setAvailableSessions] = useState<Array<SessionOption>>(
    bootstrap.availableSessions
  );
  const [availableModelVariantsByKey, setAvailableModelVariantsByKey] = useState<
    Record<string, string[]>
  >(bootstrap.modelCatalog.variants);
  const [availableSelectableModels, setAvailableSelectableModels] = useState<
    Array<AgentSelectableModel>
  >(bootstrap.modelCatalog.selectableModels);
  const [defaultSelectableModelKey, setDefaultSelectableModelKey] = useState<string | null>(
    bootstrap.modelCatalog.defaultModelKey
  );
  const [modelSelectionPolicy, setModelSelectionPolicy] = useState<AgentModelSelectionPolicy | null>(
    bootstrap.modelSelectionPolicy
  );
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(
    initialSelectableModelKey
  );
  const [selectedVariantByModelKey, setSelectedVariantByModelKey] = useState<Record<string, string>>(
    mergeVariantSelectionState({
      storedSelection: initialModelSelectionState.selectedVariantByModelKey,
      preferredSelection: bootstrapPreferredVariantSelection,
    })
  );
  const [matterFileSummaryByMatterId, setMatterFileSummaryByMatterId] = useState(
    bootstrap.matterFileSummaryByMatterId
  );
  const [sessionFileSummaryByRawSessionId, setSessionFileSummaryByRawSessionId] = useState(
    bootstrap.sessionFileSummaryByRawSessionId
  );
  const [selectedSessionID, setSelectedSessionID] = useState(bootstrap.initialRawSessionId ?? "");
  const [selectedSessionRecordID, setSelectedSessionRecordID] = useState(
    bootstrap.initialSessionRecordId ?? ""
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
  const [sessionRecordsByRawSessionId, setSessionRecordsByRawSessionId] = useState<
    Record<string, AgentBootstrapSessionRecord>
  >(bootstrap.sessionRecordsByRawSessionId);
  const [matters, setMatters] = useState<Array<AgentBootstrapMatter>>(bootstrap.matters);
  const [timeline, setTimeline] = useState<Array<TimelineItem>>(bootstrapSessionState.timeline);
  const [inputText, setInputText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<Array<PendingAttachedFile>>([]);
  const [isFilesDialogOpen, setIsFilesDialogOpen] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [filesDialogRefreshToken, setFilesDialogRefreshToken] = useState(0);
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
  const workspaceMode = bootstrap.workspaceMode;
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
  const reasoningPartIDsRef = useRef<Set<string>>(
    getRunningStoredReasoningPartIDs(bootstrapSessionState.storedMessages)
  );
  const activeAssistantServerMessageIDRef = useRef<string | null>(null);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const timelineScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pendingOptimisticUserRef = useRef<PendingOptimisticUserMessage | null>(null);
  const sessionRecordWriteInFlightRef = useRef<
    Map<string, Promise<AgentBootstrapSessionRecord>>
  >(new Map());
  const resumeRequestIDRef = useRef(0);
  const sessionOptionsRequestIDRef = useRef(0);
  const sessionOptionsAbortRef = useRef<AbortController | null>(null);
  const resumeAbortRef = useRef<AbortController | null>(null);
  const lastRouteSyncKeyRef = useRef("");
  const pendingSidebarSessionRef = useRef<PendingSidebarSession | null>(null);

  useEffect(() => {
    sessionIDRef.current = sessionID;
  }, [sessionID]);

  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  useEffect(() => {
    if (selectedSessionID) return;

    const selectableModelKeySet = new Set(availableSelectableModels.map((model) => model.key));
    if (selectedModelKey && selectableModelKeySet.has(selectedModelKey)) {
      return;
    }

    const nextModelKey = resolvePreferredSelectableModelKey({
      selectableModels: availableSelectableModels,
      defaultModelKey: defaultSelectableModelKey,
    });

    if (nextModelKey !== selectedModelKey) {
      setSelectedModelKey(nextModelKey);
    }
  }, [
    availableSelectableModels,
    defaultSelectableModelKey,
    selectedModelKey,
    selectedSessionID,
  ]);

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

  const sessionRecords = useMemo<Array<AgentBootstrapSessionRecord>>(
    () => Object.values(sessionRecordsByRawSessionId),
    [sessionRecordsByRawSessionId]
  );

  const sessionRecordsById = useMemo<Record<string, AgentBootstrapSessionRecord>>(
    () =>
      Object.fromEntries(sessionRecords.map((sessionRecord) => [sessionRecord.id, sessionRecord])),
    [sessionRecords]
  );
  const routeSyncKey = useMemo(
    () =>
      [
        pathname,
        bootstrap.workspaceMode,
        bootstrap.initialMatterId ?? "",
        bootstrap.initialSessionRecordId ?? "",
        bootstrap.initialRawSessionId ?? "",
      ].join("|"),
    [
      bootstrap.initialMatterId,
      bootstrap.initialRawSessionId,
      bootstrap.initialSessionRecordId,
      bootstrap.workspaceMode,
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

  const scrollTimelineToBottom = useCallback(() => {
    const viewport = getTimelineViewport();
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
    messagesEndRef.current?.scrollIntoView({
      behavior: "auto",
      block: "end",
    });
  }, [getTimelineViewport]);

  useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    scrollTimelineToBottom();

    const frameID = window.requestAnimationFrame(() => {
      scrollTimelineToBottom();
    });

    return () => {
      window.cancelAnimationFrame(frameID);
    };
  }, [runUiPhase, scrollTimelineToBottom, timeline]);

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
    (
      messageID: string,
      text: string,
      createdAt = Date.now(),
      localOnly = true,
      attachedFiles: PendingOptimisticUserMessage["attachedFiles"] = []
    ) => {
      messageRoleByIDRef.current.set(messageID, "user");
      mutateMessageState((messages) => {
        messages.push({
          id: messageID,
          role: "user",
          parentID: undefined,
          createdAt,
          text,
          attachedFiles,
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
              attachedFiles:
                serverMessage.attachedFiles.length > 0
                  ? serverMessage.attachedFiles
                  : localMessage.attachedFiles,
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
      const parsed = parseAttachedFilesFromText(text);
      if (
        !pendingOptimisticUser ||
        (pendingOptimisticUser.sessionID !== null &&
          pendingOptimisticUser.sessionID !== sessionID) ||
        parsed.visibleText !== pendingOptimisticUser.text
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
          attachedFiles: [],
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
          attachedFiles: [],
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
          attachedFiles: [],
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
          attachedFiles: [],
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
    const isRealBaseUrlChange =
      configuredBaseURLRef.current !== null && configuredBaseURLRef.current !== baseUrl;

    if (
      sessionIDRef.current &&
      isRealBaseUrlChange
    ) {
      throw new Error(
        "Cannot change base URL while a session is active. Start a new session first."
      );
    }

    if (configuredBaseURLRef.current === baseUrl && sdkClientRef.current) {
      return;
    }

    if (isRealBaseUrlChange) {
      resetModelCatalog();
    }

    sdkClientRef.current = createOpencodeClient({ baseUrl });
    configuredBaseURLRef.current = baseUrl;
  }, [baseUrl, resetModelCatalog]);

  const applyModelCatalogSnapshot = useCallback(
    (catalog: AgentBootstrap["modelCatalog"]) => {
      if (!catalog.loaded) return false;
      replaceModelCatalog(
        new Map<string, number>(Object.entries(catalog.contextLimits)),
        new Map<string, ModelCostInfo>(Object.entries(catalog.costs))
      );
      setAvailableModelVariantsByKey(catalog.variants);
      setAvailableSelectableModels(catalog.selectableModels);
      setDefaultSelectableModelKey(catalog.defaultModelKey);
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

      const nextCatalog = buildAgentModelCatalog(
        {
          providers: (result.data?.all ?? []) as Array<ProviderCatalogListItem>,
          connectedProviderIDs: result.data?.connected ?? [],
          defaultModelIDs: result.data?.default ?? {},
          policy: modelSelectionPolicy,
        }
      );
      const nextLimits = new Map<string, number>(Object.entries(nextCatalog.contextLimits));
      const nextCosts = new Map<string, ModelCostInfo>(Object.entries(nextCatalog.costs));
      replaceModelCatalog(nextLimits, nextCosts);
      setAvailableModelVariantsByKey(nextCatalog.variants);
      setAvailableSelectableModels(nextCatalog.selectableModels);
      setDefaultSelectableModelKey(nextCatalog.defaultModelKey);
    } catch (error) {
      appendTrace(`provider metadata error: ${toErrorMessage(error)}`);
    }
  }, [appendTrace, ensureClients, modelSelectionPolicy, replaceModelCatalog]);

  const syncModelSelectionFromStoredMessages = useCallback(
    (storedMessages: Array<StoredMessage>) => {
      const latestUserSelection = getLatestUserModelSelection(storedMessages);
      const fallbackModelKey = getLatestAssistantModelLabel(storedMessages) ?? null;
      const preferredVariantSelection = buildPreferredVariantSelection(
        availableModelVariantsByKey,
        bootstrap.modelCatalog.preferredVariantByModelKey
      );
      const nextModelKey =
        latestUserSelection.modelKey ??
        fallbackModelKey ??
        resolvePreferredSelectableModelKey({
          selectableModels: availableSelectableModels,
          defaultModelKey: defaultSelectableModelKey,
        });

      setSelectedModelKey(nextModelKey);
      setSelectedVariantByModelKey((current) => {
        const next = mergeVariantSelectionState({
          storedSelection: current,
          preferredSelection: preferredVariantSelection,
        });

        if (latestUserSelection.modelKey) {
          if (latestUserSelection.variant) {
            next[latestUserSelection.modelKey] = latestUserSelection.variant;
          } else {
            delete next[latestUserSelection.modelKey];
          }
        }

        return next;
      });
    },
    [
      availableModelVariantsByKey,
      availableSelectableModels,
      bootstrap.modelCatalog.preferredVariantByModelKey,
      defaultSelectableModelKey,
    ]
  );

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
      reasoningPartIDsRef.current.clear();
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

  const replaceReasoningPartIDCache = useCallback((storedMessages: Array<StoredMessage>) => {
    reasoningPartIDsRef.current = getRunningStoredReasoningPartIDs(storedMessages);
  }, []);

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
      syncModelSelectionFromStoredMessages(storedMessages);
      rebuildEventCachesFromMessageState(reconciled.messages, reconciled.partsByMessageID);
      replaceReasoningPartIDCache(storedMessages);
      return reconciled.latestAssistantText;
    },
    [
      reconcileMessageStateWithStoredMessages,
      rebuildEventCachesFromMessageState,
      rebuildSessionUsageFromStoredMessages,
      replaceReasoningPartIDCache,
      replaceMessageState,
      syncModelSelectionFromStoredMessages,
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
              attachedFiles: existing?.role === "user" ? existing.attachedFiles : [],
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

        if (reasoningPartIDsRef.current.has(partID)) return;

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

        if (part.type === "reasoning") {
          reasoningPartIDsRef.current.add(part.id);
          return;
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
        reasoningPartIDsRef.current.delete(event.properties.partID);

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
      reasoningPartIDsRef.current.clear();
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
      syncModelSelectionFromStoredMessages(storedMessages);
      rebuildEventCachesFromMessageState(nextState.messages, nextState.partsByMessageID);
      replaceReasoningPartIDCache(storedMessages);
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
      syncModelSelectionFromStoredMessages,
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
        .filter((session) => session.id in sessionRecordsByRawSessionId)
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
  }, [bootstrap.initialRawSessionId, ensureClients, refreshModelContextLimits, sessionRecordsByRawSessionId]);

  const syncSessionRecord = useCallback((sessionRecord: AgentBootstrapSessionRecord) => {
    setSessionRecordsByRawSessionId((previous) => ({
      ...previous,
      [sessionRecord.rawSessionId]: sessionRecord,
    }));

    setMatterSessionIdsByMatterId((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).map(([matterID, sessionIDs]) => [
          matterID,
          sessionIDs.filter((sessionID) => sessionID !== sessionRecord.rawSessionId),
        ])
      );

      if (sessionRecord.matterId) {
        const current = next[sessionRecord.matterId] ?? [];
        next[sessionRecord.matterId] = current.includes(sessionRecord.rawSessionId)
          ? current
          : [...current, sessionRecord.rawSessionId];
      }

      return next;
    });
  }, []);

  const handleSessionRenamed = useCallback((updatedSession: EditableSession) => {
    const trimmedTitle = updatedSession.title.trim();
    const nextTitle = trimmedTitle || "Untitled";

    setAvailableSessions((current) =>
      current.map((session) =>
        session.id === updatedSession.rawSessionId ? { ...session, title: nextTitle } : session
      )
    );

    setSessionRecordsByRawSessionId((current) => {
      const existing = current[updatedSession.rawSessionId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [updatedSession.rawSessionId]: {
          ...existing,
          title: nextTitle,
        },
      };
    });

    if (pendingSidebarSessionRef.current?.rawSessionId === updatedSession.rawSessionId) {
      pendingSidebarSessionRef.current = {
        ...pendingSidebarSessionRef.current,
        title: nextTitle,
      };
    }
  }, []);

  const syncSessionFileSummary = useCallback((rawSessionId: string, summary: StoredFileSummary) => {
    setSessionFileSummaryByRawSessionId((current) => ({
      ...current,
      [rawSessionId]: summary,
    }));
  }, []);

  const syncMatterFileSummary = useCallback((matterId: string, summary: StoredFileSummary) => {
    setMatterFileSummaryByMatterId((current) => ({
      ...current,
      [matterId]: summary,
    }));
  }, []);

  const handleFilesSummaryChange = useCallback(
    (scope: FilesDialogScope, resourceId: string, summary: StoredFileSummary) => {
      if (scope === "matter") {
        syncMatterFileSummary(resourceId, summary);
        return;
      }

      syncSessionFileSummary(resourceId, summary);
    },
    [syncMatterFileSummary, syncSessionFileSummary]
  );

  const currentModelKey = selectedModelKey ?? activeModelKey ?? null;
  const selectableModelLabelByKey = useMemo(
    () =>
      Object.fromEntries(
        availableSelectableModels.map((model) => [model.key, model.label] as const)
      ),
    [availableSelectableModels]
  );
  const availableModelVariants = currentModelKey
    ? availableModelVariantsByKey[currentModelKey] ?? []
    : [];
  const currentModelVariant = (() => {
    if (!currentModelKey) return null;
    const candidate = selectedVariantByModelKey[currentModelKey];
    return candidate && availableModelVariants.includes(candidate) ? candidate : null;
  })();

  const handleSelectModel = useCallback(
    (modelKey: string) => {
      setSelectedModelKey(modelKey);
      appendTrace(`model selected: ${modelKey}`);
    },
    [appendTrace]
  );

  const handleSelectModelVariant = useCallback(
    (variant: string | null) => {
      if (!currentModelKey) return;

      setSelectedModelKey(currentModelKey);
      setSelectedVariantByModelKey((current) => {
        const next = { ...current };
        if (variant) {
          next[currentModelKey] = variant;
        } else {
          delete next[currentModelKey];
        }
        return next;
      });
      appendTrace(
        variant
          ? `model variant selected: ${currentModelKey} · ${variant}`
          : `model variant reset: ${currentModelKey} · default`
      );
    },
    [appendTrace, currentModelKey]
  );

  const handleOpenFiles = useCallback(() => {
    setIsFilesDialogOpen(true);
  }, []);

  const handleAttachFiles = useCallback(
    (files: Array<StoredFileListItem>) => {
      setAttachedFiles((current) => {
        const next = new Map(current.map((file) => [file.fileId, file]));
        for (const file of files) {
          next.set(file.fileId, {
            fileId: file.fileId,
            originalName: file.originalName,
            relativePath: file.relativePath,
            source: file.source,
          });
        }
        return Array.from(next.values());
      });
      appendTrace(`files attached for next send: ${files.length}`);
    },
    [appendTrace]
  );

  const handleRemoveAttachedFile = useCallback((fileId: string) => {
    setAttachedFiles((current) => current.filter((file) => file.fileId !== fileId));
  }, []);

  const handleClearAttachedFiles = useCallback(() => {
    setAttachedFiles([]);
  }, []);

  const handleLocalFilesUpload = useCallback(
    async (
      files: Array<File>,
      options?: {
        openDialog?: boolean;
        refreshDialog?: boolean;
      }
    ) => {
      const scope: FilesDialogScope = selectedMatterID ? "matter" : "session";
      const resourceId = scope === "matter" ? selectedMatterID : selectedSessionID;

      if (!resourceId) {
        setErrorText(
          scope === "matter"
            ? "Open a matter folder before uploading files into it."
            : "Open a chat session before uploading files into it."
        );
        return null;
      }

      const shouldOpenDialog = options?.openDialog ?? true;
      const shouldRefreshDialog = options?.refreshDialog ?? true;

      setIsUploadingFiles(true);
      setErrorText(null);

      try {
        const formData = new FormData();
        for (const file of files) {
          formData.append("files", file);
        }

        const response = await fetch(buildFilesApiEndpoint(scope, resourceId), {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              files?: Array<StoredFileListItem>;
              summary?: StoredFileSummary;
              uploadResults?: Array<StoredFileUploadResult>;
              error?: string;
            }
          | null;

        if (!response.ok || !payload?.summary || !payload?.files) {
          throw new Error(payload?.error ?? `Failed to upload ${scope} files`);
        }

        handleFilesSummaryChange(scope, resourceId, payload.summary);
        if (shouldRefreshDialog) {
          setFilesDialogRefreshToken((current) => current + 1);
        }
        if (shouldOpenDialog) {
          setIsFilesDialogOpen(true);
        }
        appendTrace(`${scope} files uploaded: ${files.length}`);
        return {
          files: payload.files,
          summary: payload.summary,
          uploadResults: payload.uploadResults ?? [],
        };
      } catch (error) {
        const message = toErrorMessage(error);
        setErrorText(message);
        appendTrace(`${scope} file upload error: ${message}`);
        return null;
      } finally {
        setIsUploadingFiles(false);
      }
    },
    [appendTrace, handleFilesSummaryChange, selectedMatterID, selectedSessionID]
  );

  const handleMs365FilesUpload = useCallback(
    async (files: Array<Ms365AttachmentSelection>) => {
      const scope: FilesDialogScope = selectedMatterID ? "matter" : "session";
      const resourceId = scope === "matter" ? selectedMatterID : selectedSessionID;

      if (!resourceId) {
        setErrorText(
          scope === "matter"
            ? "Open a matter folder before uploading files into it."
            : "Open a chat session before uploading files into it."
        );
        return null;
      }

      setIsUploadingFiles(true);
      setErrorText(null);

      try {
        const response = await fetch(buildMs365FilesApiEndpoint(scope, resourceId), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            files: files.map((file) => ({
              locationId: file.locationId,
              driveId: file.driveId,
              itemId: file.id,
            })),
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              files?: Array<StoredFileListItem>;
              summary?: StoredFileSummary;
              uploadResults?: Array<StoredFileUploadResult>;
              error?: string;
            }
          | null;

        if (!response.ok || !payload?.summary || !payload?.files) {
          throw new Error(payload?.error ?? `Failed to upload ${scope} Microsoft 365 files`);
        }

        handleFilesSummaryChange(scope, resourceId, payload.summary);
        appendTrace(`${scope} Microsoft 365 files uploaded: ${files.length}`);
        return {
          files: payload.files,
          summary: payload.summary,
          uploadResults: payload.uploadResults ?? [],
        };
      } catch (error) {
        const message = toErrorMessage(error);
        setErrorText(message);
        appendTrace(`${scope} Microsoft 365 file upload error: ${message}`);
        return null;
      } finally {
        setIsUploadingFiles(false);
      }
    },
    [appendTrace, handleFilesSummaryChange, selectedMatterID, selectedSessionID]
  );

  const assignSessionRecordToMatter = useCallback(
    async (sessionRecord: AgentBootstrapSessionRecord, matterID: string) => {
      const response = await fetch(`/api/matters/${matterID}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionRecordId: sessionRecord.id,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; addedByUserId?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to assign session to matter");
      }

      const nextSessionRecord: AgentBootstrapSessionRecord = {
        ...sessionRecord,
        matterId: matterID,
        addedByUserId: payload?.addedByUserId,
      };

      syncSessionRecord(nextSessionRecord);
      return nextSessionRecord;
    },
    [syncSessionRecord]
  );

  const registerSessionRecord = useCallback(
    async (rawSessionID: string, matterID?: string) => {
      const existingSessionRecord = sessionRecordsByRawSessionId[rawSessionID];
      if (existingSessionRecord) {
        if (matterID && existingSessionRecord.matterId !== matterID) {
          return assignSessionRecordToMatter(existingSessionRecord, matterID);
        }
        return existingSessionRecord;
      }

      const inflight = sessionRecordWriteInFlightRef.current.get(rawSessionID);
      if (inflight) {
        const sessionRecord = await inflight;
        if (matterID && sessionRecord.matterId !== matterID) {
          return assignSessionRecordToMatter(sessionRecord, matterID);
        }
        return sessionRecord;
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
          | { error?: string; sessionRecord?: AgentBootstrapSessionRecord }
          | null;

        if (!response.ok || !payload?.sessionRecord) {
          throw new Error(payload?.error ?? "Failed to register session record");
        }

        let sessionRecord = payload.sessionRecord;
        syncSessionRecord(sessionRecord);

        if (matterID && sessionRecord.matterId !== matterID) {
          sessionRecord = await assignSessionRecordToMatter(sessionRecord, matterID);
        }

        return sessionRecord;
      })();

      sessionRecordWriteInFlightRef.current.set(rawSessionID, request);

      try {
        return await request;
      } finally {
        sessionRecordWriteInFlightRef.current.delete(rawSessionID);
      }
    },
    [
      assignSessionRecordToMatter,
      syncSessionRecord,
      sessionRecordsByRawSessionId,
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
    reasoningPartIDsRef.current.clear();
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
      syncModelSelectionFromStoredMessages(storedMessages);
      rebuildEventCachesFromMessageState(nextState.messages, nextState.partsByMessageID);
      replaceReasoningPartIDCache(storedMessages);
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
    syncModelSelectionFromStoredMessages,
  ]);

  const handleSelectMatter = useCallback(
    (matterID: string) => {
      router.push(`/agent/matters/${matterID}`);
    },
    [router]
  );

  const handleSelectSessionRecord = useCallback(
    (sessionRecordID: string) => {
      const sessionRecord = sessionRecordsById[sessionRecordID];
      if (!sessionRecord) return;

      setSelectedSessionRecordID(sessionRecordID);
      setSelectedMatterID(sessionRecord.matterId ?? "");
      setSelectedSessionID(sessionRecord.rawSessionId);
      router.push(buildChatRoute(sessionRecordID, sessionRecord.matterId));
    },
    [router, sessionRecordsById]
  );

  const handleMatterCreated = useCallback(
    (matterID: string) => {
      setErrorText(null);
      setSelectedMatterID(matterID);
      setSelectedSessionRecordID("");
      setSelectedSessionID("");
      router.push(`/agent/matters/${matterID}`);
    },
    [router]
  );

  const handleMatterUpdated = useCallback((updatedMatter: {
    id: string;
    code: string;
    title: string;
    description?: string;
  }) => {
    setMatters((current) =>
      current.map((matter) =>
        matter.id === updatedMatter.id
          ? {
              ...matter,
              code: updatedMatter.code,
              title: updatedMatter.title,
              description: updatedMatter.description,
            }
          : matter
      )
    );
  }, []);

  const handleOpenChatsWorkspace = useCallback(() => {
    router.push("/agent");
  }, [router]);

  const handleOpenMattersWorkspace = useCallback(() => {
    router.push("/agent/matters");
  }, [router]);

  useEffect(() => {
    if (lastRouteSyncKeyRef.current === routeSyncKey) {
      return;
    }
    lastRouteSyncKeyRef.current = routeSyncKey;
    const bootstrapModelSelectionState = resolveStoredModelSelectionState(
      bootstrap.initialSessionSnapshot?.storedMessages ?? []
    );
    const preferredVariantSelection = buildPreferredVariantSelection(
      bootstrap.modelCatalog.variants,
      bootstrap.modelCatalog.preferredVariantByModelKey
    );
    const nextSelectedModelKey =
      bootstrapModelSelectionState.selectedModelKey ??
      resolvePreferredSelectableModelKey({
        selectableModels: bootstrap.modelCatalog.selectableModels,
        defaultModelKey: bootstrap.modelCatalog.defaultModelKey,
      });

    setSelectedMatterID(bootstrap.initialMatterId ?? "");
    setSelectedSessionRecordID(bootstrap.initialSessionRecordId ?? "");
    setSelectedSessionID(bootstrap.initialRawSessionId ?? "");
    setMatters(bootstrap.matters);
    setMatterFileSummaryByMatterId(bootstrap.matterFileSummaryByMatterId);
    setSessionFileSummaryByRawSessionId(bootstrap.sessionFileSummaryByRawSessionId);
    setSessionRecordsByRawSessionId(bootstrap.sessionRecordsByRawSessionId);
    setMatterSessionIdsByMatterId(bootstrap.matterSessionIdsByMatterId);
    setAvailableSessions(bootstrap.availableSessions);
    setAttachedFiles([]);
    setSelectedModelKey(nextSelectedModelKey);
    setSelectedVariantByModelKey(
      mergeVariantSelectionState({
        storedSelection: bootstrapModelSelectionState.selectedVariantByModelKey,
        preferredSelection: preferredVariantSelection,
      })
    );
    setModelSelectionPolicy(bootstrap.modelSelectionPolicy);
    setIsFilesDialogOpen(false);
    pendingSidebarSessionRef.current = null;
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
      reasoningPartIDsRef.current.clear();
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
    bootstrap.modelSelectionPolicy,
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
    const sessionRecord = await registerSessionRecord(
      createdSession.id,
      selectedMatterID || undefined
    );
    resetSessionTokenTracking();
    sessionIDRef.current = createdSession.id;
    setSessionID(createdSession.id);
    setSelectedSessionID(createdSession.id);
    setSelectedSessionRecordID(sessionRecord.id);
    setSelectedMatterID(sessionRecord.matterId ?? selectedMatterID);
    pendingSidebarSessionRef.current = {
      sessionRecordId: sessionRecord.id,
      rawSessionId: createdSession.id,
      matterId: sessionRecord.matterId ?? selectedMatterID ?? undefined,
      title: resolveDisplayedSessionTitle(sessionRecord.title, createdSession.title),
      updated: Date.now(),
      created: Date.now(),
    };
    appendTrace(`session created: ${createdSession.id}`);
    void loadSessionOptions();

    return createdSession.id;
  }, [
    appendTrace,
    ensureClients,
    ensureEventStream,
    loadSessionOptions,
    registerSessionRecord,
    refreshModelContextLimits,
    resetSessionTokenTracking,
    selectedMatterID,
  ]);

  const sendPrompt = useCallback(async () => {
    const { displayPrompt, runtimePrompt } = buildPromptFromComposerState(inputText, attachedFiles);
    if (!runtimePrompt || isBusy || isLoadingSelectedSession) return;
    const userMessageID = `msg_ffffffffffff${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const userCreatedAt = Date.now();
    const promptModel = currentModelKey ? splitModelKey(currentModelKey) : null;
    const promptVariant = currentModelVariant ?? undefined;
    const nextAttachedFileRefs = attachedFiles.map((file) => ({
      path: file.relativePath,
      label: file.originalName,
    }));

    setInputText("");
    setErrorText(null);
    setPendingQuestions([]);
    setPendingPermissions([]);

    partTextSeenRef.current.clear();
    toolStateSeenRef.current.clear();
    reasoningPartIDsRef.current.clear();
    activeAssistantServerMessageIDRef.current = null;

    appendTrace(
      promptModel
        ? `prompt sent (${runtimePrompt.length} chars) [model: ${currentModelKey}${promptVariant ? ` · ${promptVariant}` : ""}]`
        : `prompt sent (${runtimePrompt.length} chars)`
    );

    const runID = crypto.randomUUID();
    shouldAutoScrollRef.current = true;
    appendUserCard(userMessageID, displayPrompt, userCreatedAt, true, nextAttachedFileRefs);
    pendingOptimisticUserRef.current = {
      localMessageID: userMessageID,
      sessionID: null,
      text: displayPrompt,
      attachedFiles: nextAttachedFileRefs,
      createdAt: userCreatedAt,
    };
    setAttachedFiles([]);

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
        model: currentModelKey
          ? `${currentModelKey}${promptVariant ? ` · ${promptVariant}` : ""}`
          : undefined,
        toolCalls: new Map<string, RuntimeToolCall>(),
        fail,
        finish,
      };
      pendingOptimisticUserRef.current = {
        localMessageID: userMessageID,
        sessionID: liveSessionID,
        text: displayPrompt,
        attachedFiles: nextAttachedFileRefs,
        createdAt: userCreatedAt,
      };
      streamLastEventAtRef.current = Date.now();

      await client.session.promptAsync({
        sessionID: liveSessionID,
        model: promptModel ?? undefined,
        variant: promptVariant,
        parts: [{ type: "text", text: runtimePrompt }],
      });

      const pendingSidebarSession = pendingSidebarSessionRef.current;
      if (pendingSidebarSession?.rawSessionId === liveSessionID) {
        setAvailableSessions((current) => {
          const nextEntry: SessionOption = {
            id: pendingSidebarSession.rawSessionId,
            title: pendingSidebarSession.title,
            updated: pendingSidebarSession.updated,
            created: pendingSidebarSession.created,
          };

          const withoutCurrent = current.filter(
            (session) => session.id !== pendingSidebarSession.rawSessionId
          );
          return [nextEntry, ...withoutCurrent].sort((left, right) => right.updated - left.updated);
        });
        pendingSidebarSessionRef.current = null;
      }

      scheduleInteractiveRefresh(0);
    } catch (error) {
      const message = toErrorMessage(error);
      pendingOptimisticUserRef.current = null;
      setAttachedFiles(attachedFiles);
      setErrorText(message);
      setIsBusy(false);
      appendTrace(`prompt error: ${message}`);

      if (activeRunRef.current?.id === runID) {
        activeRunRef.current = null;
      }
      markAssistantCardsComplete();
    }
  }, [
    attachedFiles,
    appendUserCard,
    appendTrace,
    currentModelKey,
    currentModelVariant,
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
      const nextSelectedModelKey = resolvePreferredSelectableModelKey({
        selectableModels: availableSelectableModels,
        defaultModelKey: defaultSelectableModelKey,
      });
      const preferredVariantSelection = buildPreferredVariantSelection(
        availableModelVariantsByKey,
        bootstrap.modelCatalog.preferredVariantByModelKey
      );

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
      reasoningPartIDsRef.current.clear();
      activeAssistantServerMessageIDRef.current = null;
      resetSessionTokenTracking();

      setSessionID(null);
      setSelectedSessionID("");
      setSelectedSessionRecordID("");
      shouldAutoScrollRef.current = true;
      setTimeline([]);
      setInputText("");
      setAttachedFiles([]);
      setSelectedModelKey(nextSelectedModelKey);
      setSelectedVariantByModelKey(preferredVariantSelection);
      setIsFilesDialogOpen(false);
      setIsUploadingFiles(false);
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
      const targetRoute = selectedMatterID
        ? `/agent/matters/${selectedMatterID}`
        : workspaceMode === "matters"
          ? "/agent/matters"
          : "/agent";
      router.push(targetRoute);
  }, [
    availableModelVariantsByKey,
    availableSelectableModels,
    bootstrap.modelCatalog.preferredVariantByModelKey,
    defaultSelectableModelKey,
    loadSessionOptions,
    resetSessionTokenTracking,
    router,
    selectedMatterID,
    workspaceMode,
  ]);

  const handleCreateChat = useCallback(() => {
    if (workspaceMode === "matters" && !selectedMatterID) return;
    resetSession();
  }, [resetSession, selectedMatterID, workspaceMode]);

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
  const modelLabel = currentModelKey
    ? selectableModelLabelByKey[currentModelKey] ?? currentModelKey
    : "-";
  const currentSelectableModelKey =
    currentModelKey && availableSelectableModels.some((model) => model.key === currentModelKey)
      ? currentModelKey
      : null;
  const modelVariantLabel = currentModelKey ? currentModelVariant ?? "default" : "-";
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
    const sessionRecord = sessionRecordsByRawSessionId[session.id];
    if (!sessionRecord) return [];

    return [
      {
        sessionRecordId: sessionRecord.id,
        rawSessionId: session.id,
        title: resolveDisplayedSessionTitle(sessionRecord.title, session.title),
        updatedLabel: new Date(session.updated || session.created).toLocaleDateString(),
        shortID: sessionRecord.id.slice(0, 8),
      },
    ];
  });
  const canCreateChat = workspaceMode === "chats" || Boolean(selectedMatterID);
  const isMatterSelectionRequired = workspaceMode === "matters" && !selectedMatterID;
  const recentChats =
    workspaceMode === "chats"
      ? sidebarSessions.filter(
          (session) => !sessionRecordsById[session.sessionRecordId]?.matterId
        )
      : [];
  const matterFolders: Array<MatterChatSidebarMatter> =
    workspaceMode === "matters"
      ? matters.map((matter) => {
          const rawSessionIds = matterSessionIdsByMatterId[matter.id] ?? [];
          const rawSessionIdSet = new Set(rawSessionIds);

          return {
            id: matter.id,
            code: matter.code,
            title: matter.title,
            description: matter.description,
            chats: sidebarSessions.filter((session) => rawSessionIdSet.has(session.rawSessionId)),
          };
        })
      : [];
  const activeMatter = selectedMatterID
    ? matters.find((matter) => matter.id === selectedMatterID)
    : undefined;
  const activeFilesScope: FilesDialogScope = selectedMatterID ? "matter" : "session";
  const currentFilesResourceId =
    activeFilesScope === "matter" ? selectedMatterID || undefined : selectedSessionID || undefined;
  const currentFilesSummary =
    activeFilesScope === "matter"
      ? selectedMatterID
        ? matterFileSummaryByMatterId[selectedMatterID] ?? {
            fileCount: 0,
            hasFiles: false,
          }
        : undefined
      : selectedSessionID
        ? sessionFileSummaryByRawSessionId[selectedSessionID] ?? {
            fileCount: 0,
            hasFiles: false,
          }
        : undefined;
  const composerPlaceholder = isMatterSelectionRequired
    ? "Select a matter folder to start a chat..."
    : workspaceMode === "matters" && activeMatter && !selectedSessionID
      ? `New chat in ${activeMatter.title}...`
      : "Write a message...";
  const timelineEmptyState =
    !selectedSessionID && workspaceMode === "matters"
      ? activeMatter ? (
          <MatterOverviewEmptyState
            code={activeMatter.code}
            title={activeMatter.title}
            description={activeMatter.description}
          />
        ) : (
          <MattersWorkspaceEmptyState />
        )
      : undefined;

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
          canCreateChat={canCreateChat}
          isLoadingRecentChats={isLoadingSessionOptions}
          matters={matterFolders}
          recentChats={recentChats}
          selectedMatterID={selectedMatterID}
          selectedSessionRecordID={selectedSessionRecordID}
          userEmail={bootstrap.user.email}
          workspaceMode={workspaceMode}
          onCreateChat={handleCreateChat}
          onMatterCreated={handleMatterCreated}
          onMatterUpdated={handleMatterUpdated}
          onOpenChatsWorkspace={handleOpenChatsWorkspace}
          onOpenMattersWorkspace={handleOpenMattersWorkspace}
          onSelectMatter={handleSelectMatter}
          onSelectSession={handleSelectSessionRecord}
          onSessionRenamed={handleSessionRenamed}
        />

        <Card className="agent-panel min-h-0 min-w-0 gap-0 overflow-hidden rounded-none border-2 py-0 shadow-none">
          <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col px-0">
            <AgentSessionHeader
              availableSessions={availableSessions}
              isBusy={isBusy}
              selectedSessionID={selectedSessionID}
              onToggleTrace={() => setShowTrace((value) => !value)}
              showTrace={showTrace}
            />

            <div ref={timelineScrollAreaRef} className="min-h-0 flex-1 min-w-0">
              <ScrollArea type="always" className="h-full min-w-0">
                <AgentTimeline
                  emptyState={timelineEmptyState}
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
            attachedFiles={attachedFiles}
            availableModels={availableSelectableModels.map((model) => ({
              key: model.key,
              label: model.label,
            }))}
            availableModelVariants={availableModelVariants}
            canSelectModel={
              availableSelectableModels.length > 0 &&
              !isBusy &&
              !isLoadingSelectedSession
            }
            canSelectModelVariant={
              Boolean(currentModelKey) &&
              availableModelVariants.length > 0 &&
              !isBusy &&
              !isLoadingSelectedSession
            }
            composerPlaceholder={composerPlaceholder}
            canManageFiles={Boolean(currentFilesResourceId)}
            contextBreakdownRows={contextBreakdownRows}
            contextUsageText={contextUsageText}
            currentModelSelectionKey={currentSelectableModelKey}
            currentModelVariantLabel={modelVariantLabel}
            filesScopeLabel={activeFilesScope}
            inputText={inputText}
            isBusy={isBusy}
            isMatterSelectionRequired={isMatterSelectionRequired}
            isLoadingSelectedSession={isLoadingSelectedSession}
            latestContextUsage={latestContextUsage}
            modelLabel={modelLabel}
            onClearAttachedFiles={handleClearAttachedFiles}
            onInputTextChange={setInputText}
            currentFilesSummary={currentFilesSummary}
            onOpenFiles={handleOpenFiles}
            onKeyDown={handleComposerKeyDown}
            onRemoveAttachedFile={handleRemoveAttachedFile}
            onSelectModel={handleSelectModel}
            onSelectModelVariant={handleSelectModelVariant}
            onSend={() => void sendPrompt()}
            sendDisabled={
              !inputText.trim() ||
              isBusy ||
              isLoadingSelectedSession ||
              isMatterSelectionRequired
            }
            sessionCostFormulaGroups={sessionCostFormulaGroups}
            sessionCostFormulaTotal={sessionCostFormulaTotal}
            sessionSpendText={sessionSpendText}
            sessionTotalsRows={sessionTotalsRows}
            textareaRef={composerTextareaRef}
          />
        </Card>

        <SessionFilesDialog
          canUploadFiles={Boolean(currentFilesResourceId)}
          isUploadingFiles={isUploadingFiles}
          onAddFiles={(files) =>
            handleLocalFilesUpload(files, {
              openDialog: false,
              refreshDialog: false,
            })
          }
          onAddMs365Files={handleMs365FilesUpload}
          open={isFilesDialogOpen}
          scope={activeFilesScope}
          resourceId={currentFilesResourceId}
          onAttachFiles={handleAttachFiles}
          onOpenChange={setIsFilesDialogOpen}
          onSummaryChange={handleFilesSummaryChange}
          refreshToken={filesDialogRefreshToken}
        />

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
