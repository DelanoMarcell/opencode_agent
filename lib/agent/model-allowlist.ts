import mongoose from "mongoose";

import { connectDB } from "@/lib/mongodb";
import { ModelAllowlistModel } from "@/lib/models/model-allowlist";
import type { AgentModelSelectionPolicy } from "@/lib/agent/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeModelSelectionPolicy(policy: {
  allowedModelKeys?: Array<string> | null;
  defaultModelKey?: string | null;
  defaultVariant?: string | null;
}): AgentModelSelectionPolicy {
  return {
    allowedModelKeys: Array.from(
      new Set(
        (policy.allowedModelKeys ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    ),
    defaultModelKey: policy.defaultModelKey?.trim() || null,
    defaultVariant: policy.defaultVariant?.trim() || null,
  };
}

export function getModelAllowlistAdminPassword() {
  return requireEnv("ADMIN_ALLOWLIST_PASSWORD");
}

export async function getOrganisationModelSelectionPolicy(
  organisationId: string
): Promise<AgentModelSelectionPolicy | null> {
  await connectDB();

  const policy = await ModelAllowlistModel.findOne({
    organisationId: new mongoose.Types.ObjectId(organisationId),
  }).lean();

  if (!policy) {
    return null;
  }

  return normalizeModelSelectionPolicy(policy);
}

export async function saveOrganisationModelSelectionPolicy(input: {
  organisationId: string;
  updatedByUserId: string;
  allowedModelKeys: Array<string>;
  defaultModelKey?: string | null;
  defaultVariant?: string | null;
}): Promise<AgentModelSelectionPolicy | null> {
  await connectDB();

  const nextPolicy = normalizeModelSelectionPolicy(input);
  const organisationObjectId = new mongoose.Types.ObjectId(input.organisationId);

  if (
    nextPolicy.allowedModelKeys.length === 0 &&
    !nextPolicy.defaultModelKey &&
    !nextPolicy.defaultVariant
  ) {
    await ModelAllowlistModel.deleteOne({ organisationId: organisationObjectId });
    return null;
  }

  const saved = await ModelAllowlistModel.findOneAndUpdate(
    { organisationId: organisationObjectId },
    {
      $set: {
        allowedModelKeys: nextPolicy.allowedModelKeys,
        defaultModelKey: nextPolicy.defaultModelKey,
        defaultVariant: nextPolicy.defaultVariant,
        updatedByUserId: new mongoose.Types.ObjectId(input.updatedByUserId),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  return saved ? normalizeModelSelectionPolicy(saved) : null;
}
