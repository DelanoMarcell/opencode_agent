"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";
import {
  createOpencodeClient,
  type Event,
  type Part,
} from "@opencode-ai/sdk/client";
import {
  createOpencodeClient as createOpencodeClientV2,
  type PermissionRequest,
  type QuestionInfo,
  type QuestionOption,
  type QuestionRequest,
} from "@opencode-ai/sdk/v2/client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_OPENCODE_BASE_URL ?? "http://localhost:4096";

type StreamEvent = Event | { payload: Event };
type ToolPart = Extract<Part, { type: "tool" }>;

type RuntimeToolCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
  result?: unknown;
  isError?: boolean;
  status: "pending" | "running" | "completed" | "error";
};

type TimelineItem =
  | {
      id: string;
      kind: "user";
      text: string;
    }
  | {
      id: string;
      kind: "assistant-text";
      text: string;
      running: boolean;
    }
  | {
      id: string;
      kind: "tool";
      toolCall: RuntimeToolCall;
    };

type ActiveRun = {
  id: string;
  sessionID: string;
  assistantText: string;
  model?: string;
  toolCalls: Map<string, RuntimeToolCall>;
  finish: () => void;
  fail: (error: Error) => void;
};

type SessionOption = {
  id: string;
  title: string;
  updated: number;
  created: number;
};

type TokenUsageTotals = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

type StoredMessage = {
  info: {
    id: string;
    role: string;
    time: {
      created: number;
    };
  } & Record<string, unknown>;
  parts: Array<Part>;
};

const ZERO_TOKEN_USAGE: TokenUsageTotals = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function normalizeEvent(event: StreamEvent): Event {
  return "payload" in event ? event.payload : event;
}

function summarizeText(value: string, maxLength = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function toCompactJSON(value: unknown, maxLength = 180): string {
  try {
    const text = JSON.stringify(value);
    if (!text) return String(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
  } catch {
    return String(value);
  }
}

function toTokenNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function areTokenTotalsEqual(left: TokenUsageTotals, right: TokenUsageTotals): boolean {
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.reasoning === right.reasoning &&
    left.cacheRead === right.cacheRead &&
    left.cacheWrite === right.cacheWrite
  );
}

function sumTokenTotals(values: Iterable<TokenUsageTotals>): TokenUsageTotals {
  const total = { ...ZERO_TOKEN_USAGE };
  for (const value of values) {
    total.input += value.input;
    total.output += value.output;
    total.reasoning += value.reasoning;
    total.cacheRead += value.cacheRead;
    total.cacheWrite += value.cacheWrite;
  }
  return total;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(value)));
}

function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function parseAssistantUsageFromInfo(info: Record<string, unknown>): {
  messageID: string;
  modelKey: string | null;
  usage: TokenUsageTotals | null;
} | null {
  if (info.role !== "assistant") return null;
  const messageID = typeof info.id === "string" ? info.id : null;
  if (!messageID) return null;

  const providerID = typeof info.providerID === "string" ? info.providerID : "";
  const modelID = typeof info.modelID === "string" ? info.modelID : "";
  const modelKey = providerID && modelID ? getModelKey(providerID, modelID) : null;

  const tokens = info.tokens;
  if (!tokens || typeof tokens !== "object") {
    return { messageID, modelKey, usage: null };
  }

  const tokenRecord = tokens as Record<string, unknown>;
  const cacheRecord =
    tokenRecord.cache && typeof tokenRecord.cache === "object"
      ? (tokenRecord.cache as Record<string, unknown>)
      : undefined;

  const usage: TokenUsageTotals = {
    input: toTokenNumber(tokenRecord.input),
    output: toTokenNumber(tokenRecord.output),
    reasoning: toTokenNumber(tokenRecord.reasoning),
    cacheRead: toTokenNumber(cacheRecord?.read),
    cacheWrite: toTokenNumber(cacheRecord?.write),
  };

  return { messageID, modelKey, usage };
}

function parseQuestionAnswer(
  raw: string,
  options: Array<QuestionOption>,
  multiple: boolean,
  customAllowed: boolean
): Array<string> {
  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (!tokens.length) return [];

  const answers: Array<string> = [];
  for (const token of tokens) {
    const asIndex = Number(token);
    if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= options.length) {
      answers.push(options[asIndex - 1].label);
      continue;
    }

    const byLabel = options.find(
      (option) => option.label.toLowerCase() === token.toLowerCase()
    );
    if (byLabel) {
      answers.push(byLabel.label);
      continue;
    }

    if (customAllowed || options.length === 0) {
      answers.push(token);
    }
  }

  const deduped = [...new Set(answers)];
  return multiple ? deduped : deduped.slice(0, 1);
}

function renderQuestionHints(question: QuestionInfo): string {
  if (!question.options.length) {
    return question.custom === false
      ? "No explicit choices were provided."
      : "Type your answer freely.";
  }

  const labels = question.options.map((option) => option.label).join(", ");
  return question.multiple
    ? `Choose multiple (comma-separated): ${labels}`
    : `Choose one: ${labels}`;
}

function extractCommandFromInput(input: Record<string, unknown>): string | undefined {
  const directKeys = ["command", "cmd", "script", "shellCommand"];
  for (const key of directKeys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  const command = input.command;
  const args = input.args;
  if (
    typeof command === "string" &&
    Array.isArray(args) &&
    args.every((item) => typeof item === "string")
  ) {
    const joined = [command, ...args].join(" ").trim();
    if (joined) return joined;
  }

  return undefined;
}

function getToolSignature(part: ToolPart): string {
  const command = extractCommandFromInput(part.state.input);
  const commandKey = command ? summarizeText(command, 80) : "";

  if (part.state.status === "pending") return `pending:${commandKey}`;
  if (part.state.status === "running") {
    return `running:${part.state.title ?? ""}:${commandKey}`;
  }
  if (part.state.status === "completed") {
    const output = part.state.output ? summarizeText(part.state.output, 100) : "";
    return `completed:${part.state.title}:${commandKey}:${output}`;
  }

  return `error:${part.state.error}:${commandKey}`;
}

function formatToolUpdate(part: ToolPart): string {
  const command = extractCommandFromInput(part.state.input);
  const commandText = command ? ` | cmd: ${summarizeText(command, 160)}` : "";
  const base = `${part.tool}#${part.callID}`;

  if (part.state.status === "pending") {
    return `tool pending: ${base}${commandText}`;
  }

  if (part.state.status === "running") {
    const title = part.state.title ? ` | ${part.state.title}` : "";
    return `tool running: ${base}${title}${commandText}`;
  }

  if (part.state.status === "completed") {
    const title = part.state.title ? ` | ${part.state.title}` : "";
    const output = part.state.output
      ? ` | output: ${summarizeText(part.state.output, 120)}`
      : "";
    return `tool completed: ${base}${title}${commandText}${output}`;
  }

  return `tool error: ${base}${commandText} | ${summarizeText(part.state.error, 160)}`;
}

function getAssistantError(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const details = error as Record<string, unknown>;
  const name = typeof details.name === "string" ? details.name : "Error";
  const data = details.data;

  if (data && typeof data === "object") {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) {
      return `${name}: ${message}`;
    }
  }

  return name;
}

function normalizeToolArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseToolOutput(output: string | undefined): unknown {
  if (!output || !output.trim()) return undefined;
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

function toRuntimeToolCall(
  part: ToolPart,
  previous?: RuntimeToolCall
): RuntimeToolCall {
  const args = normalizeToolArgs(part.state.input);
  const status = part.state.status;
  const base: RuntimeToolCall = {
    toolCallId: String(part.callID ?? part.id),
    toolName: part.tool,
    args,
    argsText: toCompactJSON(args, 4000),
    result: previous?.result,
    isError: previous?.isError,
    status,
  };

  if (status === "completed") {
    return {
      ...base,
      result: parseToolOutput(part.state.output),
      isError: false,
    };
  }

  if (status === "error") {
    return {
      ...base,
      result: part.state.error,
      isError: true,
    };
  }

  return base;
}

function formatToolResult(result: unknown): string {
  if (result === undefined) return "";
  if (typeof result === "string") return result;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function formatSessionOptionLabel(session: SessionOption): string {
  const title = session.title?.trim() ? session.title.trim() : "Untitled";
  const timestamp = new Date(session.updated || session.created).toLocaleString();
  const shortID = session.id.slice(0, 8);
  return `${title} • ${shortID} • ${timestamp}`;
}

export default function AgentPage() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [sessionID, setSessionID] = useState<string | null>(null);
  const [availableSessions, setAvailableSessions] = useState<Array<SessionOption>>([]);
  const [selectedSessionID, setSelectedSessionID] = useState("");
  const [timeline, setTimeline] = useState<Array<TimelineItem>>([]);
  const [inputText, setInputText] = useState("");
  const [traceLines, setTraceLines] = useState<Array<string>>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<Array<QuestionRequest>>([]);
  const [pendingPermissions, setPendingPermissions] = useState<
    Array<PermissionRequest>
  >([]);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, Array<string>>>(
    {}
  );
  const [isBusy, setIsBusy] = useState(false);
  const [showTrace, setShowTrace] = useState(true);
  const [activeModelKey, setActiveModelKey] = useState<string | null>(null);
  const [activeContextLimit, setActiveContextLimit] = useState<number | null>(null);
  const [sessionTokenTotals, setSessionTokenTotals] =
    useState<TokenUsageTotals>(ZERO_TOKEN_USAGE);
  const [modelLimitRevision, setModelLimitRevision] = useState(0);

  const configuredBaseURLRef = useRef<string | null>(null);
  const sessionIDRef = useRef<string | null>(null);
  const v1ClientRef = useRef<ReturnType<typeof createOpencodeClient> | null>(null);
  const v2ClientRef = useRef<ReturnType<typeof createOpencodeClientV2> | null>(null);
  const eventStreamAbortRef = useRef<AbortController | null>(null);
  const eventStreamTaskRef = useRef<Promise<void> | null>(null);
  const pollingInteractiveRef = useRef(false);
  const messageRoleByIDRef = useRef<Map<string, "user" | "assistant">>(new Map());
  const partTextSeenRef = useRef<Map<string, string>>(new Map());
  const toolStateSeenRef = useRef<Map<string, string>>(new Map());
  const toolCardByCallIDRef = useRef<Map<string, string>>(new Map());
  const openTextSegmentRef = useRef<{ partID: string; itemID: string } | null>(null);
  const activeAssistantServerMessageIDRef = useRef<string | null>(null);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const assistantUsageByMessageIDRef = useRef<Map<string, TokenUsageTotals>>(new Map());
  const modelContextLimitByKeyRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    sessionIDRef.current = sessionID;
  }, [sessionID]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [timeline]);

  useEffect(() => {
    if (!activeModelKey) {
      setActiveContextLimit(null);
      return;
    }
    setActiveContextLimit(modelContextLimitByKeyRef.current.get(activeModelKey) ?? null);
  }, [activeModelKey, modelLimitRevision]);

  const rebuildSessionTokenTotals = useCallback(() => {
    setSessionTokenTotals(sumTokenTotals(assistantUsageByMessageIDRef.current.values()));
  }, []);

  const resetSessionTokenTracking = useCallback(() => {
    assistantUsageByMessageIDRef.current.clear();
    setSessionTokenTotals(ZERO_TOKEN_USAGE);
    setActiveModelKey(null);
  }, []);

  const upsertAssistantUsage = useCallback(
    (messageID: string, usage: TokenUsageTotals) => {
      const previous = assistantUsageByMessageIDRef.current.get(messageID);
      if (previous && areTokenTotalsEqual(previous, usage)) return;
      assistantUsageByMessageIDRef.current.set(messageID, usage);
      rebuildSessionTokenTotals();
    },
    [rebuildSessionTokenTotals]
  );

  const appendTrace = useCallback((line: string) => {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${line}`;
    setTraceLines((previous) => [...previous.slice(-299), formatted]);
  }, []);

  const appendUserCard = useCallback((text: string) => {
    setTimeline((previous) => [
      ...previous,
      {
        id: `user-${crypto.randomUUID()}`,
        kind: "user",
        text,
      },
    ]);
  }, []);

  const appendAssistantTextChunk = useCallback(
    (partID: string, chunk: string, running: boolean) => {
      if (!chunk) return;

      setTimeline((previous) => {
        const next = [...previous];
        const activeSegment = openTextSegmentRef.current;
        if (activeSegment && activeSegment.partID === partID) {
          const index = next.findIndex((item) => item.id === activeSegment.itemID);
          if (index >= 0) {
            const existing = next[index];
            if (existing.kind === "assistant-text") {
              next[index] = {
                ...existing,
                text: `${existing.text}${chunk}`,
                running,
              };
              return next;
            }
          }
        }

        const itemID = `assistant-text-${crypto.randomUUID()}`;
        next.push({
          id: itemID,
          kind: "assistant-text",
          text: chunk,
          running,
        });
        openTextSegmentRef.current = { partID, itemID };
        return next;
      });
    },
    []
  );

  const upsertToolCard = useCallback((toolCall: RuntimeToolCall) => {
    setTimeline((previous) => {
      const next = [...previous];
      const existingItemID = toolCardByCallIDRef.current.get(toolCall.toolCallId);
      if (existingItemID) {
        const index = next.findIndex((item) => item.id === existingItemID);
        if (index >= 0 && next[index].kind === "tool") {
          next[index] = {
            ...next[index],
            toolCall,
          };
          return next;
        }
      }

      const itemID = existingItemID ?? `tool-${toolCall.toolCallId}-${crypto.randomUUID()}`;
      toolCardByCallIDRef.current.set(toolCall.toolCallId, itemID);
      next.push({
        id: itemID,
        kind: "tool",
        toolCall,
      });
      return next;
    });

    // A tool card breaks any active text segment; subsequent text gets a new card.
    openTextSegmentRef.current = null;
  }, []);

  const markAssistantCardsComplete = useCallback(() => {
    openTextSegmentRef.current = null;
    setTimeline((previous) =>
      previous.map((item) =>
        item.kind === "assistant-text" && item.running
          ? { ...item, running: false }
          : item
      )
    );
  }, []);

  const buildTimelineFromStoredMessages = useCallback(
    (storedMessages: Array<StoredMessage>) => {
      const ordered = [...storedMessages].sort(
        (left, right) => left.info.time.created - right.info.time.created
      );
      const items: Array<TimelineItem> = [];

      for (const message of ordered) {
        if (message.info.role === "user") {
          const text = message.parts
            .filter(
              (part): part is Extract<Part, { type: "text" }> => part.type === "text"
            )
            .map((part) => part.text)
            .join("\n")
            .trim();

          if (text) {
            items.push({
              id: `history-user-${message.info.id}`,
              kind: "user",
              text,
            });
          }
          continue;
        }

        if (message.info.role === "assistant") {
          for (const part of message.parts) {
            if (part.type === "text") {
              const text = part.text.trim();
              if (!text) continue;

              items.push({
                id: `history-text-${part.id}`,
                kind: "assistant-text",
                text: part.text,
                running: false,
              });
            }

            if (part.type === "tool") {
              items.push({
                id: `history-tool-${part.id}`,
                kind: "tool",
                toolCall: toRuntimeToolCall(part),
              });
            }
          }
        }
      }

      return items;
    },
    []
  );

  const rebuildSessionUsageFromStoredMessages = useCallback(
    (storedMessages: Array<StoredMessage>) => {
      const ordered = [...storedMessages].sort(
        (left, right) => left.info.time.created - right.info.time.created
      );

      assistantUsageByMessageIDRef.current.clear();
      let nextModelKey: string | null = null;

      for (const message of ordered) {
        const snapshot = parseAssistantUsageFromInfo(message.info);
        if (!snapshot) continue;
        if (snapshot.modelKey) nextModelKey = snapshot.modelKey;
        if (snapshot.usage) {
          assistantUsageByMessageIDRef.current.set(snapshot.messageID, snapshot.usage);
        }
      }

      setActiveModelKey(nextModelKey);
      rebuildSessionTokenTotals();
    },
    [rebuildSessionTokenTotals]
  );

  const ensureClients = useCallback(() => {
    if (sessionIDRef.current && configuredBaseURLRef.current !== baseUrl) {
      throw new Error(
        "Cannot change base URL while a session is active. Start a new session first."
      );
    }

    if (
      configuredBaseURLRef.current === baseUrl &&
      v1ClientRef.current &&
      v2ClientRef.current
    ) {
      return;
    }

    v1ClientRef.current = createOpencodeClient({ baseUrl });
    v2ClientRef.current = createOpencodeClientV2({ baseUrl });
    configuredBaseURLRef.current = baseUrl;
    modelContextLimitByKeyRef.current = new Map();
    setModelLimitRevision((value) => value + 1);
  }, [baseUrl]);

  const refreshModelContextLimits = useCallback(async () => {
    try {
      ensureClients();
      const client = v1ClientRef.current;
      if (!client) return;

      const result = await client.provider.list();
      if (result.error) {
        const message = getAssistantError(result.error);
        if (message) appendTrace(`provider metadata error: ${message}`);
        return;
      }

      const nextLimits = new Map<string, number>();
      for (const provider of result.data?.all ?? []) {
        const providerID = provider.id;
        const models = provider.models ?? {};

        for (const model of Object.values(models)) {
          const contextLimit = model.limit?.context;
          if (typeof contextLimit !== "number" || !Number.isFinite(contextLimit)) continue;
          nextLimits.set(getModelKey(providerID, model.id), Math.max(0, Math.floor(contextLimit)));
        }
      }

      modelContextLimitByKeyRef.current = nextLimits;
      setModelLimitRevision((value) => value + 1);
    } catch (error) {
      appendTrace(`provider metadata error: ${toErrorMessage(error)}`);
    }
  }, [appendTrace, ensureClients]);

  const refreshPendingInteractiveRequests = useCallback(async () => {
    if (pollingInteractiveRef.current) return;

    const client = v2ClientRef.current;
    const currentSessionID = sessionIDRef.current;
    if (!client || !currentSessionID) return;

    pollingInteractiveRef.current = true;
    try {
      const [questionResult, permissionResult] = await Promise.all([
        client.question.list(),
        client.permission.list(),
      ]);

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
      pollingInteractiveRef.current = false;
    }
  }, [appendTrace]);

  const getLatestAssistantText = useCallback(async (targetSessionID: string) => {
    const client = v1ClientRef.current;
    if (!client) return "";

    const { data: sessionMessages } = await client.session.messages({
      path: { id: targetSessionID },
      query: { limit: 50 },
    });

    if (!sessionMessages?.length) return "";

    const latestAssistant = [...sessionMessages]
      .reverse()
      .find((message) => message.info.role === "assistant");

    if (!latestAssistant) return "";

    return latestAssistant.parts
      .filter(
        (part): part is Extract<Part, { type: "text" }> => part.type === "text"
      )
      .map((part) => part.text)
      .join("");
  }, []);

  const processEvent = useCallback(
    async (event: Event) => {
      const currentSessionID = sessionIDRef.current;
      const activeRun = activeRunRef.current;
      const eventType = event.type as string;

      if (event.type === "message.updated") {
        const info = event.properties.info;
        if (!currentSessionID || info.sessionID !== currentSessionID) return;

        messageRoleByIDRef.current.set(info.id, info.role);
        if (info.role === "assistant") {
          activeAssistantServerMessageIDRef.current = info.id;

          const usageSnapshot = parseAssistantUsageFromInfo(info as Record<string, unknown>);
          if (usageSnapshot?.modelKey) {
            setActiveModelKey(usageSnapshot.modelKey);
          }
          if (usageSnapshot?.usage) {
            upsertAssistantUsage(usageSnapshot.messageID, usageSnapshot.usage);
          }

          if (activeRun && activeRun.sessionID === info.sessionID) {
            const provider = "providerID" in info ? String(info.providerID) : "unknown";
            const model = "modelID" in info ? String(info.modelID) : "unknown";
            activeRun.model = `${provider}/${model}`;

            const assistantError = getAssistantError(
              "error" in info ? info.error : undefined
            );
            if (assistantError) appendTrace(`assistant error: ${assistantError}`);
          }
        }
        return;
      }

      if (event.type === "message.part.updated") {
        const { part, delta } = event.properties;
        if (!currentSessionID || part.sessionID !== currentSessionID) return;

        if (part.type === "text") {
          if (!activeRun || activeRun.sessionID !== part.sessionID) return;

          const messageRole = messageRoleByIDRef.current.get(part.messageID);
          if (messageRole === "user") return;
          activeAssistantServerMessageIDRef.current = part.messageID;

          if (typeof delta === "string" && delta.length > 0) {
            activeRun.assistantText += delta;
            appendAssistantTextChunk(part.id, delta, true);
            return;
          }

          const previousText = partTextSeenRef.current.get(part.id) ?? "";
          const append = part.text.startsWith(previousText)
            ? part.text.slice(previousText.length)
            : part.text;

          if (append.length > 0) {
            activeRun.assistantText += append;
            appendAssistantTextChunk(part.id, append, true);
          }

          partTextSeenRef.current.set(part.id, part.text);
          return;
        }

        if (part.type === "tool") {
          const signature = getToolSignature(part);
          if (toolStateSeenRef.current.get(part.id) !== signature) {
            toolStateSeenRef.current.set(part.id, signature);
            appendTrace(formatToolUpdate(part));
          }

          if (activeRun && activeRun.sessionID === part.sessionID) {
            const previous = activeRun.toolCalls.get(String(part.callID ?? part.id));
            const next = toRuntimeToolCall(part, previous);
            activeRun.toolCalls.set(next.toolCallId, next);
            upsertToolCard(next);
          }

          if (part.tool === "question" || part.tool === "permission") {
            await refreshPendingInteractiveRequests();
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
          .map((file) => `${file.file}(+${file.additions}/-${file.deletions})`)
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
          (accumulator, todo) => {
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
        await refreshPendingInteractiveRequests();
        return;
      }

      if (event.type === "permission.replied") {
        appendTrace(
          `permission replied (${event.properties.permissionID}): ${event.properties.response}`
        );
        await refreshPendingInteractiveRequests();
        return;
      }

      if (event.type === "session.status") {
        if (event.properties.status.type === "retry") {
          appendTrace(
            `session status: retry attempt=${event.properties.status.attempt} next=${event.properties.status.next}`
          );
        } else {
          appendTrace(`session status: ${event.properties.status.type}`);
        }
        return;
      }

      if (event.type === "session.idle") {
        if (!activeRun || activeRun.sessionID !== event.properties.sessionID) return;

        if (!activeRun.assistantText.trim()) {
          const fallbackText = await getLatestAssistantText(event.properties.sessionID);
          if (fallbackText) {
            activeRun.assistantText = fallbackText;
            appendAssistantTextChunk(`fallback-${activeRun.id}`, fallbackText, false);
          }
        }

        markAssistantCardsComplete();
        appendTrace(
          activeRun.model
            ? `turn finished [model: ${activeRun.model}]`
            : "turn finished"
        );

        activeRun.finish();
        await refreshPendingInteractiveRequests();
        return;
      }

      if (eventType.startsWith("permission.") || eventType.startsWith("question.")) {
        await refreshPendingInteractiveRequests();
      }
    },
    [
      appendAssistantTextChunk,
      appendTrace,
      getLatestAssistantText,
      markAssistantCardsComplete,
      refreshPendingInteractiveRequests,
      upsertAssistantUsage,
      upsertToolCard,
    ]
  );

  const ensureEventStream = useCallback(async () => {
    if (eventStreamTaskRef.current) return;

    const client = v1ClientRef.current;
    if (!client) return;

    const controller = new AbortController();
    eventStreamAbortRef.current = controller;

    const task = (async () => {
      try {
        const subscription = await client.event.subscribe({
          signal: controller.signal,
        });
        const stream = subscription.stream as AsyncIterable<StreamEvent>;
        appendTrace("event stream connected");

        for await (const rawEvent of stream) {
          const event = normalizeEvent(rawEvent);
          await processEvent(event);
        }

        if (!controller.signal.aborted) {
          appendTrace("event stream closed");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          appendTrace(`event stream error: ${toErrorMessage(error)}`);
        }
      } finally {
        eventStreamTaskRef.current = null;
      }
    })();

    eventStreamTaskRef.current = task;
  }, [appendTrace, processEvent]);

  const loadSessionOptions = useCallback(async () => {
    try {
      ensureClients();
      void refreshModelContextLimits();
      const client = v1ClientRef.current;
      if (!client) return;

      const sessionsResult = await client.session.list();
      if (sessionsResult.error) {
        throw new Error(getAssistantError(sessionsResult.error) ?? "Failed to list sessions");
      }

      const sorted = [...(sessionsResult.data ?? [])]
        .sort((left, right) => right.time.updated - left.time.updated)
        .map((session) => ({
          id: session.id,
          title: session.title,
          updated: session.time.updated,
          created: session.time.created,
        }));

      setAvailableSessions(sorted);
      setSelectedSessionID((previous) => {
        if (previous && sorted.some((session) => session.id === previous)) return previous;
        if (sessionIDRef.current && sorted.some((session) => session.id === sessionIDRef.current)) {
          return sessionIDRef.current;
        }
        return sorted[0]?.id ?? "";
      });
    } catch (error) {
      setErrorText(toErrorMessage(error));
    }
  }, [ensureClients, refreshModelContextLimits]);

  const resumeSession = useCallback(async () => {
    if (!selectedSessionID) return;

    setErrorText(null);
    setIsBusy(false);

    messageRoleByIDRef.current.clear();
    partTextSeenRef.current.clear();
    toolStateSeenRef.current.clear();
    toolCardByCallIDRef.current.clear();
    openTextSegmentRef.current = null;
    activeAssistantServerMessageIDRef.current = null;
    activeRunRef.current = null;
    resetSessionTokenTracking();

    try {
      ensureClients();
      await ensureEventStream();
      await refreshModelContextLimits();

      const client = v1ClientRef.current;
      if (!client) throw new Error("OpenCode client is not initialized");

      const messagesResult = await client.session.messages({
        path: { id: selectedSessionID },
        query: { limit: 1000 },
      });
      if (messagesResult.error) {
        throw new Error(
          getAssistantError(messagesResult.error) ?? "Failed to load session history"
        );
      }

      const storedMessages = (messagesResult.data ?? []) as Array<StoredMessage>;
      const nextTimeline = buildTimelineFromStoredMessages(storedMessages);
      rebuildSessionUsageFromStoredMessages(storedMessages);
      setTimeline(nextTimeline);
      sessionIDRef.current = selectedSessionID;
      setSessionID(selectedSessionID);
      appendTrace(`session resumed: ${selectedSessionID}`);
      await refreshPendingInteractiveRequests();
    } catch (error) {
      const message = toErrorMessage(error);
      setErrorText(message);
      appendTrace(`resume error: ${message}`);
    }
  }, [
    appendTrace,
    buildTimelineFromStoredMessages,
    rebuildSessionUsageFromStoredMessages,
    ensureClients,
    ensureEventStream,
    refreshModelContextLimits,
    refreshPendingInteractiveRequests,
    resetSessionTokenTracking,
    selectedSessionID,
  ]);

  useEffect(() => {
    void loadSessionOptions();
    void refreshModelContextLimits();
  }, [loadSessionOptions, refreshModelContextLimits]);

  const ensureSession = useCallback(async (): Promise<string> => {
    ensureClients();
    void refreshModelContextLimits();
    await ensureEventStream();

    if (sessionIDRef.current) return sessionIDRef.current;

    const client = v1ClientRef.current;
    if (!client) throw new Error("OpenCode client is not initialized");

    const sessionResult = await client.session.create();
    if (sessionResult.error) {
      throw new Error(getAssistantError(sessionResult.error) ?? "Failed to create session");
    }

    const createdSession = sessionResult.data;
    resetSessionTokenTracking();
    sessionIDRef.current = createdSession.id;
    setSessionID(createdSession.id);
    setSelectedSessionID(createdSession.id);
    appendTrace(`session created: ${createdSession.id}`);
    void loadSessionOptions();

    return createdSession.id;
  }, [
    appendTrace,
    ensureClients,
    ensureEventStream,
    loadSessionOptions,
    refreshModelContextLimits,
    resetSessionTokenTracking,
  ]);

  const sendPrompt = useCallback(async () => {
    const prompt = inputText.trim();
    if (!prompt || isBusy) return;

    setInputText("");
    setErrorText(null);
    setPendingQuestions([]);
    setPendingPermissions([]);

    messageRoleByIDRef.current.clear();
    partTextSeenRef.current.clear();
    toolStateSeenRef.current.clear();
    toolCardByCallIDRef.current.clear();
    openTextSegmentRef.current = null;
    activeAssistantServerMessageIDRef.current = null;

    appendTrace(`prompt sent (${prompt.length} chars)`);

    const runID = crypto.randomUUID();
    appendUserCard(prompt);

    setIsBusy(true);

    try {
      const liveSessionID = await ensureSession();
      const client = v1ClientRef.current;
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
        toolCalls: new Map<string, RuntimeToolCall>(),
        fail,
        finish,
      };

      await client.session.promptAsync({
        path: { id: liveSessionID },
        body: {
          parts: [{ type: "text", text: prompt }],
        },
      });

      await refreshPendingInteractiveRequests();
    } catch (error) {
      const message = toErrorMessage(error);
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
    markAssistantCardsComplete,
    refreshPendingInteractiveRequests,
  ]);

  const handlePermissionReply = useCallback(
    async (requestID: string, reply: "once" | "always" | "reject") => {
      const client = v2ClientRef.current;
      if (!client) return;

      setErrorText(null);
      try {
        await client.permission.reply({ requestID, reply });
        appendTrace(`permission replied (${requestID}): ${reply}`);
        await refreshPendingInteractiveRequests();
      } catch (error) {
        const message = toErrorMessage(error);
        setErrorText(message);
        appendTrace(`permission reply error: ${message}`);
      }
    },
    [appendTrace, refreshPendingInteractiveRequests]
  );

  const handleQuestionInputChange = useCallback(
    (requestID: string, questionIndex: number, value: string) => {
      setQuestionDrafts((previous) => {
        const current = previous[requestID] ? [...previous[requestID]] : [];
        current[questionIndex] = value;
        return { ...previous, [requestID]: current };
      });
    },
    []
  );

  const handleQuestionReply = useCallback(
    async (request: QuestionRequest) => {
      const client = v2ClientRef.current;
      if (!client) return;

      const draft = questionDrafts[request.id] ?? [];
      const answers = request.questions.map((question, index) => {
        const raw = (draft[index] ?? "").trim();
        const parsed = parseQuestionAnswer(
          raw,
          question.options,
          Boolean(question.multiple),
          question.custom !== false
        );
        if (parsed.length > 0) return parsed;
        return raw ? [raw] : [];
      });

      if (answers.some((answer) => answer.length === 0)) {
        setErrorText("Each pending question needs an answer before replying.");
        return;
      }

      setErrorText(null);
      try {
        await client.question.reply({
          requestID: request.id,
          answers,
        });

        appendTrace(`question replied (${request.id})`);
        await refreshPendingInteractiveRequests();
      } catch (error) {
        const message = toErrorMessage(error);
        setErrorText(message);
        appendTrace(`question reply error: ${message}`);
      }
    },
    [appendTrace, questionDrafts, refreshPendingInteractiveRequests]
  );

  const resetSession = useCallback(() => {
    eventStreamAbortRef.current?.abort();
    eventStreamAbortRef.current = null;
    eventStreamTaskRef.current = null;

    v1ClientRef.current = null;
    v2ClientRef.current = null;
    configuredBaseURLRef.current = null;

    sessionIDRef.current = null;
    activeRunRef.current = null;
    messageRoleByIDRef.current.clear();
    partTextSeenRef.current.clear();
    toolStateSeenRef.current.clear();
    toolCardByCallIDRef.current.clear();
    openTextSegmentRef.current = null;
    activeAssistantServerMessageIDRef.current = null;
    resetSessionTokenTracking();

    setSessionID(null);
    setSelectedSessionID("");
    setTimeline([]);
    setInputText("");
    setTraceLines([]);
    setErrorText(null);
    setPendingQuestions([]);
    setPendingPermissions([]);
    setQuestionDrafts({});
    setIsBusy(false);
    void loadSessionOptions();
  }, [loadSessionOptions, resetSessionTokenTracking]);

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
  const contextUsedEstimate = sessionTokenTotals.input;
  const contextUsagePercent =
    activeContextLimit && activeContextLimit > 0
      ? Math.min(999.9, (contextUsedEstimate / activeContextLimit) * 100)
      : null;
  const contextUsageText =
    activeContextLimit && activeContextLimit > 0
      ? `${formatTokenCount(contextUsedEstimate)} / ${formatTokenCount(
          activeContextLimit
        )} (${(contextUsagePercent ?? 0).toFixed(1)}%)`
      : `${formatTokenCount(contextUsedEstimate)} / -`;

  return (
    <main className="agent-page h-dvh overflow-hidden p-3 text-zinc-900 sm:p-4">
      <div
        className={`agent-layout mx-auto grid h-full max-w-[1500px] gap-3 ${
          showTrace ? "lg:grid-cols-[minmax(0,1fr)_340px]" : "lg:grid-cols-1"
        }`}
      >
        <Card className="agent-panel min-h-0 gap-0 overflow-hidden rounded-none border-2 py-0 shadow-none">
          <CardHeader className="agent-header space-y-2 border-b-2 px-5 py-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-700">
                <span>
                  Session: <strong>{sessionID ?? "Not started"}</strong>
                </span>
                <span>{isBusy ? "Running" : "Ready"}</span>
              </div>

              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <NativeSelect
                  value={selectedSessionID}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setSelectedSessionID(event.target.value)
                  }
                  className="agent-field w-full rounded-none border-2 text-sm shadow-none"
                  disabled={isBusy || availableSessions.length === 0}
                >
                  <NativeSelectOption value="">
                    {availableSessions.length === 0
                      ? "No saved sessions found"
                      : "Select session to resume"}
                  </NativeSelectOption>
                  {availableSessions.map((session) => (
                    <NativeSelectOption key={session.id} value={session.id}>
                      {formatSessionOptionLabel(session)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={!selectedSessionID || isBusy}
                  onClick={() => void resumeSession()}
                  className="agent-btn rounded-none border-2 shadow-none"
                >
                  Resume
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="agent-btn rounded-none border-2 shadow-none"
                    >
                      More
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="agent-menu rounded-none border-2 border-zinc-900 bg-[#fffdf8]"
                  >
                    <DropdownMenuItem
                      className="agent-menu-item cursor-pointer rounded-none hover:bg-[#d9e2ef] hover:text-zinc-900 focus:bg-[#d9e2ef] focus:text-zinc-900 data-[highlighted]:bg-[#d9e2ef] data-[highlighted]:text-zinc-900"
                      onSelect={() => void loadSessionOptions()}
                    >
                      Refresh Sessions
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="agent-menu-item cursor-pointer rounded-none hover:bg-[#d9e2ef] hover:text-zinc-900 focus:bg-[#d9e2ef] focus:text-zinc-900 data-[highlighted]:bg-[#d9e2ef] data-[highlighted]:text-zinc-900"
                      onSelect={() => setShowTrace((value) => !value)}
                    >
                      {showTrace ? "Hide Trace" : "Show Trace"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="agent-menu-item cursor-pointer rounded-none hover:bg-[#d9e2ef] hover:text-zinc-900 focus:bg-[#d9e2ef] focus:text-zinc-900 data-[highlighted]:bg-[#d9e2ef] data-[highlighted]:text-zinc-900"
                      onSelect={resetSession}
                    >
                      New Session
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 px-0">
            <ScrollArea className="h-full">
              <div className="space-y-4 px-4 py-4 sm:px-5">
                {timeline.length === 0 ? (
                  <div className="agent-empty min-h-[320px] border-2 border-dashed p-6" />
                ) : (
                  timeline.map((item) => {
                    if (item.kind === "user") {
                      return (
                        <article key={item.id} className="flex justify-end">
                          <div className="agent-card agent-card-user max-w-[90%] border-2 px-4 py-3 text-sm sm:max-w-[85%]">
                            <Streamdown className="agent-markdown" mode="static">
                              {item.text}
                            </Streamdown>
                          </div>
                        </article>
                      );
                    }

                    if (item.kind === "assistant-text") {
                      return (
                        <article key={item.id} className="flex justify-start">
                          <div className="agent-avatar mr-3 mt-1 grid size-8 shrink-0 place-items-center border-2 text-xs font-semibold">
                            A
                          </div>
                          <div className="agent-card agent-card-assistant max-w-[90%] border-2 px-4 py-3 text-sm sm:max-w-[85%]">
                            <Streamdown
                              className="agent-markdown"
                              mode={item.running ? "streaming" : "static"}
                              isAnimating={item.running}
                            >
                              {item.text}
                            </Streamdown>
                          </div>
                        </article>
                      );
                    }

                    return (
                      <article key={item.id} className="flex justify-start">
                        <div className="agent-avatar agent-avatar-tool mr-3 mt-1 grid size-8 shrink-0 place-items-center border-2 text-xs font-semibold">
                          T
                        </div>
                        <div className="agent-card agent-card-tool max-w-[90%] border-2 p-3 sm:max-w-[85%]">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold uppercase tracking-[0.07em]">
                              {item.toolCall.toolName}
                            </p>
                            <Badge
                              variant={
                                item.toolCall.status === "error"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                            >
                              {item.toolCall.status}
                            </Badge>
                          </div>
                          <pre className="agent-tool-pre max-h-36 overflow-auto border p-2 text-xs leading-relaxed whitespace-pre-wrap break-words">
                            {item.toolCall.argsText}
                          </pre>
                          {item.toolCall.result !== undefined ? (
                            <pre
                              className={`agent-tool-pre mt-2 max-h-44 overflow-auto border p-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                                item.toolCall.isError ? "text-red-700" : ""
                              }`}
                            >
                              {formatToolResult(item.toolCall.result)}
                            </pre>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          </CardContent>

          {(pendingQuestions.length > 0 || pendingPermissions.length > 0) && (
            <section className="max-h-56 space-y-2 overflow-y-auto border-t-2 p-3" aria-live="polite">
              {pendingQuestions.map((request) => (
                <article key={request.id} className="agent-interactive border-2 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">
                    Question
                  </p>
                  {request.questions.map((question, index) => (
                    <div
                      key={`${request.id}-${question.header}-${index}`}
                      className="mt-2 space-y-1"
                    >
                      <p className="text-sm font-medium">{question.question}</p>
                      <p className="text-xs text-zinc-700">
                        {renderQuestionHints(question)}
                      </p>
                      <Input
                        value={(questionDrafts[request.id] ?? [])[index] ?? ""}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          handleQuestionInputChange(
                            request.id,
                            index,
                            event.target.value
                          )
                        }
                        placeholder={
                          question.multiple ? "Answer(s), comma separated" : "Answer"
                        }
                        className="agent-field rounded-none border-2 shadow-none"
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleQuestionReply(request)}
                    className="agent-btn mt-3 rounded-none border-2 shadow-none"
                  >
                    Reply
                  </Button>
                </article>
              ))}

              {pendingPermissions.map((request) => (
                <article key={request.id} className="agent-interactive border-2 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">
                    Permission
                  </p>
                  <p className="mt-1 text-sm font-medium">{request.permission}</p>
                  {request.patterns.length > 0 ? (
                    <p className="mt-1 text-xs text-zinc-700">
                      patterns: {request.patterns.join(", ")}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handlePermissionReply(request.id, "once")}
                      className="agent-btn rounded-none border-2 shadow-none"
                    >
                      Once
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handlePermissionReply(request.id, "always")}
                      className="agent-btn rounded-none border-2 shadow-none"
                    >
                      Always
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void handlePermissionReply(request.id, "reject")}
                      className="rounded-none border-2 border-red-700 bg-red-700 text-white hover:bg-red-800"
                    >
                      Reject
                    </Button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {errorText ? (
            <p className="border-t-2 border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {errorText}
            </p>
          ) : null}

          <div className="agent-composer border-t-2 p-4">
            <div className="space-y-2">
              <Textarea
                value={inputText}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setInputText(event.target.value)
                }
                onKeyDown={handleComposerKeyDown}
                placeholder="Write a message..."
                className="agent-field min-h-24 resize-none rounded-none border-2 shadow-none"
                disabled={isBusy}
              />
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-zinc-700">
                    {isBusy
                      ? "Waiting for assistant response..."
                      : "Press Enter to send, Shift+Enter for newline."}
                  </p>
                  <p className="text-[11px] text-zinc-700">Model: {modelLabel}</p>
                  <p className="text-[11px] text-zinc-600">
                    Input tokens (sent to the model):{" "}
                    {formatTokenCount(sessionTokenTotals.input)}
                    {" · "}Output tokens (generated by the model):{" "}
                    {formatTokenCount(sessionTokenTotals.output)}
                    {" · "}Reasoning tokens (internal reasoning):{" "}
                    {formatTokenCount(sessionTokenTotals.reasoning)}
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    Estimated context window usage: {contextUsageText}
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => void sendPrompt()}
                  disabled={!inputText.trim() || isBusy}
                  className="agent-btn-primary rounded-none border-2 border-zinc-900 px-5 shadow-none"
                >
                  Send
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {showTrace ? (
          <Card className="agent-trace-panel hidden min-h-0 gap-0 overflow-hidden rounded-none border-2 py-0 shadow-none lg:flex">
            <CardHeader className="border-b-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Live Trace</CardTitle>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => setShowTrace(false)}
                  className="agent-btn rounded-none border-2 shadow-none"
                >
                  Hide
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                <div className="space-y-1">
                  <label
                    className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-700"
                    htmlFor="trace-base-url"
                  >
                    Base URL
                  </label>
                  <Input
                    id="trace-base-url"
                    value={baseUrl}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setBaseUrl(event.target.value)
                    }
                    disabled={!canEditBaseUrl}
                    className="agent-field h-8 rounded-none border-2 px-2 text-xs shadow-none"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-700"
                    htmlFor="trace-base-port"
                  >
                    Port
                  </label>
                  <Input
                    id="trace-base-port"
                    value={basePort}
                    readOnly
                    className="agent-field h-8 rounded-none border-2 px-2 text-xs shadow-none"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              <ScrollArea className="h-full p-3 font-mono text-xs leading-relaxed">
                {traceLines.length === 0 ? (
                  <p className="text-zinc-500">Trace output appears here.</p>
                ) : (
                  traceLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
