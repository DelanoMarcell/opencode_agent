"use client";

import { useState, type KeyboardEvent, type RefObject } from "react";
import { FileText, Paperclip, X } from "lucide-react";

import { AgentComposerLoader } from "@/components/loaders/agent-composer-loader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { StoredFileSummary } from "@/lib/files/types";

type StatRow = {
  label: string;
  value: string;
};

type ComposerAttachedFile = {
  fileId: string;
  originalName: string;
};

type AgentComposerProps = {
  attachedFiles: Array<ComposerAttachedFile>;
  composerPlaceholder: string;
  contextBreakdownRows: Array<StatRow>;
  contextUsageText: string;
  filesScopeLabel: "session" | "matter";
  inputText: string;
  isBusy: boolean;
  isMatterSelectionRequired: boolean;
  isLoadingSelectedSession: boolean;
  latestContextUsage: TokenUsageTotals | null;
  modelLabel: string;
  canManageFiles: boolean;
  currentFilesSummary?: StoredFileSummary;
  onClearAttachedFiles: () => void;
  onInputTextChange: (value: string) => void;
  onOpenFiles: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemoveAttachedFile: (fileId: string) => void;
  onSend: () => void;
  sendDisabled: boolean;
  sessionCostFormulaGroups: Array<CostFormulaGroup>;
  sessionCostFormulaTotal: number;
  sessionSpendText: string;
  sessionTotalsRows: Array<StatRow>;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

export function AgentComposer({
  attachedFiles,
  composerPlaceholder,
  contextBreakdownRows,
  contextUsageText,
  filesScopeLabel,
  inputText,
  isBusy,
  isMatterSelectionRequired,
  isLoadingSelectedSession,
  latestContextUsage,
  modelLabel,
  canManageFiles,
  currentFilesSummary,
  onClearAttachedFiles,
  onInputTextChange,
  onOpenFiles,
  onKeyDown,
  onRemoveAttachedFile,
  onSend,
  sendDisabled,
  sessionCostFormulaGroups,
  sessionCostFormulaTotal,
  sessionSpendText,
  sessionTotalsRows,
  textareaRef,
}: AgentComposerProps) {
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const isComposerDisabled = isBusy || isLoadingSelectedSession || isMatterSelectionRequired;
  const helperText = isMatterSelectionRequired
    ? "Select a matter folder before sending a message."
    : isBusy
      ? "Waiting for assistant response..."
      : "Press Enter to send, Shift+Enter for newline.";
  const filesLabel = filesScopeLabel === "matter" ? "Matter files" : "Session files";
  const visibleAttachedFiles = attachedFiles.slice(0, 3);
  const hiddenAttachedFileCount = Math.max(0, attachedFiles.length - visibleAttachedFiles.length);

  return (
    <div className="agent-composer min-w-0 border-t-2 px-4 py-3">
      <div className="space-y-2">
        {attachedFiles.length > 0 ? (
          <div className="rounded-none border-2 border-(--border) bg-(--paper-3) px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                <Paperclip className="size-3.5" />
                Attached for next send
              </div>
              <button
                type="button"
                className="text-[11px] font-medium text-(--ink-soft) underline-offset-2 transition-colors hover:text-foreground hover:underline"
                onClick={onClearAttachedFiles}
              >
                Clear all
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {visibleAttachedFiles.map((file) => (
                <div
                  key={file.fileId}
                  className="inline-flex max-w-full items-center gap-1.5 border-2 border-(--border) bg-(--surface) px-2 py-1 text-xs"
                >
                  <FileText className="size-3.5 shrink-0 text-(--ink-soft)" />
                  <span className="max-w-[12rem] truncate" title={file.originalName}>
                    {file.originalName}
                  </span>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center justify-center text-(--ink-soft) transition-colors hover:text-foreground"
                    aria-label={`Remove ${file.originalName}`}
                    onClick={() => onRemoveAttachedFile(file.fileId)}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              {hiddenAttachedFileCount > 0 ? (
                <div className="inline-flex items-center border-2 border-dashed border-(--border) px-2 py-1 text-xs text-(--ink-soft)">
                  … and {hiddenAttachedFileCount} more
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <Textarea
          ref={textareaRef}
          value={inputText}
          onChange={(event) => onInputTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={composerPlaceholder}
          className="agent-field min-h-16 max-h-40 overflow-y-auto resize-none rounded-none border-2 shadow-none"
          disabled={isComposerDisabled}
        />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            {isLoadingSelectedSession ? (
              <AgentComposerLoader />
            ) : (
              <>
                <p className="text-xs text-(--ink-soft)">{helperText}</p>
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
          <div className="flex items-center gap-2">
            <DropdownMenu open={isAttachMenuOpen} onOpenChange={setIsAttachMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="agent-btn rounded-none border-2 shadow-none"
                  disabled={isComposerDisabled}
                >
                  <Paperclip className="size-4" />
                  Attach
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="agent-menu w-56 rounded-none border-2 shadow-[6px_6px_0_rgba(var(--shadow-ink),0.12)]"
              >
                <DropdownMenuItem
                  className="agent-menu-item rounded-none py-2"
                  disabled={!canManageFiles}
                  onSelect={() => {
                    setIsAttachMenuOpen(false);
                    onOpenFiles();
                  }}
                >
                  {filesLabel}
                  {currentFilesSummary?.fileCount
                    ? ` (${currentFilesSummary.fileCount})`
                    : ""}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
    </div>
  );
}
