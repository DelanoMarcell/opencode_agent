"use client";

import { type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

type AgentTracePanelProps = {
  basePort: string;
  baseUrl: string;
  canEditBaseUrl: boolean;
  onBaseUrlChange: (value: string) => void;
  onHide: () => void;
  traceLines: Array<string>;
};

export function AgentTracePanel({
  basePort,
  baseUrl,
  canEditBaseUrl,
  onBaseUrlChange,
  onHide,
  traceLines,
}: AgentTracePanelProps) {
  return (
    <Card className="agent-trace-panel hidden min-h-0 min-w-0 gap-0 overflow-hidden rounded-none border-2 py-0 shadow-none lg:flex">
      <CardHeader className="border-b-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Live Trace</CardTitle>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={onHide}
            className="agent-btn rounded-none border-2 shadow-none"
          >
            Hide
          </Button>
        </div>
        <div className="mt-2 space-y-2">
          <div className="space-y-1">
            <label
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-(--ink-soft)"
              htmlFor="trace-base-url"
            >
              Base URL
            </label>
            <input
              id="trace-base-url"
              value={baseUrl}
              onChange={(event: ChangeEvent<HTMLInputElement>) => onBaseUrlChange(event.target.value)}
              disabled={!canEditBaseUrl}
              className="agent-field h-8 w-full border-2 px-2 text-xs outline-none"
            />
          </div>
          <div className="space-y-1">
            <label
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-(--ink-soft)"
              htmlFor="trace-base-port"
            >
              Port
            </label>
            <input
              id="trace-base-port"
              value={basePort}
              readOnly
              className="agent-field h-8 w-full border-2 px-2 text-xs outline-none"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 min-w-0 flex-1 p-0">
        <ScrollArea type="always" className="h-full p-3 font-mono text-xs leading-relaxed">
          {traceLines.length === 0 ? (
            <p className="text-(--ink-muted)">Trace output appears here.</p>
          ) : (
            traceLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
