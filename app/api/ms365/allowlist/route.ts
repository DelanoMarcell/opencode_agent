import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import {
  addAllowedMs365LocationFromUrl,
  getMs365AllowlistAdminPassword,
} from "@/lib/ms365/allowed-locations";
import { Ms365GraphError } from "@/lib/ms365/graph";

const allowlistInputSchema = z.object({
  url: z.string().trim().url("Enter a valid SharePoint URL"),
  adminPassword: z.string().min(1, "Admin password is required"),
});

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedOrganisationUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = allowlistInputSchema.parse((await request.json()) as unknown);

    if (body.adminPassword !== getMs365AllowlistAdminPassword()) {
      return NextResponse.json({ error: "Invalid admin password" }, { status: 401 });
    }

    const result = await addAllowedMs365LocationFromUrl(user.organisationId, body.url);

    return NextResponse.json({
      created: result.created,
      location: result.location,
      resolved: result.resolved.resolved,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 }
      );
    }

    if (error instanceof Ms365GraphError) {
      return NextResponse.json(
        { error: `Microsoft Graph error ${error.status}: ${error.message}` },
        { status: 502 }
      );
    }

    const message = error instanceof Error ? error.message : "Failed to add allowlisted location";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
