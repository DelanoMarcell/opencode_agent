import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { authOptions } from "@/lib/auth";
import { Ms365GraphError } from "@/lib/ms365/graph";
import { resolveSharePointUrlToAllowedLocation } from "@/lib/ms365/sharepoint-url-resolver";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as unknown;
    const result = await resolveSharePointUrlToAllowedLocation(body);
    return NextResponse.json(result);
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

    const message =
      error instanceof Error ? error.message : "Failed to resolve SharePoint URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
