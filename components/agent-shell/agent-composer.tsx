"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from "react";
import { Paperclip, X } from "lucide-react";

import { AgentComposerLoader } from "@/components/loaders/agent-composer-loader";
import { Ms365AttachDialog } from "@/components/agent-shell/ms365-attach-dialog";
import { Badge } from "@/components/ui/badge";
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
import type { Ms365AttachmentSelection } from "@/lib/ms365/types";

type StatRow = {
  label: string;
  value: string;
};

type AgentComposerProps = {
  composerPlaceholder: string;
  contextBreakdownRows: Array<StatRow>;
  contextUsageText: string;
  filesScopeLabel: "session" | "matter";
  inputText: string;
  isBusy: boolean;
  isMatterSelectionRequired: boolean;
  isLoadingSelectedSession: boolean;
  isUploadingFiles: boolean;
  latestContextUsage: TokenUsageTotals | null;
  modelLabel: string;
  ms365Attachments: Array<Ms365AttachmentSelection>;
  canUploadFiles: boolean;
  currentFilesSummary?: StoredFileSummary;
  onInputTextChange: (value: string) => void;
  onLocalFilesSelected: (files: Array<File>) => void;
  onOpenFiles: () => void;
  onMs365AttachmentsAdd: (files: Array<Ms365AttachmentSelection>) => void;
  onMs365AttachmentRemove: (key: string) => void;
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
  composerPlaceholder,
  contextBreakdownRows,
  contextUsageText,
  filesScopeLabel,
  inputText,
  isBusy,
  isMatterSelectionRequired,
  isLoadingSelectedSession,
  isUploadingFiles,
  latestContextUsage,
  modelLabel,
  ms365Attachments,
  canUploadFiles,
  currentFilesSummary,
  onInputTextChange,
  onLocalFilesSelected,
  onOpenFiles,
  onMs365AttachmentsAdd,
  onMs365AttachmentRemove,
  onKeyDown,
  onSend,
  sendDisabled,
  sessionCostFormulaGroups,
  sessionCostFormulaTotal,
  sessionSpendText,
  sessionTotalsRows,
  textareaRef,
}: AgentComposerProps) {
  const [isMs365DialogOpen, setIsMs365DialogOpen] = useState(false);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const isComposerDisabled = isBusy || isLoadingSelectedSession || isMatterSelectionRequired;
  const helperText = isMatterSelectionRequired
    ? "Select a matter folder before sending a message."
    : isBusy
      ? "Waiting for assistant response..."
      : "Press Enter to send, Shift+Enter for newline.";
  const filesLabel = filesScopeLabel === "matter" ? "matter" : "session";

  function handleOpenLocalFilePicker() {
    if (isComposerDisabled || !canUploadFiles || isUploadingFiles) {
      return;
    }

    localFileInputRef.current?.click();
  }

  function handleLocalFilesChosen(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) {
      onLocalFilesSelected(files);
    }
    input.value = "";
  }

  return (
    <div className="agent-composer min-w-0 border-t-2 px-4 py-3">
      <div className="space-y-2">
        <input
          ref={localFileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleLocalFilesChosen}
        />
        <Ms365AttachDialog
          disabled={isComposerDisabled}
          onAttach={onMs365AttachmentsAdd}
          open={isMs365DialogOpen}
          onOpenChange={setIsMs365DialogOpen}
          showTrigger={false}
        />
        {ms365Attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {ms365Attachments.map((attachment) => {
              const key = `${attachment.locationId}:${attachment.id}`;

              return (
                <Badge
                  key={key}
                  variant="outline"
                  className="gap-1 rounded-none border-2 px-2 py-1"
                >
                  <Paperclip className="size-3" />
                  <span className="max-w-56 truncate">{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    className="ml-1 inline-flex items-center"
                    onClick={() => onMs365AttachmentRemove(key)}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              );
            })}
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
            <DropdownMenu>
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
                  disabled={!canUploadFiles || isUploadingFiles}
                  onSelect={(event) => {
                    event.preventDefault();
                    handleOpenLocalFilePicker();
                  }}
                >
                  {isUploadingFiles ? "Uploading…" : "Upload from your device"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="agent-menu-item rounded-none py-2"
                  disabled={!canUploadFiles}
                  onSelect={(event) => {
                    event.preventDefault();
                    onOpenFiles();
                  }}
                >
                  {`Files from this ${filesLabel}`}
                  {currentFilesSummary?.fileCount
                    ? ` (${currentFilesSummary.fileCount})`
                    : ""}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="agent-menu-item rounded-none py-2"
                  onSelect={(event) => {
                    event.preventDefault();
                    setIsMs365DialogOpen(true);
                  }}
                >
                  From Microsoft 365
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
