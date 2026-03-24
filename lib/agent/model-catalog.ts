import { getModelKey, toModelCostInfo } from "@/lib/agent-runtime/helpers";
import type { ModelCostInfo } from "@/lib/agent-runtime/types";
import type {
  AgentBootstrapModelCatalog,
  AgentModelSelectionPolicy,
  AgentSelectableModel,
} from "@/lib/agent/types";

const MODEL_SELECTION_PROVIDER_ID = "openrouter";

type ProviderCatalogModel = {
  id: string;
  name?: string;
  limit?: {
    context?: number;
  };
  cost?: unknown;
  variants?: Record<
    string,
    {
      disabled?: boolean;
      [key: string]: unknown;
    }
  >;
};

export type ProviderCatalogListItem = {
  id: string;
  name?: string;
  models?: Record<string, ProviderCatalogModel>;
};

type ProviderCatalogData = {
  providers: Array<ProviderCatalogListItem>;
  connectedProviderIDs?: Array<string>;
  defaultModelIDs?: Record<string, string>;
  policy?: AgentModelSelectionPolicy | null;
};

function getEnabledVariantKeys(
  variants: ProviderCatalogModel["variants"]
): Array<string> {
  if (!variants) return [];

  return Object.entries(variants)
    .filter(([variant, config]) => variant !== "default" && config?.disabled !== true)
    .map(([variant]) => variant);
}

function buildSelectableModels({
  providers,
  connectedProviderIDs,
  defaultModelIDs,
  policy,
}: ProviderCatalogData): {
  selectableModels: Array<AgentSelectableModel>;
  defaultModelKey: string | null;
} {
  const connectedProviderIDSet = new Set(connectedProviderIDs ?? []);
  const selectionProvider = providers.find((provider) => provider.id === MODEL_SELECTION_PROVIDER_ID);

  if (!selectionProvider) {
    return {
      selectableModels: [],
      defaultModelKey: null,
    };
  }

  if (connectedProviderIDSet.size > 0 && !connectedProviderIDSet.has(selectionProvider.id)) {
    return {
      selectableModels: [],
      defaultModelKey: null,
    };
  }

  const allowedModelKeySet =
    policy && policy.allowedModelKeys.length > 0 ? new Set(policy.allowedModelKeys) : null;

  const selectableModels = Object.values(selectionProvider.models ?? {})
    .map((model) => ({
      key: getModelKey(selectionProvider.id, model.id),
      providerID: selectionProvider.id,
      modelID: model.id,
      label: model.id,
    }))
    .filter((model) => !allowedModelKeySet || allowedModelKeySet.has(model.key))
    .sort((left, right) => left.label.localeCompare(right.label));

  const selectableModelKeySet = new Set(selectableModels.map((model) => model.key));
  const configuredPolicyDefaultModelKey = policy?.defaultModelKey?.trim()
    ? policy.defaultModelKey.trim()
    : null;
  const configuredDefaultModelID = defaultModelIDs?.[selectionProvider.id];
  const configuredDefaultModelKey = configuredDefaultModelID
    ? getModelKey(selectionProvider.id, configuredDefaultModelID)
    : null;

  return {
    selectableModels,
    defaultModelKey:
      configuredPolicyDefaultModelKey && selectableModelKeySet.has(configuredPolicyDefaultModelKey)
        ? configuredPolicyDefaultModelKey
        : configuredDefaultModelKey && selectableModelKeySet.has(configuredDefaultModelKey)
        ? configuredDefaultModelKey
        : selectableModels[0]?.key ?? null,
  };
}

export function buildAgentModelCatalog({
  providers,
  connectedProviderIDs,
  defaultModelIDs,
  policy,
}: ProviderCatalogData): AgentBootstrapModelCatalog {
  const contextLimits: Record<string, number> = {};
  const costs: Record<string, ModelCostInfo> = {};
  const variants: Record<string, string[]> = {};

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

      const enabledVariants = getEnabledVariantKeys(model.variants);
      if (enabledVariants.length > 0) {
        variants[modelKey] = enabledVariants;
      }
    }
  }

  const { selectableModels, defaultModelKey } = buildSelectableModels({
    providers,
    connectedProviderIDs,
    defaultModelIDs,
    policy,
  });
  const preferredVariantByModelKey: Record<string, string> = {};

  if (
    policy?.defaultModelKey &&
    policy.defaultVariant &&
    variants[policy.defaultModelKey]?.includes(policy.defaultVariant)
  ) {
    preferredVariantByModelKey[policy.defaultModelKey] = policy.defaultVariant;
  }

  return {
    loaded: true,
    contextLimits,
    costs,
    variants,
    selectableModels,
    defaultModelKey,
    preferredVariantByModelKey,
  };
}
