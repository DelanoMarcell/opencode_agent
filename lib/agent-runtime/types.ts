import type {
  Event,
  Part,
} from "@opencode-ai/sdk/v2/client";
export type AgentEvent = Event;
export type StreamEvent = AgentEvent | { payload: AgentEvent };
export type AgentPart = Part;
export type TextPart = Extract<AgentPart, { type: "text" }>;
export type ToolPart = Extract<AgentPart, { type: "tool" }>;

export type RuntimeToolCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
  result?: unknown;
  isError?: boolean;
  status: "pending" | "running" | "completed" | "error";
};

export type AttachedFileReference = {
  path: string;
  label: string;
};

export type TimelineItem =
  | {
      id: string;
      kind: "user";
      text: string;
      attachedFiles: Array<AttachedFileReference>;
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

export type MessageEntry = {
  id: string;
  role: "user" | "assistant";
  parentID?: string;
  createdAt: number;
  text: string;
  attachedFiles: Array<AttachedFileReference>;
  localOnly: boolean;
};

export type MessagePartEntry = Exclude<TimelineItem, { kind: "user" }>;

export type ActiveRun = {
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

export type PendingOptimisticUserMessage = {
  localMessageID: string;
  sessionID: string | null;
  text: string;
  attachedFiles: Array<AttachedFileReference>;
  createdAt: number;
};

export type SessionOption = {
  id: string;
  title: string;
  updated: number;
  created: number;
};

export type TokenUsageTotals = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

export type AssistantUsageSnapshot = {
  messageID: string;
  modelKey: string | null;
  createdAt: number;
  cost: number;
  usage: TokenUsageTotals | null;
};

export type ModelCostInfo = {
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

export type CostFormulaRow = {
  label: string;
  tokens: number;
  rate: number;
  detail: string;
  amount: number;
  sortOrder: number;
};

export type CostFormulaGroup = {
  key: string;
  modelKey: string;
  pricingLabel: string | null;
  rows: Array<CostFormulaRow>;
  total: number;
  firstSeenAt: number;
};

export type StoredMessage = {
  info: {
    id: string;
    role: string;
    time: {
      created: number;
    };
  } & Record<string, unknown>;
  parts: Array<Part>;
};

export type QuestionDraft = {
  selectedOptions: Array<string>;
  customText: string;
};

export const EMPTY_TOKEN_USAGE: TokenUsageTotals = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
