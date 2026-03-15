"use client";

import type { KeyboardEvent, RefObject } from "react";

import { AgentComposerLoader } from "@/components/loaders/agent-composer-loader";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatUsdAmount } from "@/lib/agent-runtime/helpers";
import type { CostFormulaGroup, TokenUsageTotals } from "@/lib/agent-runtime/types";

type StatRow = {
  label: string;
  value: string;
};

type AgentComposerProps = {
  contextBreakdownRows: Array<StatRow>;
  contextUsageText: string;
  inputText: string;
  isBusy: boolean;
  isLoadingSelectedSession: boolean;
  latestContextUsage: TokenUsageTotals | null;
  modelLabel: string;
  onInputTextChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  sendDisabled: boolean;
  sessionCostFormulaGroups: Array<CostFormulaGroup>;
  sessionCostFormulaTotal: number;
  sessionSpendText: string;
  sessionTotalsRows: Array<StatRow>;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

export function AgentComposer({
  contextBreakdownRows,
  contextUsageText,
  inputText,
  isBusy,
  isLoadingSelectedSession,
  latestContextUsage,
  modelLabel,
  onInputTextChange,
  onKeyDown,
  onSend,
  sendDisabled,
  sessionCostFormulaGroups,
  sessionCostFormulaTotal,
  sessionSpendText,
  sessionTotalsRows,
  textareaRef,
}: AgentComposerProps) {
  const isComposerDisabled = isBusy || isLoadingSelectedSession;

  return (
    <div className="agent-composer min-w-0 border-t-2 px-4 py-3">
      <div className="space-y-2">
        <Textarea
          ref={textareaRef}
          value={inputText}
          onChange={(event) => onInputTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a message..."
          className="agent-field min-h-16 max-h-40 overflow-y-auto resize-none rounded-none border-2 shadow-none"
          disabled={isComposerDisabled}
        />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            {isLoadingSelectedSession ? (
              <AgentComposerLoader />
            ) : (
              <>
                <p className="text-xs text-(--ink-soft)">
                  {isBusy ? "Waiting for assistant response..." : "Press Enter to send, Shift+Enter for newline."}
                </p>
                <p className="text-[11px] text-(--ink-soft)">Model: {modelLabel}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-(--ink-muted)">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="agent-context-trigger inline-flex items-baseline gap-1 text-left"
                        disabled={!latestContextUsage}
                      >
                        <span>Context: {contextUsageText}</span>
                        <span className="agent-context-trigger-label text-[10px] uppercase tracking-[0.08em]">
                          View
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      sideOffset={8}
                      collisionPadding={8}
                      style={{
                        ["--agent-context-popover-max-height" as string]:
                          "min(85vh, calc(var(--radix-popover-content-available-height, 100vh) - 8px))",
                        maxHeight: "var(--agent-context-popover-max-height)",
                        width: "min(30rem, calc(100vw - 1rem))",
                      }}
                      onOpenAutoFocus={(event) => event.preventDefault()}
                      className="agent-context-popover flex flex-col rounded-none border-2 p-0 shadow-none"
                    >
                      <PopoverHeader className="agent-context-popover-header border-b-2 px-4 py-3">
                        <PopoverTitle className="text-xs font-semibold uppercase tracking-[0.12em]">
                          Usage Breakdown
                        </PopoverTitle>
                        <p className="text-[11px] text-(--ink-soft)">
                          Current context and cumulative session totals
                        </p>
                      </PopoverHeader>
                      <TooltipProvider delayDuration={0}>
                        <div className="agent-context-popover-body min-h-0 flex-1">
                          <ScrollArea type="always" className="agent-context-popover-scroll min-h-0 min-w-0">
                            <div className="space-y-3 px-4 py-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <section className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-widest text-(--ink-soft)">
                                      Current Context
                                    </p>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="agent-context-help"
                                          aria-label="Explain current context"
                                        >
                                          ?
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="right"
                                        className="agent-context-tooltip rounded-none border-2 shadow-none [&>svg]:fill-(--paper-2)"
                                      >
                                        Latest prompt size right now. It shows what the most recent
                                        assistant request used against the model&apos;s context window.
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                  <div className="flex items-center justify-between gap-3 border-b pb-2 text-[11px]">
                                    <span className="font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                                      Model
                                    </span>
                                    <span className="text-right text-foreground">{modelLabel}</span>
                                  </div>
                                  {contextBreakdownRows.map((row) => (
                                    <div
                                      key={`context-${row.label}`}
                                      className="flex items-center justify-between gap-3 text-[11px]"
                                    >
                                      <span className="font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                                        {row.label}
                                      </span>
                                      <span className="text-right text-foreground">{row.value}</span>
                                    </div>
                                  ))}
                                </section>

                                <section className="space-y-2 border-t-2 pt-3 md:border-l-2 md:border-t-0 md:pl-3 md:pt-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-widest text-(--ink-soft)">
                                      Session Totals
                                    </p>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="agent-context-help"
                                          aria-label="Explain session totals"
                                        >
                                          ?
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="right"
                                        className="agent-context-tooltip rounded-none border-2 shadow-none [&>svg]:fill-(--paper-2)"
                                      >
                                        Lifetime token traffic for this session. It adds token usage
                                        from all assistant turns together.
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                  {sessionTotalsRows.map((row) => (
                                    <div
                                      key={`session-${row.label}`}
                                      className="flex items-center justify-between gap-3 text-[11px]"
                                    >
                                      <span className="font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                                        {row.label}
                                      </span>
                                      <span className="text-right text-foreground">{row.value}</span>
                                    </div>
                                  ))}
                                </section>
                              </div>

                              <section className="border-t-2 pt-3">
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-(--ink-soft)">
                                  Cost Calculation
                                </p>
                                {sessionCostFormulaGroups.length > 0 ? (
                                  <div className="mt-2 space-y-1.5">
                                    {sessionCostFormulaGroups.map((group) => (
                                      <div
                                        key={group.key}
                                        className="space-y-1.5 border border-(--border)/20 bg-(--surface) p-2 text-[11px]"
                                      >
                                        <div className="border-b pb-1.5">
                                          <p className="break-all font-semibold text-foreground">
                                            {group.modelKey}
                                          </p>
                                          {group.pricingLabel ? (
                                            <p className="text-[10px] uppercase tracking-[0.08em] text-(--ink-soft)">
                                              {group.pricingLabel}
                                            </p>
                                          ) : null}
                                        </div>

                                        {group.rows.map((row) => (
                                          <div key={`${group.key}-${row.label}`} className="text-[11px]">
                                            <div className="flex items-start justify-between gap-3">
                                              <div className="min-w-0">
                                                <p className="font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                                                  {row.label}
                                                </p>
                                                <p className="text-[10px] text-(--ink-soft)">{row.detail}</p>
                                              </div>
                                              <span className="shrink-0 text-right text-foreground">
                                                {formatUsdAmount(row.amount)}
                                              </span>
                                            </div>
                                          </div>
                                        ))}

                                        <div className="flex items-center justify-between gap-3 border-t pt-2 text-[11px]">
                                          <span className="font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                                            Model Subtotal
                                          </span>
                                          <span className="text-right text-foreground">
                                            {formatUsdAmount(group.total)}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                    <div className="flex items-center justify-between gap-3 border-t pt-2 text-[11px]">
                                      <span className="font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                                        Estimated Total
                                      </span>
                                      <span className="text-right text-foreground">
                                        {formatUsdAmount(sessionCostFormulaTotal)}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="mt-2 text-[11px] text-(--ink-soft)">
                                    Pricing metadata unavailable for this session.
                                  </p>
                                )}
                              </section>
                            </div>
                          </ScrollArea>
                        </div>
                      </TooltipProvider>
                    </PopoverContent>
                  </Popover>
                  <span aria-hidden="true">·</span>
                  <span>Spent: {sessionSpendText}</span>
                </div>
              </>
            )}
          </div>
          <Button
            type="button"
            onClick={onSend}
            disabled={sendDisabled}
            className="agent-btn-primary rounded-none border-2 border-(--border) px-5 shadow-none"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
