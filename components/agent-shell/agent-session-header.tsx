"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatSessionOptionLabel } from "@/lib/agent-runtime/helpers";
import type { SessionOption } from "@/lib/agent-runtime/types";

type AgentSessionHeaderProps = {
  availableSessions: Array<SessionOption>;
  isBusy: boolean;
  selectedSessionID: string;
  onLoadSessionOptions: () => void;
  onResetSession: () => void;
  onResumeSession: () => void;
  onToggleTrace: () => void;
  showTrace: boolean;
};

export function AgentSessionHeader({
  availableSessions,
  isBusy,
  selectedSessionID,
  onLoadSessionOptions,
  onResetSession,
  onResumeSession,
  onToggleTrace,
  showTrace,
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
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={!selectedSessionID || isBusy}
        onClick={onResumeSession}
        className="agent-btn rounded-none border-2 shadow-none"
      >
        Resume
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="agent-btn rounded-none border-2 shadow-none"
          >
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="agent-menu rounded-none border-2 border-(--border) bg-(--surface-light)"
        >
          <DropdownMenuItem
            className="agent-menu-item cursor-pointer rounded-none hover:bg-(--brand-soft) hover:text-foreground focus:bg-(--brand-soft) focus:text-foreground data-highlighted:bg-(--brand-soft) data-highlighted:text-foreground"
            onSelect={onLoadSessionOptions}
          >
            Refresh Sessions
          </DropdownMenuItem>
          <DropdownMenuItem
            className="agent-menu-item cursor-pointer rounded-none hover:bg-(--brand-soft) hover:text-foreground focus:bg-(--brand-soft) focus:text-foreground data-highlighted:bg-(--brand-soft) data-highlighted:text-foreground"
            onSelect={onToggleTrace}
          >
            {showTrace ? "Hide Trace" : "Show Trace"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="agent-menu-item cursor-pointer rounded-none hover:bg-(--brand-soft) hover:text-foreground focus:bg-(--brand-soft) focus:text-foreground data-highlighted:bg-(--brand-soft) data-highlighted:text-foreground"
            onSelect={onResetSession}
          >
            New Session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
