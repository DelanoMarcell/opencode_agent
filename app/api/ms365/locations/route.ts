import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  listAllowedMs365LocationSummaries,
} from "@/lib/ms365/browser";
import { Ms365GraphError } from "@/lib/ms365/graph";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const locations = await listAllowedMs365LocationSummaries();
    return NextResponse.json({ locations });
  } catch (error) {
    if (error instanceof Ms365GraphError) {
      return NextResponse.json(
        { error: `Microsoft Graph error ${error.status}: ${error.message}` },
        { status: 502 }
      );
    }

    const message = error instanceof Error ? error.message : "Failed to load locations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
