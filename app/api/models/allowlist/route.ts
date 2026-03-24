import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import {
  getModelAllowlistAdminPassword,
  getOrganisationModelSelectionPolicy,
  saveOrganisationModelSelectionPolicy,
} from "@/lib/agent/model-allowlist";
import { buildAgentModelCatalog } from "@/lib/agent/model-catalog";
import { fetchOpenCodeProviderCatalog } from "@/lib/agent/opencode-server";

const accessSchema = z.object({
  adminPassword: z.string().min(1, "Admin password is required"),
});

const saveSchema = accessSchema.extend({
  allowedModelKeys: z.array(z.string().trim().min(1)).default([]),
  defaultModelKey: z.string().trim().optional().nullable(),
  defaultVariant: z.string().trim().optional().nullable(),
});

function isValidAdminPassword(password: string) {
  return password === getModelAllowlistAdminPassword();
}

async function buildResponse(organisationId: string) {
  const providerCatalog = await fetchOpenCodeProviderCatalog();
  const fullCatalog = buildAgentModelCatalog({
    providers: providerCatalog.providers,
    connectedProviderIDs: providerCatalog.connectedProviderIDs,
    defaultModelIDs: providerCatalog.defaultModelIDs,
  });
  const config = await getOrganisationModelSelectionPolicy(organisationId);

  return {
    config: config ?? {
      allowedModelKeys: [],
      defaultModelKey: null,
      defaultVariant: null,
    },
    providerDefaultModelKey: fullCatalog.defaultModelKey,
    availableModels: fullCatalog.selectableModels.map((model) => ({
      key: model.key,
      label: model.label,
      variants: fullCatalog.variants[model.key] ?? [],
    })),
  };
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedOrganisationUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = accessSchema.parse((await request.json()) as unknown);
    if (!isValidAdminPassword(body.adminPassword)) {
      return NextResponse.json({ error: "Invalid admin password" }, { status: 401 });
    }

    return NextResponse.json(await buildResponse(user.organisationId));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Failed to load model allowlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedOrganisationUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = saveSchema.parse((await request.json()) as unknown);
    if (!isValidAdminPassword(body.adminPassword)) {
      return NextResponse.json({ error: "Invalid admin password" }, { status: 401 });
    }

    const providerCatalog = await fetchOpenCodeProviderCatalog();
    const fullCatalog = buildAgentModelCatalog({
      providers: providerCatalog.providers,
      connectedProviderIDs: providerCatalog.connectedProviderIDs,
      defaultModelIDs: providerCatalog.defaultModelIDs,
    });
    const selectableModelKeySet = new Set(fullCatalog.selectableModels.map((model) => model.key));

    const allowedModelKeys = Array.from(
      new Set(body.allowedModelKeys.map((value) => value.trim()).filter((value) => value.length > 0))
    );
    for (const modelKey of allowedModelKeys) {
      if (!selectableModelKeySet.has(modelKey)) {
        return NextResponse.json({ error: `Unknown model: ${modelKey}` }, { status: 400 });
      }
    }

    const defaultModelKey = body.defaultModelKey?.trim() || null;
    if (defaultModelKey && !selectableModelKeySet.has(defaultModelKey)) {
      return NextResponse.json({ error: `Unknown default model: ${defaultModelKey}` }, { status: 400 });
    }

    if (
      defaultModelKey &&
      allowedModelKeys.length > 0 &&
      !allowedModelKeys.includes(defaultModelKey)
    ) {
      return NextResponse.json(
        { error: "The enforced default model must also be included in the allowed models." },
        { status: 400 }
      );
    }

    const defaultVariant = body.defaultVariant?.trim() || null;
    if (defaultVariant) {
      if (!defaultModelKey) {
        return NextResponse.json(
          { error: "Choose a default model before setting a default variant." },
          { status: 400 }
        );
      }

      const availableVariants = fullCatalog.variants[defaultModelKey] ?? [];
      if (!availableVariants.includes(defaultVariant)) {
        return NextResponse.json(
          { error: `Unknown variant '${defaultVariant}' for ${defaultModelKey}.` },
          { status: 400 }
        );
      }
    }

    await saveOrganisationModelSelectionPolicy({
      organisationId: user.organisationId,
      updatedByUserId: user.id,
      allowedModelKeys,
      defaultModelKey,
      defaultVariant,
    });

    return NextResponse.json(await buildResponse(user.organisationId));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Failed to save model allowlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
