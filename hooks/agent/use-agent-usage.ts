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

export function useAgentUsage() {
  const [activeModelKey, setActiveModelKey] = useState<string | null>(null);
  const [activeContextLimit, setActiveContextLimit] = useState<number | null>(null);
  const [latestContextUsage, setLatestContextUsage] = useState<TokenUsageTotals | null>(null);
  const [sessionUsageTotals, setSessionUsageTotals] = useState<TokenUsageTotals>(EMPTY_TOKEN_USAGE);
  const [sessionSpendTotal, setSessionSpendTotal] = useState(0);

  const assistantUsageByMessageIDRef = useRef<Map<string, AssistantUsageSnapshot>>(new Map());
  const modelContextLimitByKeyRef = useRef<Map<string, number>>(new Map());
  const modelCostByKeyRef = useRef<Map<string, ModelCostInfo>>(new Map());

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
