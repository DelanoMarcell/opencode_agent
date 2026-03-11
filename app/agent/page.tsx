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
  type Event as EventV2,
  type Part as PartV2,
  type PermissionRequest,
  type QuestionInfo,
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
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

type AgentEvent = Event | EventV2;
type StreamEvent = AgentEvent | { payload: AgentEvent };
type AgentPart = Part | PartV2;
type TextPart = Extract<AgentPart, { type: "text" }>;
type ToolPart = Extract<AgentPart, { type: "tool" }>;

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
      partID: string;
      sortIndex?: number;
      text: string;
      running: boolean;
    }
  | {
      id: string;
      kind: "tool";
      partID: string;
      sortIndex?: number;
      toolCall: RuntimeToolCall;
    };

type MessageEntry = {
  id: string;
  role: "user" | "assistant";
  parentID?: string;
  createdAt: number;
  text: string;
  localOnly: boolean;
};

type MessagePartEntry = Exclude<TimelineItem, { kind: "user" }>;

type ActiveRun = {
  id: string;
  sessionID: string;
  assistantText: string;
  startObserved: boolean;
  pollRecoveryEligible: boolean;
  model?: string;
  toolCalls: Map<string, RuntimeToolCall>;
  finish: () => void;
  fail: (error: Error) => void;
};

type PendingOptimisticUserMessage = {
  localMessageID: string;
  sessionID: string | null;
  text: string;
  createdAt: number;
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

type AssistantUsageSnapshot = {
  messageID: string;
  modelKey: string | null;
  createdAt: number;
  cost: number;
  usage: TokenUsageTotals | null;
};

type ModelCostInfo = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  over200k?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

type CostFormulaRow = {
  label: string;
  tokens: number;
  rate: number;
  detail: string;
  amount: number;
  sortOrder: number;
};

type CostFormulaGroup = {
  key: string;
  modelKey: string;
  pricingLabel: string | null;
  rows: Array<CostFormulaRow>;
  total: number;
  firstSeenAt: number;
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

type QuestionDraft = {
  selectedOptions: Array<string>;
  customText: string;
};

const EMPTY_TOKEN_USAGE: TokenUsageTotals = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function normalizeEvent(event: StreamEvent): AgentEvent {
  return "payload" in event ? event.payload : event;
}

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

function summarizeText(value: string, maxLength = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
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

function getTokenUsageTotal(value: TokenUsageTotals): number {
  return value.input + value.output + value.reasoning + value.cacheRead + value.cacheWrite;
}

function sumTokenUsageTotals(
  left: TokenUsageTotals,
  right: TokenUsageTotals | null
): TokenUsageTotals {
  if (!right) return left;
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    reasoning: left.reasoning + right.reasoning,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
  };
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(value)));
}

function formatUsdAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(value) ? Math.max(0, value) : 0);
}

function formatUsdRate(value: number): string {
  return `${formatUsdAmount(value)}/1M`;
}

function toCostNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function getCreatedAt(info: Record<string, unknown>): number {
  const time = info.time;
  if (!time || typeof time !== "object") return 0;
  return toTokenNumber((time as Record<string, unknown>).created);
}

function toModelCostInfo(value: unknown): ModelCostInfo | null {
  const record = toRecord(value);
  if (!record) return null;
  const cache = toRecord(record.cache);
  const over200kRecord = toRecord(record.context_over_200k);
  const experimentalOver200K = toRecord(record.experimentalOver200K);
  const over200kCache = toRecord(over200kRecord?.cache);
  const experimentalOver200KCache = toRecord(experimentalOver200K?.cache);

  return {
    input: toCostNumber(record.input),
    output: toCostNumber(record.output),
    cacheRead: toCostNumber(record.cache_read ?? cache?.read),
    cacheWrite: toCostNumber(record.cache_write ?? cache?.write),
    over200k: over200kRecord || experimentalOver200K
      ? {
          input: toCostNumber(over200kRecord?.input ?? experimentalOver200K?.input),
          output: toCostNumber(over200kRecord?.output ?? experimentalOver200K?.output),
          cacheRead: toCostNumber(
            over200kRecord?.cache_read ?? over200kCache?.read ?? experimentalOver200KCache?.read
          ),
          cacheWrite: toCostNumber(
            over200kRecord?.cache_write ??
              over200kCache?.write ??
              experimentalOver200KCache?.write
          ),
        }
      : undefined,
  };
}

function resolveModelCostInfo(
  snapshot: AssistantUsageSnapshot,
  modelCosts: Map<string, ModelCostInfo>
): ModelCostInfo | null {
  if (!snapshot.modelKey) return null;
  const modelCost = modelCosts.get(snapshot.modelKey);
  if (!modelCost) return null;
  if (
    snapshot.usage &&
    modelCost.over200k &&
    snapshot.usage.input + snapshot.usage.cacheRead > 200_000
  ) {
    return {
      input: modelCost.over200k.input,
      output: modelCost.over200k.output,
      cacheRead: modelCost.over200k.cacheRead,
      cacheWrite: modelCost.over200k.cacheWrite,
    };
  }
  return modelCost;
}

function buildCostFormulaRow(
  label: string,
  tokens: number,
  rate: number,
  sortOrder: number
): CostFormulaRow | null {
  if (tokens <= 0 || rate <= 0) return null;
  return {
    label: `${label} @ ${formatUsdRate(rate)}`,
    tokens,
    rate,
    detail: `${formatTokenCount(tokens)} × ${formatUsdRate(rate)}`,
    amount: (tokens * rate) / 1_000_000,
    sortOrder,
  };
}

function resolveSessionCostGroup(
  snapshot: AssistantUsageSnapshot,
  modelCosts: Map<string, ModelCostInfo>
): { key: string; modelKey: string; pricingLabel: string | null; costInfo: ModelCostInfo } | null {
  if (!snapshot.modelKey || !snapshot.usage) return null;

  const baseCost = modelCosts.get(snapshot.modelKey);
  if (!baseCost) return null;

  const usesOver200kPricing =
    !!baseCost.over200k && snapshot.usage.input + snapshot.usage.cacheRead > 200_000;
  const costInfo = usesOver200kPricing
    ? {
        input: baseCost.over200k!.input,
        output: baseCost.over200k!.output,
        cacheRead: baseCost.over200k!.cacheRead,
        cacheWrite: baseCost.over200k!.cacheWrite,
      }
    : baseCost;

  return {
    key: JSON.stringify({
      modelKey: snapshot.modelKey,
      input: costInfo.input,
      output: costInfo.output,
      cacheRead: costInfo.cacheRead,
      cacheWrite: costInfo.cacheWrite,
    }),
    modelKey: snapshot.modelKey,
    pricingLabel: usesOver200kPricing ? "Over 200K pricing" : null,
    costInfo,
  };
}

function buildSessionCostFormulaGroups(
  snapshots: Iterable<AssistantUsageSnapshot>,
  modelCosts: Map<string, ModelCostInfo>
): Array<CostFormulaGroup> {
  const groups = new Map<
    string,
    {
      key: string;
      modelKey: string;
      pricingLabel: string | null;
      rows: Map<string, CostFormulaRow>;
      total: number;
      firstSeenAt: number;
    }
  >();

  const orderedSnapshots = [...snapshots].sort(
    (left, right) => left.createdAt - right.createdAt || left.messageID.localeCompare(right.messageID)
  );

  for (const snapshot of orderedSnapshots) {
    const groupInfo = resolveSessionCostGroup(snapshot, modelCosts);
    if (!groupInfo || !snapshot.usage) continue;

    let group = groups.get(groupInfo.key);
    if (!group) {
      group = {
        key: groupInfo.key,
        modelKey: groupInfo.modelKey,
        pricingLabel: groupInfo.pricingLabel,
        rows: new Map<string, CostFormulaRow>(),
        total: 0,
        firstSeenAt: snapshot.createdAt,
      };
      groups.set(groupInfo.key, group);
    }

    const candidateRows = [
      buildCostFormulaRow("Input", snapshot.usage.input, groupInfo.costInfo.input, 0),
      buildCostFormulaRow("Cache Read", snapshot.usage.cacheRead, groupInfo.costInfo.cacheRead, 1),
      buildCostFormulaRow("Cache Write", snapshot.usage.cacheWrite, groupInfo.costInfo.cacheWrite, 2),
      buildCostFormulaRow("Output", snapshot.usage.output, groupInfo.costInfo.output, 3),
      buildCostFormulaRow("Reasoning", snapshot.usage.reasoning, groupInfo.costInfo.output, 4),
    ];

    for (const row of candidateRows) {
      if (!row) continue;
      const rowKey = `${row.sortOrder}:${row.label}`;
      const existing = group.rows.get(rowKey);
      if (existing) {
        existing.tokens += row.tokens;
        existing.detail = `${formatTokenCount(existing.tokens)} × ${formatUsdRate(existing.rate)}`;
        existing.amount += row.amount;
        group.rows.set(rowKey, existing);
      } else {
        group.rows.set(rowKey, row);
      }
      group.total += row.amount;
    }
  }

  return [...groups.values()]
    .sort(
      (left, right) =>
        left.firstSeenAt - right.firstSeenAt || left.modelKey.localeCompare(right.modelKey)
    )
    .map((group) => ({
      key: group.key,
      modelKey: group.modelKey,
      pricingLabel: group.pricingLabel,
      rows: [...group.rows.values()].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label)
      ),
      total: group.total,
      firstSeenAt: group.firstSeenAt,
    }));
}

function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function parseAssistantUsageFromInfo(info: Record<string, unknown>): AssistantUsageSnapshot | null {
  if (info.role !== "assistant") return null;
  const messageID = typeof info.id === "string" ? info.id : null;
  if (!messageID) return null;

  const providerID = typeof info.providerID === "string" ? info.providerID : "";
  const modelID = typeof info.modelID === "string" ? info.modelID : "";
  const modelKey = providerID && modelID ? getModelKey(providerID, modelID) : null;
  const createdAt = getCreatedAt(info);
  const cost = toCostNumber(info.cost);

  const tokens = info.tokens;
  if (!tokens || typeof tokens !== "object") {
    return { messageID, modelKey, createdAt, cost, usage: null };
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

  return { messageID, modelKey, createdAt, cost, usage };
}

function createEmptyQuestionDraft(): QuestionDraft {
  return {
    selectedOptions: [],
    customText: "",
  };
}

function renderQuestionHints(question: QuestionInfo): string {
  if (!question.options.length) {
    return question.custom === false
      ? "No explicit choices were provided."
      : "Type your answer freely.";
  }

  if (question.custom === false) {
    return question.multiple ? "Select one or more of the provided options." : "Select one option.";
  }

  return question.multiple
    ? "Select one or more options, and add custom context if needed."
    : "Select one option, or type a custom answer.";
}

function buildQuestionAnswer(question: QuestionInfo, draft?: QuestionDraft): Array<string> {
  const currentDraft = draft ?? createEmptyQuestionDraft();
  const optionLabels = new Set(question.options.map((option) => option.label));
  const selectedOptions = currentDraft.selectedOptions.filter((label) =>
    optionLabels.has(label)
  );
  const customText = currentDraft.customText.trim();

  if (question.multiple) {
    const answers = [...selectedOptions];
    if (question.custom !== false && customText) {
      answers.push(customText);
    }
    return [...new Set(answers)];
  }

  if (question.custom !== false && customText) {
    return [customText];
  }

  if (selectedOptions[0]) {
    return [selectedOptions[0]];
  }

  return [];
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

function compareAscending(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortStoredParts(parts: Array<Part>): Array<Part> {
  return [...parts];
}

function sortMessageEntries(entries: Array<MessageEntry>): Array<MessageEntry> {
  return [...entries].sort((left, right) => {
    const leftTurnID = left.parentID ?? left.id;
    const rightTurnID = right.parentID ?? right.id;
    const turnOrder = compareAscending(leftTurnID, rightTurnID);
    if (turnOrder !== 0) return turnOrder;

    if (left.parentID && !right.parentID) return 1;
    if (!left.parentID && right.parentID) return -1;

    return compareAscending(left.id, right.id);
  });
}

function sortMessagePartEntries(parts: Array<MessagePartEntry>): Array<MessagePartEntry> {
  return [...parts].sort((left, right) => {
    if (typeof left.sortIndex === "number" && typeof right.sortIndex === "number") {
      if (left.sortIndex !== right.sortIndex) {
        return left.sortIndex - right.sortIndex;
      }
      return compareAscending(left.partID, right.partID);
    }
    if (typeof left.sortIndex === "number") return -1;
    if (typeof right.sortIndex === "number") return 1;
    return compareAscending(left.partID, right.partID);
  });
}

function buildTimelineFromMessageState(
  messages: Array<MessageEntry>,
  partsByMessageID: Map<string, Array<MessagePartEntry>>
): Array<TimelineItem> {
  const next: Array<TimelineItem> = [];

  for (const message of sortMessageEntries(messages)) {
    if (message.role === "user") {
      const text = message.text.trim();
      if (!text) continue;
      next.push({
        id: message.id,
        kind: "user",
        text: message.text,
      });
      continue;
    }

    const parts = sortMessagePartEntries(partsByMessageID.get(message.id) ?? []);
    for (const part of parts) {
      if (part.kind === "assistant-text" && !part.text.trim() && !part.running) {
        continue;
      }
      next.push(part);
    }
  }

  return next;
}

function upsertMessageEntry(entries: Array<MessageEntry>, nextEntry: MessageEntry) {
  const index = entries.findIndex((entry) => entry.id === nextEntry.id);
  if (index >= 0) {
    entries[index] = {
      ...entries[index],
      ...nextEntry,
    };
    return;
  }
  entries.push(nextEntry);
}

function findMessageEntry(entries: Array<MessageEntry>, messageID: string): MessageEntry | undefined {
  return entries.find((entry) => entry.id === messageID);
}

function updateUserMessageText(
  entries: Array<MessageEntry>,
  messageID: string,
  text: string,
  mode: "replace" | "append"
) {
  const existing = findMessageEntry(entries, messageID);
  const currentText = existing?.role === "user" ? existing.text : "";
  const nextText = mode === "append" ? `${currentText}${text}` : text;

  upsertMessageEntry(entries, {
    id: messageID,
    role: "user",
    parentID: existing?.parentID,
    createdAt: existing?.createdAt ?? Date.now(),
    text: nextText,
    localOnly: existing?.localOnly ?? false,
  });
}

function upsertMessagePart(parts: Array<MessagePartEntry>, nextPart: MessagePartEntry) {
  const index = parts.findIndex((part) => part.partID === nextPart.partID);
  if (index >= 0) {
    const current = parts[index];
    parts[index] = {
      ...current,
      ...nextPart,
      sortIndex: nextPart.sortIndex ?? current.sortIndex,
    };
    return;
  }
  const nextSortIndex =
    nextPart.sortIndex ??
    parts.reduce((max, part) => Math.max(max, part.sortIndex ?? -1), -1) + 1;
  parts.push({
    ...nextPart,
    sortIndex: nextSortIndex,
  });
}

function getAssistantTextFromMessageParts(parts: Array<MessagePartEntry> | undefined): string {
  if (!parts?.length) return "";
  return sortMessagePartEntries(parts)
    .filter(
      (part): part is Extract<MessagePartEntry, { kind: "assistant-text" }> =>
        part.kind === "assistant-text"
    )
    .map((part) => part.text)
    .join("");
}

function isTextPartRunning(part: TextPart): boolean {
  const time = "time" in part ? part.time : undefined;
  if (!time || typeof time !== "object") return true;
  return typeof (time as Record<string, unknown>).end !== "number";
}

function getLatestAssistantSnapshot(storedMessages: Array<StoredMessage>): {
  text: string;
} {
  const ordered = [...storedMessages].sort(
    (left, right) =>
      left.info.time.created - right.info.time.created ||
      compareAscending(left.info.id, right.info.id)
  );
  const latestAssistant = [...ordered]
    .reverse()
    .find((message) => message.info.role === "assistant");

  if (!latestAssistant) {
    return { text: "" };
  }

  let text = "";
  for (const part of sortStoredParts(latestAssistant.parts)) {
    if (part.type !== "text") continue;
    text += part.text;
  }

  return { text };
}

function mergeAssistantText(currentText: string, canonicalText: string): string {
  if (!canonicalText) return currentText;
  return canonicalText;
}

function getToolCallCacheSignature(toolCall: RuntimeToolCall): string {
  const result =
    toolCall.result === undefined ? "" : summarizeText(formatToolResult(toolCall.result), 120);
  return [
    toolCall.status,
    toolCall.toolName,
    summarizeText(toolCall.argsText, 160),
    toolCall.isError ? "error" : "ok",
    result,
  ].join(":");
}

function preferMoreCompleteToolCall(
  storedToolCall: RuntimeToolCall,
  liveToolCall: RuntimeToolCall
): RuntimeToolCall {
  const rank: Record<RuntimeToolCall["status"], number> = {
    pending: 0,
    running: 1,
    completed: 2,
    error: 2,
  };

  const storedRank = rank[storedToolCall.status];
  const liveRank = rank[liveToolCall.status];
  if (liveRank > storedRank) return liveToolCall;
  if (storedRank > liveRank) return storedToolCall;

  if (storedRank >= 2) {
    if (storedToolCall.result !== undefined) return storedToolCall;
    if (liveToolCall.result !== undefined) return liveToolCall;
    return storedToolCall;
  }

  return liveToolCall;
}

function didSnapshotCaptureActiveRun(
  storedMessages: Array<StoredMessage>,
  localUserCount: number
): boolean {
  const ordered = [...storedMessages].sort(
    (left, right) => left.info.time.created - right.info.time.created
  );
  if (!ordered.length) return false;

  const storedUserCount = ordered.reduce(
    (count, message) => (message.info.role === "user" ? count + 1 : count),
    0
  );
  if (storedUserCount < localUserCount) return false;

  return ordered[ordered.length - 1]?.info.role === "assistant";
}

function buildMessageStateFromStoredMessages(storedMessages: Array<StoredMessage>): {
  messages: Array<MessageEntry>;
  partsByMessageID: Map<string, Array<MessagePartEntry>>;
  latestAssistantText: string;
} {
  const ordered = [...storedMessages].sort(
    (left, right) =>
      left.info.time.created - right.info.time.created ||
      compareAscending(left.info.id, right.info.id)
  );
  const messages: Array<MessageEntry> = [];
  const partsByMessageID = new Map<string, Array<MessagePartEntry>>();
  let latestAssistantText = "";

  for (const message of ordered) {
    if (message.info.role === "user") {
      const text = sortStoredParts(message.parts)
        .filter(
          (part): part is Extract<Part, { type: "text" }> => part.type === "text"
        )
        .map((part) => part.text)
        .join("\n")
        .trim();

      if (!text) continue;

      messages.push({
        id: message.info.id,
        role: "user",
        parentID: undefined,
        createdAt: message.info.time.created,
        text,
        localOnly: false,
      });
      continue;
    }

    messages.push({
      id: message.info.id,
      role: "assistant",
      parentID:
        typeof (message.info as Record<string, unknown>).parentID === "string"
          ? String((message.info as Record<string, unknown>).parentID)
          : undefined,
      createdAt: message.info.time.created,
      text: "",
      localOnly: false,
    });

    const parts: Array<MessagePartEntry> = [];
    for (const [partIndex, part] of sortStoredParts(message.parts).entries()) {
      if (part.type === "text") {
        parts.push({
          id: `assistant-text-${part.id}`,
          kind: "assistant-text",
          partID: part.id,
          sortIndex: partIndex,
          text: part.text,
          running: false,
        });
        continue;
      }

      if (part.type === "tool") {
        parts.push({
          id: `tool-${part.id}`,
          kind: "tool",
          partID: part.id,
          sortIndex: partIndex,
          toolCall: toRuntimeToolCall(part),
        });
      }
    }

    partsByMessageID.set(message.info.id, parts);
    latestAssistantText = getAssistantTextFromMessageParts(parts);
  }

  return {
    messages,
    partsByMessageID,
    latestAssistantText,
  };
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
  const [questionDrafts, setQuestionDrafts] = useState<
    Record<string, Array<QuestionDraft>>
  >({});
  const [activeQuestionIndexByRequest, setActiveQuestionIndexByRequest] = useState<
    Record<string, number>
  >({});
  const [isBusy, setIsBusy] = useState(false);
  const [runUiPhase, setRunUiPhase] = useState<
    "thinking" | "tool-active" | "assistant-output"
  >("thinking");
  const [showTrace, setShowTrace] = useState(false);
  const [activeModelKey, setActiveModelKey] = useState<string | null>(null);
  const [activeContextLimit, setActiveContextLimit] = useState<number | null>(null);
  const [latestContextUsage, setLatestContextUsage] = useState<TokenUsageTotals | null>(null);
  const [sessionUsageTotals, setSessionUsageTotals] = useState<TokenUsageTotals>(EMPTY_TOKEN_USAGE);
  const [sessionSpendTotal, setSessionSpendTotal] = useState(0);
  const [modelLimitRevision, setModelLimitRevision] = useState(0);

  const configuredBaseURLRef = useRef<string | null>(null);
  const sessionIDRef = useRef<string | null>(null);
  const timelineRef = useRef<Array<TimelineItem>>([]);
  const v1ClientRef = useRef<ReturnType<typeof createOpencodeClient> | null>(null);
  const v2ClientRef = useRef<ReturnType<typeof createOpencodeClientV2> | null>(null);
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
  const messageEntriesRef = useRef<Array<MessageEntry>>([]);
  const messagePartsByMessageIDRef = useRef<Map<string, Array<MessagePartEntry>>>(new Map());
  const messageRoleByIDRef = useRef<Map<string, "user" | "assistant">>(new Map());
  const partTextSeenRef = useRef<Map<string, string>>(new Map());
  const toolStateSeenRef = useRef<Map<string, string>>(new Map());
  const activeAssistantServerMessageIDRef = useRef<string | null>(null);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const timelineScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const assistantUsageByMessageIDRef = useRef<Map<string, AssistantUsageSnapshot>>(new Map());
  const modelContextLimitByKeyRef = useRef<Map<string, number>>(new Map());
  const modelCostByKeyRef = useRef<Map<string, ModelCostInfo>>(new Map());
  const pendingOptimisticUserRef = useRef<PendingOptimisticUserMessage | null>(null);

  useEffect(() => {
    sessionIDRef.current = sessionID;
  }, [sessionID]);

  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const flushTimelineFromMessageState = useCallback(() => {
    timelinePublishFrameRef.current = null;
    const nextTimeline = buildTimelineFromMessageState(
      messageEntriesRef.current,
      messagePartsByMessageIDRef.current
    );
    timelineRef.current = nextTimeline;
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

  useEffect(() => {
    if (!activeModelKey) {
      setActiveContextLimit(null);
      return;
    }
    setActiveContextLimit(modelContextLimitByKeyRef.current.get(activeModelKey) ?? null);
  }, [activeModelKey, modelLimitRevision]);

  const rebuildSessionUsageSummary = useCallback(() => {
    const orderedSnapshots = [...assistantUsageByMessageIDRef.current.values()].sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.messageID.localeCompare(right.messageID)
    );

    let nextModelKey: string | null = null;
    let nextContextUsage: TokenUsageTotals | null = null;
    let nextSessionUsageTotals = { ...EMPTY_TOKEN_USAGE };
    let nextSpendTotal = 0;

    for (const snapshot of orderedSnapshots) {
      nextSpendTotal += snapshot.cost;
      nextSessionUsageTotals = sumTokenUsageTotals(nextSessionUsageTotals, snapshot.usage);
      if (snapshot.modelKey) nextModelKey = snapshot.modelKey;
      if (snapshot.usage && snapshot.usage.output > 0) {
        nextContextUsage = snapshot.usage;
      }
    }

    setActiveModelKey(nextModelKey);
    setLatestContextUsage(nextContextUsage);
    setSessionUsageTotals(nextSessionUsageTotals);
    setSessionSpendTotal(nextSpendTotal);
  }, []);

  const resetSessionTokenTracking = useCallback(() => {
    assistantUsageByMessageIDRef.current.clear();
    setLatestContextUsage(null);
    setSessionUsageTotals(EMPTY_TOKEN_USAGE);
    setSessionSpendTotal(0);
    setActiveModelKey(null);
  }, []);

  const upsertAssistantUsage = useCallback(
    (snapshot: AssistantUsageSnapshot) => {
      const messageID = snapshot.messageID;
      const previous = assistantUsageByMessageIDRef.current.get(messageID);
      if (
        previous &&
        previous.modelKey === snapshot.modelKey &&
        previous.createdAt === snapshot.createdAt &&
        previous.cost === snapshot.cost &&
        ((previous.usage === null && snapshot.usage === null) ||
          (previous.usage !== null &&
            snapshot.usage !== null &&
            areTokenTotalsEqual(previous.usage, snapshot.usage)))
      ) {
        return;
      }

      assistantUsageByMessageIDRef.current.set(messageID, snapshot);
      rebuildSessionUsageSummary();
    },
    [rebuildSessionUsageSummary]
  );

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

  const rebuildSessionUsageFromStoredMessages = useCallback(
    (storedMessages: Array<StoredMessage>) => {
      const ordered = [...storedMessages].sort(
        (left, right) => left.info.time.created - right.info.time.created
      );

      assistantUsageByMessageIDRef.current.clear();

      for (const message of ordered) {
        const snapshot = parseAssistantUsageFromInfo(message.info);
        if (!snapshot) continue;
        assistantUsageByMessageIDRef.current.set(snapshot.messageID, snapshot);
      }

      rebuildSessionUsageSummary();
    },
    [rebuildSessionUsageSummary]
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
    modelCostByKeyRef.current = new Map();
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

      modelContextLimitByKeyRef.current = nextLimits;
      modelCostByKeyRef.current = nextCosts;
      setModelLimitRevision((value) => value + 1);
    } catch (error) {
      appendTrace(`provider metadata error: ${toErrorMessage(error)}`);
    }
  }, [appendTrace, ensureClients]);

  const refreshPendingInteractiveRequests = useCallback(async () => {
    if (interactiveRefreshInFlightRef.current) {
      interactiveRefreshDirtyRef.current = true;
      return;
    }

    const client = v2ClientRef.current;
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
      const v1Client = v1ClientRef.current;
      if (!v1Client || !currentSessionID) return;

      try {
        const messagesResult = await v1Client.session.messages({
          path: { id: currentSessionID },
          query: { limit: 1000 },
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
          const client = v1ClientRef.current;
          if (!client) throw new Error("OpenCode client is not initialized");

          const messagesResult = await client.session.messages({
            path: { id: targetSessionID },
            query: { limit: 1000 },
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
    const client = v1ClientRef.current;
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
        const client = v1ClientRef.current;
        if (!client) {
          await waitFor(RECONNECT_DELAYS_MS[0], supervisor.signal);
          continue;
        }

        const controller = new AbortController();
        eventStreamAbortRef.current = controller;
        let connectedThisAttempt = false;
        let heartbeatTimer: number | null = null;

        try {
          const subscription = await client.event.subscribe({
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
    setRunUiPhase("thinking");

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
      const nextState = buildMessageStateFromStoredMessages(storedMessages);
      rebuildSessionUsageFromStoredMessages(storedMessages);
      rebuildEventCachesFromMessageState(nextState.messages, nextState.partsByMessageID);
      shouldAutoScrollRef.current = true;
      replaceMessageState(nextState.messages, nextState.partsByMessageID);
      sessionIDRef.current = selectedSessionID;
      setSessionID(selectedSessionID);
      appendTrace(`session resumed: ${selectedSessionID}`);
      scheduleInteractiveRefresh(0);
    } catch (error) {
      const message = toErrorMessage(error);
      setErrorText(message);
      appendTrace(`resume error: ${message}`);
    }
  }, [
    appendTrace,
    rebuildEventCachesFromMessageState,
    rebuildSessionUsageFromStoredMessages,
    ensureClients,
    ensureEventStream,
    replaceMessageState,
    refreshModelContextLimits,
    resetSessionTokenTracking,
    scheduleInteractiveRefresh,
    selectedSessionID,
  ]);

  useEffect(() => {
    void loadSessionOptions();
    void refreshModelContextLimits();
  }, [loadSessionOptions, refreshModelContextLimits]);

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
        path: { id: liveSessionID },
        body: {
          parts: [{ type: "text", text: prompt }],
        },
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
    markAssistantCardsComplete,
    scheduleInteractiveRefresh,
  ]);

  const handlePermissionReply = useCallback(
    async (requestID: string, reply: "once" | "always" | "reject") => {
      const client = v2ClientRef.current;
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
      const client = v2ClientRef.current;
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
    interactiveRefreshInFlightRef.current = false;
    interactiveRefreshDirtyRef.current = false;
    statusPollInFlightRef.current = false;
    runCompletionInFlightRef.current = null;

    v1ClientRef.current = null;
    v2ClientRef.current = null;
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
    shouldAutoScrollRef.current = true;
    setTimeline([]);
    timelineRef.current = [];
    setInputText("");
    setTraceLines([]);
    setErrorText(null);
    setPendingQuestions([]);
    setPendingPermissions([]);
    setQuestionDrafts({});
    setActiveQuestionIndexByRequest({});
    setIsBusy(false);
    setRunUiPhase("thinking");
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

  return (
    <main className="agent-page h-dvh overflow-hidden p-3 text-zinc-900 sm:p-4">
      <div
        className={`agent-layout mx-auto grid h-full max-w-[1500px] gap-3 ${
          showTrace ? "lg:grid-cols-[minmax(0,1fr)_340px]" : "lg:grid-cols-1"
        }`}
      >
        <Card className="agent-panel min-h-0 min-w-0 gap-0 overflow-hidden rounded-none border-2 py-0 shadow-none">
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

          <CardContent className="min-h-0 min-w-0 flex-1 px-0">
            <div ref={timelineScrollAreaRef} className="h-full min-w-0">
              <ScrollArea type="always" className="h-full min-w-0">
                <div className="min-w-0 space-y-4 px-4 py-4 sm:px-5">
                  {timeline.length === 0 ? (
                    <div className="agent-empty min-h-[320px] border-2 border-dashed p-6" />
                  ) : (
                    timeline.map((item) => {
                      if (item.kind === "user") {
                        return (
                          <article key={item.id} className="flex min-w-0 justify-end">
                            <div className="agent-card agent-card-user min-w-0 max-w-[90%] border-2 px-4 py-3 text-sm sm:max-w-[85%]">
                              <Streamdown className="agent-markdown" mode="static">
                                {item.text}
                              </Streamdown>
                            </div>
                          </article>
                        );
                      }

                      if (item.kind === "assistant-text") {
                        return (
                          <article key={item.id} className="flex min-w-0 justify-start">
                            <div className="agent-avatar mr-3 mt-1 grid size-8 shrink-0 place-items-center border-2 text-xs font-semibold">
                              A
                            </div>
                            <div className="agent-card agent-card-assistant min-w-0 max-w-[90%] border-2 px-4 py-3 text-sm sm:max-w-[85%]">
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
                        <article key={item.id} className="flex min-w-0 justify-start">
                          <div className="agent-avatar agent-avatar-tool mr-3 mt-1 grid size-8 shrink-0 place-items-center border-2 text-xs font-semibold">
                            T
                          </div>
                          <div className="agent-card agent-card-tool min-w-0 max-w-[90%] border-2 p-3 sm:max-w-[85%]">
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
                  {showThinkingCard ? (
                    <article className="flex min-w-0 justify-start">
                      <div className="agent-avatar mr-3 mt-1 grid size-8 shrink-0 place-items-center border-2 text-xs font-semibold">
                        A
                      </div>
                      <div className="agent-card agent-card-assistant min-w-0 max-w-[90%] border-2 px-4 py-3 text-sm sm:max-w-[85%]">
                        <p className="text-sm italic text-zinc-700 animate-pulse">
                          Thinking...
                        </p>
                      </div>
                    </article>
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </div>
          </CardContent>

          {(pendingQuestions.length > 0 || pendingPermissions.length > 0) && (
            <section
              className="min-w-0 max-h-56 space-y-2 overflow-y-auto border-t-2 p-3"
              aria-live="polite"
            >
              {pendingQuestions.map((request) => {
                const requestDrafts = questionDrafts[request.id] ?? [];
                const questionCount = request.questions.length;
                const activeQuestionIndex = Math.min(
                  activeQuestionIndexByRequest[request.id] ?? 0,
                  Math.max(questionCount - 1, 0)
                );
                const activeQuestion = request.questions[activeQuestionIndex];
                const activeDraft = requestDrafts[activeQuestionIndex] ?? createEmptyQuestionDraft();
                const answeredCount = request.questions.reduce(
                  (count, question, index) =>
                    count + (buildQuestionAnswer(question, requestDrafts[index]).length > 0 ? 1 : 0),
                  0
                );

                return (
                  <article key={request.id} className="agent-interactive min-w-0 border-2 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">
                          Question
                        </p>
                        <p className="mt-1 text-xs text-zinc-700">
                          {answeredCount} of {questionCount} answered
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className="rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                      >
                        {questionCount > 0 ? `${activeQuestionIndex + 1} / ${questionCount}` : "0 / 0"}
                      </Badge>
                    </div>

                    {questionCount > 1 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {request.questions.map((question, index) => {
                          const answered =
                            buildQuestionAnswer(question, requestDrafts[index]).length > 0;
                          const isActive = index === activeQuestionIndex;

                          return (
                            <button
                              key={`${request.id}-step-${question.header}-${index}`}
                              type="button"
                              className="agent-question-step min-w-[120px] px-3 py-2"
                              data-active={isActive}
                              data-answered={answered}
                              onClick={() => handleQuestionStepChange(request.id, index)}
                            >
                              <span className="block text-left text-xs font-semibold uppercase tracking-[0.08em]">
                                {question.header || `Question ${index + 1}`}
                              </span>
                              <span className="mt-1 block text-left text-[11px] text-zinc-700">
                                {answered ? "Answered" : "Pending"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {activeQuestion ? (
                      <div className="mt-4 min-w-0 space-y-3 border-t-2 pt-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">
                            {activeQuestion.header || `Question ${activeQuestionIndex + 1}`}
                          </p>
                          <Badge
                            variant="secondary"
                            className="rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                          >
                            {activeQuestion.multiple ? "Multiple" : "Single"}
                          </Badge>
                          {activeQuestion.custom === false ? (
                            <Badge
                              variant="secondary"
                              className="rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                            >
                              Options Only
                            </Badge>
                          ) : null}
                        </div>

                        <p className="break-words whitespace-pre-wrap text-sm font-medium">
                          {activeQuestion.question}
                        </p>
                        <p className="break-words whitespace-pre-wrap text-xs text-zinc-700">
                          {renderQuestionHints(activeQuestion)}
                        </p>

                        {activeQuestion.options.length > 0 ? (
                          <div className="space-y-2">
                            {activeQuestion.options.map((option, index) => {
                              const selected = activeDraft.selectedOptions.includes(option.label);

                              return (
                                <button
                                  key={`${request.id}-${activeQuestionIndex}-${option.label}-${index}`}
                                  type="button"
                                  className="agent-question-option block w-full min-w-0 px-3 py-3"
                                  data-selected={selected}
                                  role={activeQuestion.multiple ? "checkbox" : "radio"}
                                  aria-checked={selected}
                                  onClick={() =>
                                    handleQuestionOptionToggle(
                                      request.id,
                                      activeQuestionIndex,
                                      activeQuestion,
                                      option.label
                                    )
                                  }
                                >
                                  <div className="flex items-start gap-3">
                                    <span
                                      className={`agent-question-marker mt-0.5 flex size-5 shrink-0 items-center justify-center ${
                                        activeQuestion.multiple ? "rounded-none" : "rounded-full"
                                      }`}
                                      aria-hidden="true"
                                    >
                                      {selected ? (
                                        <span
                                          className={`block size-2.5 bg-[#173457] ${
                                            activeQuestion.multiple ? "rounded-none" : "rounded-full"
                                          }`}
                                        />
                                      ) : null}
                                    </span>
                                    <div className="min-w-0 space-y-1">
                                      <p className="break-words text-left text-sm font-medium">
                                        {option.label}
                                      </p>
                                      <p className="break-words text-left text-xs text-zinc-700">
                                        {option.description}
                                      </p>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}

                        {activeQuestion.custom !== false ? (
                          <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">
                              {activeQuestion.options.length > 0 ? "Custom Answer" : "Answer"}
                            </p>
                            <Textarea
                              value={activeDraft.customText}
                              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                                handleQuestionCustomInputChange(
                                  request.id,
                                  activeQuestionIndex,
                                  activeQuestion,
                                  event.target.value
                                )
                              }
                              placeholder={
                                activeQuestion.options.length > 0
                                  ? activeQuestion.multiple
                                    ? "Add any extra context or custom choices."
                                    : "Type your own answer exactly as you want it sent."
                                  : "Type your answer."
                              }
                              className="agent-field min-h-24 rounded-none border-2 shadow-none"
                            />
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 pt-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={activeQuestionIndex === 0}
                              onClick={() =>
                                handleQuestionStepChange(request.id, activeQuestionIndex - 1)
                              }
                              className="agent-btn rounded-none border-2 shadow-none"
                            >
                              Previous
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={activeQuestionIndex >= questionCount - 1}
                              onClick={() =>
                                handleQuestionStepChange(request.id, activeQuestionIndex + 1)
                              }
                              className="agent-btn rounded-none border-2 shadow-none"
                            >
                              Next
                            </Button>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleQuestionReply(request)}
                            disabled={questionCount === 0 || answeredCount !== questionCount}
                            className="agent-btn-primary rounded-none border-2 shadow-none"
                          >
                            Send Answers
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}

              {pendingPermissions.map((request) => (
                <article key={request.id} className="agent-interactive min-w-0 border-2 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">
                    Permission
                  </p>
                  <p className="mt-1 break-words whitespace-pre-wrap text-sm font-medium">
                    {request.permission}
                  </p>
                  {request.patterns.length > 0 ? (
                    <p className="mt-1 break-words whitespace-pre-wrap text-xs text-zinc-700">
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

          <div className="agent-composer min-w-0 border-t-2 p-4">
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
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-600">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="agent-context-trigger inline-flex items-baseline gap-1 text-left"
                          disabled={!latestContextUsage}
                        >
                          <span>Context: {contextUsageText}</span>
                          <span className="agent-context-trigger-label text-[10px] uppercase tracking-[0.08em]">
                            View
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        sideOffset={8}
                        collisionPadding={8}
                        style={{
                          ["--agent-context-popover-max-height" as string]:
                            "min(85vh, calc(var(--radix-popover-content-available-height, 100vh) - 8px))",
                          maxHeight: "var(--agent-context-popover-max-height)",
                          width: "min(30rem, calc(100vw - 1rem))",
                        }}
                        onOpenAutoFocus={(event) => event.preventDefault()}
                        className="agent-context-popover flex flex-col rounded-none border-2 p-0 shadow-none"
                      >
                        <PopoverHeader className="agent-context-popover-header border-b-2 px-4 py-3">
                          <PopoverTitle className="text-xs font-semibold uppercase tracking-[0.12em]">
                            Usage Breakdown
                          </PopoverTitle>
                          <p className="text-[11px] text-zinc-700">
                            Current context and cumulative session totals
                          </p>
                        </PopoverHeader>
                        <TooltipProvider delayDuration={0}>
                          <div className="agent-context-popover-body min-h-0 flex-1">
                            <ScrollArea
                              type="always"
                              className="agent-context-popover-scroll min-h-0 min-w-0"
                            >
                              <div className="space-y-3 px-4 py-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <section className="space-y-2">
                                    <div className="flex items-center gap-2">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-700">
                                        Current Context
                                      </p>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            className="agent-context-help"
                                            aria-label="Explain current context"
                                          >
                                            ?
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="right"
                                          className="agent-context-tooltip rounded-none border-2 shadow-none [&>svg]:fill-[#ece4d2]"
                                        >
                                          Latest prompt size right now. It shows what the most
                                          recent assistant request used against the model&apos;s
                                          context window.
                                        </TooltipContent>
                                      </Tooltip>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 border-b pb-2 text-[11px]">
                                      <span className="font-semibold uppercase tracking-[0.08em] text-zinc-700">
                                        Model
                                      </span>
                                      <span className="text-right text-zinc-800">{modelLabel}</span>
                                    </div>
                                    {contextBreakdownRows.map((row) => (
                                      <div
                                        key={`context-${row.label}`}
                                        className="flex items-center justify-between gap-3 text-[11px]"
                                      >
                                        <span className="font-semibold uppercase tracking-[0.08em] text-zinc-700">
                                          {row.label}
                                        </span>
                                        <span className="text-right text-zinc-800">{row.value}</span>
                                      </div>
                                    ))}
                                  </section>

                                  <section className="space-y-2 border-t-2 pt-3 md:border-l-2 md:border-t-0 md:pl-3 md:pt-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-700">
                                        Session Totals
                                      </p>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            className="agent-context-help"
                                            aria-label="Explain session totals"
                                          >
                                            ?
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="right"
                                          className="agent-context-tooltip rounded-none border-2 shadow-none [&>svg]:fill-[#ece4d2]"
                                        >
                                          Lifetime token traffic for this session. It adds token
                                          usage from all assistant turns together.
                                        </TooltipContent>
                                      </Tooltip>
                                    </div>
                                    {sessionTotalsRows.map((row) => (
                                      <div
                                        key={`session-${row.label}`}
                                        className="flex items-center justify-between gap-3 text-[11px]"
                                      >
                                        <span className="font-semibold uppercase tracking-[0.08em] text-zinc-700">
                                          {row.label}
                                        </span>
                                        <span className="text-right text-zinc-800">{row.value}</span>
                                      </div>
                                    ))}
                                  </section>
                                </div>

                                <section className="border-t-2 pt-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-700">
                                    Cost Calculation
                                  </p>
                                  {sessionCostFormulaGroups.length > 0 ? (
                                    <div className="mt-2 space-y-1.5">
                                      {sessionCostFormulaGroups.map((group) => (
                                        <div
                                          key={group.key}
                                          className="space-y-1.5 border border-zinc-900/20 bg-[#f8f4ea] p-2 text-[11px]"
                                        >
                                          <div className="border-b pb-1.5">
                                            <p className="break-all font-semibold text-zinc-900">
                                              {group.modelKey}
                                            </p>
                                            {group.pricingLabel ? (
                                              <p className="text-[10px] uppercase tracking-[0.08em] text-zinc-700">
                                                {group.pricingLabel}
                                              </p>
                                            ) : null}
                                          </div>

                                          {group.rows.map((row) => (
                                            <div key={`${group.key}-${row.label}`} className="text-[11px]">
                                              <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                  <p className="font-semibold uppercase tracking-[0.08em] text-zinc-700">
                                                    {row.label}
                                                  </p>
                                                  <p className="text-[10px] text-zinc-700">{row.detail}</p>
                                                </div>
                                                <span className="shrink-0 text-right text-zinc-800">
                                                  {formatUsdAmount(row.amount)}
                                                </span>
                                              </div>
                                            </div>
                                          ))}

                                          <div className="flex items-center justify-between gap-3 border-t pt-2 text-[11px]">
                                            <span className="font-semibold uppercase tracking-[0.08em] text-zinc-700">
                                              Model Subtotal
                                            </span>
                                            <span className="text-right text-zinc-800">
                                              {formatUsdAmount(group.total)}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                      <div className="flex items-center justify-between gap-3 border-t pt-2 text-[11px]">
                                        <span className="font-semibold uppercase tracking-[0.08em] text-zinc-700">
                                          Estimated Total
                                        </span>
                                        <span className="text-right text-zinc-800">
                                          {formatUsdAmount(sessionCostFormulaTotal)}
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="mt-2 text-[11px] text-zinc-700">
                                      Pricing metadata unavailable for this session.
                                    </p>
                                  )}
                                </section>
                              </div>
                            </ScrollArea>
                          </div>
                        </TooltipProvider>
                      </PopoverContent>
                    </Popover>
                    <span aria-hidden="true">·</span>
                    <span>Spent: {sessionSpendText}</span>
                  </div>
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
          <Card className="agent-trace-panel hidden min-h-0 min-w-0 gap-0 overflow-hidden rounded-none border-2 py-0 shadow-none lg:flex">
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
            <CardContent className="min-h-0 min-w-0 flex-1 p-0">
              <ScrollArea type="always" className="h-full p-3 font-mono text-xs leading-relaxed">
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
