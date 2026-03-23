import type { Part, QuestionInfo } from "@opencode-ai/sdk/v2/client";

import type {
  AttachedFileReference,
  AssistantUsageSnapshot,
  CostFormulaGroup,
  CostFormulaRow,
  MessageEntry,
  MessagePartEntry,
  ModelCostInfo,
  QuestionDraft,
  RuntimeToolCall,
  StoredMessage,
  TextPart,
  TimelineItem,
  TokenUsageTotals,
  ToolPart,
} from "@/lib/agent-runtime/types";

export function normalizeEvent<T>(event: T | { payload: T }): T {
  if (event && typeof event === "object" && "payload" in event) {
    return event.payload;
  }
  return event;
}

export function summarizeText(value: string, maxLength = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
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

export function toCompactJSON(value: unknown, maxLength = 180): string {
  try {
    const text = JSON.stringify(value);
    if (!text) return String(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
  } catch {
    return String(value);
  }
}

export function toTokenNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function areTokenTotalsEqual(left: TokenUsageTotals, right: TokenUsageTotals): boolean {
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.reasoning === right.reasoning &&
    left.cacheRead === right.cacheRead &&
    left.cacheWrite === right.cacheWrite
  );
}

export function getTokenUsageTotal(value: TokenUsageTotals): number {
  return value.input + value.output + value.reasoning + value.cacheRead + value.cacheWrite;
}

export function sumTokenUsageTotals(
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

export function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(value)));
}

export function formatUsdAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(value) ? Math.max(0, value) : 0);
}

export function formatUsdRate(value: number): string {
  return `${formatUsdAmount(value)}/1M`;
}

export function toCostNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export function getCreatedAt(info: Record<string, unknown>): number {
  const time = info.time;
  if (!time || typeof time !== "object") return 0;
  return toTokenNumber((time as Record<string, unknown>).created);
}

export function toModelCostInfo(value: unknown): ModelCostInfo | null {
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
    over200k:
      over200kRecord || experimentalOver200K
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

export function buildSessionCostFormulaGroups(
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

export function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

export function parseAssistantUsageFromInfo(
  info: Record<string, unknown>
): AssistantUsageSnapshot | null {
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

export function createEmptyQuestionDraft(): QuestionDraft {
  return {
    selectedOptions: [],
    customText: "",
  };
}

export function renderQuestionHints(question: QuestionInfo): string {
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

export function buildQuestionAnswer(
  question: QuestionInfo,
  draft?: QuestionDraft
): Array<string> {
  const currentDraft = draft ?? createEmptyQuestionDraft();
  const optionLabels = new Set(question.options.map((option) => option.label));
  const selectedOptions = currentDraft.selectedOptions.filter((label) => optionLabels.has(label));
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

export function getToolSignature(part: ToolPart): string {
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

export function formatToolUpdate(part: ToolPart): string {
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
    const output = part.state.output ? ` | output: ${summarizeText(part.state.output, 120)}` : "";
    return `tool completed: ${base}${title}${commandText}${output}`;
  }

  return `tool error: ${base}${commandText} | ${summarizeText(part.state.error, 160)}`;
}

export function getAssistantError(error: unknown): string | undefined {
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

export function toRuntimeToolCall(part: ToolPart, previous?: RuntimeToolCall): RuntimeToolCall {
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

export function formatToolResult(result: unknown): string {
  if (result === undefined) return "";
  if (typeof result === "string") return result;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function formatSessionOptionLabel(session: { id: string; title: string; updated: number; created: number }): string {
  const title = session.title?.trim() ? session.title.trim() : "Untitled";
  const timestamp = new Date(session.updated || session.created).toLocaleString();
  const shortID = session.id.slice(0, 8);
  return `${title} • ${shortID} • ${timestamp}`;
}

export function compareAscending(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const ATTACHED_FILES_BLOCK_PATTERN = /<attached_files>\s*([\s\S]*?)\s*<\/attached_files>/i;

export function getAttachedFileLabel(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  const label = normalized.split("/").pop()?.trim();
  return label || normalized;
}

export function parseAttachedFilesFromText(text: string): {
  visibleText: string;
  attachedFiles: Array<AttachedFileReference>;
} {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return {
      visibleText: "",
      attachedFiles: [],
    };
  }

  const match = normalizedText.match(ATTACHED_FILES_BLOCK_PATTERN);
  if (!match) {
    return {
      visibleText: normalizedText,
      attachedFiles: [],
    };
  }

  const blockBody = match[1] ?? "";
  const attachedFiles = blockBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      const normalized = line.replace(/\\/g, "/");
      return normalized.length > 0 && normalized.includes("/");
    })
    .map((path) => ({
      path,
      label: getAttachedFileLabel(path),
    }));

  const visibleText = normalizedText.replace(ATTACHED_FILES_BLOCK_PATTERN, "").trim();
  return {
    visibleText,
    attachedFiles,
  };
}

export function sortStoredParts(parts: Array<Part>): Array<Part> {
  return [...parts];
}

export function sortMessageEntries(entries: Array<MessageEntry>): Array<MessageEntry> {
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

export function sortMessagePartEntries(parts: Array<MessagePartEntry>): Array<MessagePartEntry> {
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

export function buildTimelineFromMessageState(
  messages: Array<MessageEntry>,
  partsByMessageID: Map<string, Array<MessagePartEntry>>
): Array<TimelineItem> {
  const next: Array<TimelineItem> = [];

  for (const message of sortMessageEntries(messages)) {
    if (message.role === "user") {
      const text = message.text.trim();
      if (!text && message.attachedFiles.length === 0) continue;
      next.push({
        id: message.id,
        kind: "user",
        text: message.text,
        attachedFiles: message.attachedFiles,
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

export function upsertMessageEntry(entries: Array<MessageEntry>, nextEntry: MessageEntry) {
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

export function findMessageEntry(
  entries: Array<MessageEntry>,
  messageID: string
): MessageEntry | undefined {
  return entries.find((entry) => entry.id === messageID);
}

export function updateUserMessageText(
  entries: Array<MessageEntry>,
  messageID: string,
  text: string,
  mode: "replace" | "append"
) {
  const existing = findMessageEntry(entries, messageID);
  const currentText = existing?.role === "user" ? existing.text : "";
  const nextText = mode === "append" ? `${currentText}${text}` : text;
  const parsed = parseAttachedFilesFromText(nextText);

  upsertMessageEntry(entries, {
    id: messageID,
    role: "user",
    parentID: existing?.parentID,
    createdAt: existing?.createdAt ?? Date.now(),
    text: parsed.visibleText,
    attachedFiles: parsed.attachedFiles,
    localOnly: existing?.localOnly ?? false,
  });
}

export function upsertMessagePart(parts: Array<MessagePartEntry>, nextPart: MessagePartEntry) {
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

export function getAssistantTextFromMessageParts(
  parts: Array<MessagePartEntry> | undefined
): string {
  if (!parts?.length) return "";
  return sortMessagePartEntries(parts)
    .filter(
      (part): part is Extract<MessagePartEntry, { kind: "assistant-text" }> =>
        part.kind === "assistant-text"
    )
    .map((part) => part.text)
    .join("");
}

export function isTextPartRunning(part: TextPart): boolean {
  const time = "time" in part ? part.time : undefined;
  if (!time || typeof time !== "object") return true;
  return typeof (time as Record<string, unknown>).end !== "number";
}

export function isStoredTextPartRunning(part: TextPart): boolean {
  const time = "time" in part ? part.time : undefined;
  if (!time || typeof time !== "object") return true;
  return typeof (time as Record<string, unknown>).end !== "number";
}

export function getLatestAssistantSnapshot(storedMessages: Array<StoredMessage>): {
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

export function mergeAssistantText(currentText: string, canonicalText: string): string {
  if (!canonicalText) return currentText;
  return canonicalText;
}

export function getToolCallCacheSignature(toolCall: RuntimeToolCall): string {
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

export function preferMoreCompleteToolCall(
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

export function didSnapshotCaptureActiveRun(
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

export function buildMessageStateFromStoredMessages(storedMessages: Array<StoredMessage>): {
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
      const rawText = sortStoredParts(message.parts)
        .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      const parsed = parseAttachedFilesFromText(rawText);

      if (!parsed.visibleText && parsed.attachedFiles.length === 0) continue;

      messages.push({
        id: message.info.id,
        role: "user",
        parentID: undefined,
        createdAt: message.info.time.created,
        text: parsed.visibleText,
        attachedFiles: parsed.attachedFiles,
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
      attachedFiles: [],
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
          running: isStoredTextPartRunning(part),
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
