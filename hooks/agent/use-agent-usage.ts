"use client";

import { useCallback, useRef, useState } from "react";

import {
  areTokenTotalsEqual,
  parseAssistantUsageFromInfo,
  sumTokenUsageTotals,
} from "@/lib/agent-runtime/helpers";
import type {
  AssistantUsageSnapshot,
  ModelCostInfo,
  StoredMessage,
  TokenUsageTotals,
} from "@/lib/agent-runtime/types";
import { EMPTY_TOKEN_USAGE } from "@/lib/agent-runtime/types";

type InitialAgentUsageOptions = {
  modelCatalog?: {
    contextLimits: Record<string, number>;
    costs: Record<string, ModelCostInfo>;
  };
  storedMessages?: Array<StoredMessage>;
};

function buildInitialAgentUsageState(options: InitialAgentUsageOptions) {
  const modelContextLimitByKey = new Map<string, number>(
    Object.entries(options.modelCatalog?.contextLimits ?? {})
  );
  const modelCostByKey = new Map<string, ModelCostInfo>(
    Object.entries(options.modelCatalog?.costs ?? {})
  );
  const assistantUsageByMessageID = new Map<string, AssistantUsageSnapshot>();
  const orderedMessages = [...(options.storedMessages ?? [])].sort(
    (left, right) => left.info.time.created - right.info.time.created
  );

  let activeModelKey: string | null = null;
  let latestContextUsage: TokenUsageTotals | null = null;
  let sessionUsageTotals = { ...EMPTY_TOKEN_USAGE };
  let sessionSpendTotal = 0;

  for (const message of orderedMessages) {
    const snapshot = parseAssistantUsageFromInfo(message.info);
    if (!snapshot) continue;

    assistantUsageByMessageID.set(snapshot.messageID, snapshot);
    sessionSpendTotal += snapshot.cost;
    sessionUsageTotals = sumTokenUsageTotals(sessionUsageTotals, snapshot.usage);
    if (snapshot.modelKey) {
      activeModelKey = snapshot.modelKey;
    }
    if (snapshot.usage && snapshot.usage.output > 0) {
      latestContextUsage = snapshot.usage;
    }
  }

  return {
    activeContextLimit: activeModelKey
      ? modelContextLimitByKey.get(activeModelKey) ?? null
      : null,
    activeModelKey,
    assistantUsageByMessageID,
    latestContextUsage,
    modelContextLimitByKey,
    modelCostByKey,
    sessionSpendTotal,
    sessionUsageTotals,
  };
}

export function useAgentUsage(options: InitialAgentUsageOptions = {}) {
  const initialStateRef = useRef<ReturnType<typeof buildInitialAgentUsageState> | null>(null);
  if (initialStateRef.current === null) {
    initialStateRef.current = buildInitialAgentUsageState(options);
  }

  const [activeModelKey, setActiveModelKey] = useState<string | null>(
    initialStateRef.current.activeModelKey
  );
  const [activeContextLimit, setActiveContextLimit] = useState<number | null>(
    initialStateRef.current.activeContextLimit
  );
  const [latestContextUsage, setLatestContextUsage] = useState<TokenUsageTotals | null>(
    initialStateRef.current.latestContextUsage
  );
  const [sessionUsageTotals, setSessionUsageTotals] = useState<TokenUsageTotals>(
    initialStateRef.current.sessionUsageTotals
  );
  const [sessionSpendTotal, setSessionSpendTotal] = useState(
    initialStateRef.current.sessionSpendTotal
  );

  const assistantUsageByMessageIDRef = useRef<Map<string, AssistantUsageSnapshot>>(
    initialStateRef.current.assistantUsageByMessageID
  );
  const modelContextLimitByKeyRef = useRef<Map<string, number>>(
    initialStateRef.current.modelContextLimitByKey
  );
  const modelCostByKeyRef = useRef<Map<string, ModelCostInfo>>(
    initialStateRef.current.modelCostByKey
  );

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
    setActiveContextLimit(
      nextModelKey ? modelContextLimitByKeyRef.current.get(nextModelKey) ?? null : null
    );
    setLatestContextUsage(nextContextUsage);
    setSessionUsageTotals(nextSessionUsageTotals);
    setSessionSpendTotal(nextSpendTotal);
  }, []);

  const resetSessionTokenTracking = useCallback(() => {
    assistantUsageByMessageIDRef.current.clear();
    setLatestContextUsage(null);
    setSessionUsageTotals(EMPTY_TOKEN_USAGE);
    setSessionSpendTotal(0);
    setActiveContextLimit(null);
    setActiveModelKey(null);
  }, []);

  const upsertAssistantUsage = useCallback(
    (snapshot: AssistantUsageSnapshot) => {
      const previous = assistantUsageByMessageIDRef.current.get(snapshot.messageID);
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

      assistantUsageByMessageIDRef.current.set(snapshot.messageID, snapshot);
      rebuildSessionUsageSummary();
    },
    [rebuildSessionUsageSummary]
  );

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

  const replaceModelCatalog = useCallback(
    (limits: Map<string, number>, costs: Map<string, ModelCostInfo>) => {
      modelContextLimitByKeyRef.current = limits;
      modelCostByKeyRef.current = costs;
      setActiveContextLimit(activeModelKey ? limits.get(activeModelKey) ?? null : null);
    },
    [activeModelKey]
  );

  const resetModelCatalog = useCallback(() => {
    replaceModelCatalog(new Map(), new Map());
  }, [replaceModelCatalog]);

  return {
    activeContextLimit,
    activeModelKey,
    assistantUsageByMessageIDRef,
    latestContextUsage,
    modelContextLimitByKeyRef,
    modelCostByKeyRef,
    rebuildSessionUsageFromStoredMessages,
    replaceModelCatalog,
    resetModelCatalog,
    resetSessionTokenTracking,
    sessionSpendTotal,
    sessionUsageTotals,
    upsertAssistantUsage,
  };
}
