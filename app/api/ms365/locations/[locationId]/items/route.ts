import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { listMs365LocationChildren } from "@/lib/ms365/browser";
import { Ms365GraphError } from "@/lib/ms365/graph";

type RouteContext = {
  params: Promise<{
    locationId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { locationId } = await context.params;
  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId") ?? undefined;

  try {
    const result = await listMs365LocationChildren({ locationId, itemId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Ms365GraphError) {
      return NextResponse.json(
        { error: `Microsoft Graph error ${error.status}: ${error.message}` },
        { status: 502 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to load Microsoft 365 items";
    const status = message.includes("outside the allowed") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
