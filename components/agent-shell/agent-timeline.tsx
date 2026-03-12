"use client";

import type { RefObject } from "react";

import { Streamdown } from "streamdown";

import { Badge } from "@/components/ui/badge";
import { formatToolResult } from "@/lib/agent-runtime/helpers";
import type { TimelineItem } from "@/lib/agent-runtime/types";

type AgentTimelineProps = {
  messagesEndRef: RefObject<HTMLDivElement | null>;
  showThinkingCard: boolean;
  timeline: Array<TimelineItem>;
};

export function AgentTimeline({
  messagesEndRef,
  showThinkingCard,
  timeline,
}: AgentTimelineProps) {
  return (
    <div className="min-h-0 min-w-0 flex-1">
      <div className="h-full min-w-0" data-slot="timeline-root">
        <div className="min-w-0 space-y-4 px-4 py-4 sm:px-5">
          {timeline.length === 0 ? (
            <div className="agent-empty min-h-[320px] border-2 border-dashed p-6" />
          ) : (
            timeline.map((item) => {
              if (item.kind === "user") {
                return (
                  <article key={item.id} className="flex min-w-0 justify-end">
                    <div className="agent-card agent-card-user min-w-0 max-w-[90%] border-2 px-4 py-3 text-sm sm:max-w-[85%]">
                      <Streamdown className="agent-markdown" mode="static">
                        {item.text}
                      </Streamdown>
                    </div>
                  </article>
                );
              }

              if (item.kind === "assistant-text") {
                return (
                  <article key={item.id} className="flex min-w-0 justify-start">
                    <div className="agent-avatar mr-3 mt-1 grid size-8 shrink-0 place-items-center border-2 text-xs font-semibold">
                      A
                    </div>
                    <div className="agent-card agent-card-assistant min-w-0 max-w-[90%] border-2 px-4 py-3 text-sm sm:max-w-[85%]">
                      <Streamdown
                        className="agent-markdown"
                        mode={item.running ? "streaming" : "static"}
                        isAnimating={item.running}
                      >
                        {item.text}
                      </Streamdown>
                    </div>
                  </article>
                );
              }

              return (
                <article key={item.id} className="flex min-w-0 justify-start">
                  <div className="agent-avatar agent-avatar-tool mr-3 mt-1 grid size-8 shrink-0 place-items-center border-2 text-xs font-semibold">
                    T
                  </div>
                  <div className="agent-card agent-card-tool min-w-0 max-w-[90%] border-2 p-3 sm:max-w-[85%]">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold uppercase tracking-[0.07em]">
                        {item.toolCall.toolName}
                      </p>
                      <Badge
                        variant={item.toolCall.status === "error" ? "destructive" : "secondary"}
                        className="rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                      >
                        {item.toolCall.status}
                      </Badge>
                    </div>
                    <pre className="agent-tool-pre max-h-36 overflow-auto border p-2 text-xs leading-relaxed whitespace-pre-wrap wrap-break-word">
                      {item.toolCall.argsText}
                    </pre>
                    {item.toolCall.result !== undefined ? (
                      <pre
                        className={`agent-tool-pre mt-2 max-h-44 overflow-auto border p-2 text-xs leading-relaxed whitespace-pre-wrap wrap-break-word ${
                          item.toolCall.isError ? "text-red-700" : ""
                        }`}
                      >
                        {formatToolResult(item.toolCall.result)}
                      </pre>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
          {showThinkingCard ? (
            <article className="flex min-w-0 justify-start">
              <div className="agent-avatar mr-3 mt-1 grid size-8 shrink-0 place-items-center border-2 text-xs font-semibold">
                A
              </div>
              <div className="agent-card agent-card-assistant min-w-0 max-w-[90%] border-2 px-4 py-3 text-sm sm:max-w-[85%]">
                <p className="animate-pulse text-sm italic text-(--ink-soft)">Thinking...</p>
              </div>
            </article>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
