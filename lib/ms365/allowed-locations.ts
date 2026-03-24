import mongoose from "mongoose";

import { connectDB } from "@/lib/mongodb";
import { Ms365AllowedLocationModel } from "@/lib/models/ms365-allowed-location";
import { resolveSharePointUrlToAllowedLocation } from "@/lib/ms365/sharepoint-url-resolver";
import type { Ms365AllowedLocation } from "@/lib/ms365/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function serializeAllowedLocation(location: {
  id: string;
  label: string;
  siteId: string;
  driveId?: string | null;
  rootItemId?: string | null;
  webUrl?: string | null;
}): Ms365AllowedLocation {
  return {
    id: location.id,
    label: location.label,
    siteId: location.siteId,
    driveId: location.driveId ?? undefined,
    rootItemId: location.rootItemId ?? undefined,
    webUrl: location.webUrl ?? undefined,
  };
}

export function getMs365AllowlistAdminPassword() {
  return requireEnv("ADMIN_ALLOWLIST_PASSWORD");
}

export async function listAllowedMs365Locations(
  organisationId: string
): Promise<Array<Ms365AllowedLocation>> {
  await connectDB();
  const organisationObjectId = new mongoose.Types.ObjectId(organisationId);

  const locations = await Ms365AllowedLocationModel.find({
    organisationId: organisationObjectId,
  })
    .sort({ label: 1, createdAt: 1 })
    .lean();

  return locations.map(serializeAllowedLocation);
}

export async function getAllowedMs365LocationById(
  organisationId: string,
  id: string
): Promise<Ms365AllowedLocation | null> {
  await connectDB();
  const organisationObjectId = new mongoose.Types.ObjectId(organisationId);

  const location = await Ms365AllowedLocationModel.findOne({
    organisationId: organisationObjectId,
    id,
  }).lean();
  if (!location) {
    return null;
  }

  return serializeAllowedLocation(location);
}

export async function addAllowedMs365LocationFromUrl(organisationId: string, url: string) {
  await connectDB();
  const organisationObjectId = new mongoose.Types.ObjectId(organisationId);

  const resolved = await resolveSharePointUrlToAllowedLocation({ url });
  const entry = resolved.suggestedEntry;

  try {
    const created = await Ms365AllowedLocationModel.create({
      organisationId: organisationObjectId,
      id: entry.id,
      label: entry.label,
      siteId: entry.siteId,
      driveId: entry.driveId,
      rootItemId: entry.rootItemId,
      webUrl: entry.webUrl,
      sourceUrl: url,
    });

    return {
      created: true,
      location: serializeAllowedLocation(created.toObject()),
      resolved,
    };
  } catch (error) {
    if ((error as { code?: number } | undefined)?.code !== 11000) {
      throw error;
    }

    const existing =
      (await Ms365AllowedLocationModel.findOne({
        organisationId: organisationObjectId,
        $or: [{ id: entry.id }, { sourceUrl: url }],
      }).lean()) ??
      (await Ms365AllowedLocationModel.findOne({
        organisationId: organisationObjectId,
        id: entry.id,
      }).lean());

    if (!existing) {
      throw error;
    }

    return {
      created: false,
      location: serializeAllowedLocation(existing),
      resolved,
    };
  }
}
