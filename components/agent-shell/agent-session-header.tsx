"use client";

import { Badge } from "@/components/ui/badge";
import { formatSessionOptionLabel } from "@/lib/agent-runtime/helpers";
import type { SessionOption } from "@/lib/agent-runtime/types";

type AgentSessionHeaderProps = {
  availableSessions: Array<SessionOption>;
  isBusy: boolean;
  selectedSessionID: string;
};

export function AgentSessionHeader({
  availableSessions,
  isBusy,
  selectedSessionID,
}: AgentSessionHeaderProps) {
  const selectedSession = availableSessions.find((session) => session.id === selectedSessionID);
  const sessionLabel = selectedSession
    ? formatSessionOptionLabel(selectedSession)
    : selectedSessionID
      ? `Selected session • ${selectedSessionID.slice(0, 8)}`
      : "No session selected";

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--ink-muted)">
          Active Session
        </p>
        <p className="mt-1 truncate text-sm text-foreground">{sessionLabel}</p>
      </div>
      <Badge
        variant="secondary"
        className="rounded-none border px-2 py-1 text-[10px] uppercase tracking-[0.08em]"
      >
        {isBusy ? "Running" : "Ready"}
      </Badge>
    </div>
  );
}
