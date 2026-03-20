import { z } from "zod";

import type { Ms365AllowedLocation } from "@/lib/ms365/types";

const allowedLocationSchema = z.object({
  id: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1),
  siteId: z.string().trim().min(1),
  driveId: z.string().trim().min(1).optional(),
  rootItemId: z.string().trim().min(1).optional(),
  webUrl: z.string().trim().url().optional(),
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toStableLocationId(label: string, index: number) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug ? `${slug}-${index + 1}` : `location-${index + 1}`;
}

let cachedLocations: Array<Ms365AllowedLocation> | null = null;

export function getMs365Config() {
  return {
    tenantId: requireEnv("AZURE_TENANT_ID"),
    clientId: requireEnv("AZURE_CLIENT_ID"),
    clientSecret: requireEnv("AZURE_CLIENT_SECRET"),
    graphBaseUrl: "https://graph.microsoft.com/v1.0",
  } as const;
}

export function getAllowedMs365Locations(): Array<Ms365AllowedLocation> {
  if (cachedLocations) {
    return cachedLocations;
  }

  const raw = process.env.MS365_ALLOWED_LOCATIONS_JSON;
  if (!raw) {
    throw new Error(
      "Missing required environment variable: MS365_ALLOWED_LOCATIONS_JSON"
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid MS365_ALLOWED_LOCATIONS_JSON: ${message}`);
  }

  const result = z.array(allowedLocationSchema).safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid MS365_ALLOWED_LOCATIONS_JSON: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`
    );
  }

  const withIds = result.data.map((location, index) => ({
    id: location.id ?? toStableLocationId(location.label, index),
    label: location.label,
    siteId: location.siteId,
    driveId: location.driveId,
    rootItemId: location.rootItemId,
    webUrl: location.webUrl,
  }));

  const seenIds = new Set<string>();
  for (const location of withIds) {
    if (seenIds.has(location.id)) {
      throw new Error(
        `Invalid MS365_ALLOWED_LOCATIONS_JSON: duplicate location id "${location.id}"`
      );
    }
    seenIds.add(location.id);
  }

  cachedLocations = withIds;
  return withIds;
}
