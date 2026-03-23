"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  FileText,
  Folder,
  Home,
  Loader2,
  Minus,
  Paperclip,
  RefreshCw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  Ms365AttachmentSelection,
  Ms365BrowserItem,
  Ms365LocationSummary,
} from "@/lib/ms365/types";

type Ms365AttachDialogProps = {
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  showTrigger?: boolean;
};

type BrowseResponse = {
  currentFolder: Ms365BrowserItem;
  items: Array<Ms365BrowserItem>;
};

function formatSize(bytes?: number): string {
  if (typeof bytes !== "number") return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(isoString?: string): string {
  if (!isoString) return "—";
  const date = new Date(isoString);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function Ms365AttachDialog({
  disabled = false,
  onOpenChange,
  open: controlledOpen,
  showTrigger = true,
}: Ms365AttachDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [locations, setLocations] = useState<Array<Ms365LocationSummary>>([]);
  const [activeLocationId, setActiveLocationId] = useState<string>("");
  const [history, setHistory] = useState<Array<Ms365BrowserItem>>([]);
  const [currentFolder, setCurrentFolder] = useState<Ms365BrowserItem | null>(null);
  const [items, setItems] = useState<Array<Ms365BrowserItem>>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selectedByKey, setSelectedByKey] = useState<Record<string, Ms365AttachmentSelection>>({});

  const activeLocation = useMemo(
    () => locations.find((loc) => loc.id === activeLocationId) ?? null,
    [activeLocationId, locations]
  );
  const open = controlledOpen ?? internalOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange]
  );

  const selectedFiles = useMemo(() => Object.values(selectedByKey), [selectedByKey]);
  const hasLocations = locations.length > 0;

  // Files only (no folders) in the current view — used for select-all
  const filesInView = useMemo(() => items.filter((i) => i.kind === "file"), [items]);

  const allFilesSelected = useMemo(() => {
    if (!activeLocation || filesInView.length === 0) return false;
    return filesInView.every((item) =>
      Boolean(selectedByKey[`${activeLocation.id}:${item.id}`])
    );
  }, [activeLocation, filesInView, selectedByKey]);

  const someFilesSelected = useMemo(() => {
    if (!activeLocation || filesInView.length === 0) return false;
    return filesInView.some((item) =>
      Boolean(selectedByKey[`${activeLocation.id}:${item.id}`])
    );
  }, [activeLocation, filesInView, selectedByKey]);

  const loadItems = useCallback(
    async (locationId: string, itemId?: string, nextHistory?: Array<Ms365BrowserItem>) => {
      setIsLoadingItems(true);
      setErrorText(null);
      try {
        const query = itemId ? `?itemId=${encodeURIComponent(itemId)}` : "";
        const response = await fetch(
          `/api/ms365/locations/${encodeURIComponent(locationId)}/items${query}`,
          { cache: "no-store" }
        );
        const data = (await response.json()) as BrowseResponse & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Failed to load Microsoft 365 items.");
        setItems(data.items);
        setCurrentFolder(data.currentFolder);
        setHistory(nextHistory ?? []);
      } catch (error) {
        setErrorText(
          error instanceof Error ? error.message : "Failed to load Microsoft 365 items."
        );
      } finally {
        setIsLoadingItems(false);
      }
    },
    []
  );

  const loadLocations = useCallback(async () => {
    setIsLoadingLocations(true);
    setErrorText(null);
    try {
      const response = await fetch("/api/ms365/locations", { cache: "no-store" });
      const data = (await response.json()) as {
        locations?: Array<Ms365LocationSummary>;
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error ?? "Failed to load Microsoft 365 locations.");
      const nextLocations = data.locations ?? [];
      setLocations(nextLocations);
      if (nextLocations.length === 0) {
        setActiveLocationId("");
        setItems([]);
        setCurrentFolder(null);
        setHistory([]);
        return;
      }
      const nextId =
        nextLocations.find((loc) => loc.id === activeLocationId)?.id ??
        nextLocations[0]?.id ??
        "";
      setActiveLocationId(nextId);
      await loadItems(nextId);
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : "Failed to load Microsoft 365 locations."
      );
    } finally {
      setIsLoadingLocations(false);
    }
  }, [activeLocationId, loadItems]);

  useEffect(() => {
    if (!open) return;
    setErrorText(null);
    void loadLocations();
  }, [loadLocations, open]);

  const handleLocationSelect = useCallback(
    async (locationId: string) => {
      if (locationId === activeLocationId) return;
      setActiveLocationId(locationId);
      await loadItems(locationId);
    },
    [activeLocationId, loadItems]
  );

  const handleOpenFolder = useCallback(
    async (folder: Ms365BrowserItem) => {
      if (!currentFolder || !activeLocationId) return;
      await loadItems(activeLocationId, folder.id, [...history, currentFolder]);
    },
    [activeLocationId, currentFolder, history, loadItems]
  );

  // index === -1 → navigate to the location root
  // index >= 0  → navigate to history[index]
  const handleNavigateToBreadcrumb = useCallback(
    async (index: number) => {
      if (!activeLocationId) return;
      if (index === -1) {
        await loadItems(activeLocationId, undefined, []);
        return;
      }
      const target = history[index];
      if (!target) return;
      await loadItems(activeLocationId, target.id, history.slice(0, index));
    },
    [activeLocationId, history, loadItems]
  );

  const handleToggleFile = useCallback(
    (item: Ms365BrowserItem) => {
      if (!activeLocation) return;
      const key = `${activeLocation.id}:${item.id}`;
      setSelectedByKey((current) => {
        if (current[key]) {
          const next = { ...current };
          delete next[key];
          return next;
        }
        return {
          ...current,
          [key]: { ...item, locationId: activeLocation.id, locationLabel: activeLocation.label },
        };
      });
    },
    [activeLocation]
  );

  const handleSelectAll = useCallback(() => {
    if (!activeLocation) return;
    if (allFilesSelected) {
      // Deselect all files in current view
      setSelectedByKey((current) => {
        const next = { ...current };
        for (const item of filesInView) {
          delete next[`${activeLocation.id}:${item.id}`];
        }
        return next;
      });
    } else {
      // Select all files in current view
      setSelectedByKey((current) => {
        const next = { ...current };
        for (const item of filesInView) {
          next[`${activeLocation.id}:${item.id}`] = {
            ...item,
            locationId: activeLocation.id,
            locationLabel: activeLocation.label,
          };
        }
        return next;
      });
    }
  }, [activeLocation, allFilesSelected, filesInView]);

  const handleDeselectFile = useCallback((file: Ms365AttachmentSelection) => {
    setSelectedByKey((current) => {
      const key = `${file.locationId}:${file.id}`;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  // Shared button styles for location items
  const locationBtnClass = (active: boolean) =>
    `flex w-full items-center gap-2 text-left text-sm transition-colors ${
      active
        ? "bg-(--brand) font-semibold text-(--brand-on)"
        : "text-(--ink) hover:bg-(--surface-hover)"
    }`;

  return (
    <>
      {showTrigger ? (
        <Button
          type="button"
          variant="outline"
          className="agent-btn rounded-none border-2 shadow-none"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Paperclip className="size-4" />
          Upload MS365
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="agent-dialog flex h-[min(88vh,56rem)] !w-[min(84rem,calc(100vw-2rem))] !max-w-none flex-col gap-0 overflow-hidden rounded-none border-2 border-(--border) bg-(--paper-2) p-0 shadow-[8px_8px_0_rgba(var(--shadow-ink),0.12)]"
          showCloseButton
        >
          {/* ── Header ──────────────────────────────────────── */}
          <DialogHeader className="shrink-0 border-b-2 border-(--border) px-5 py-4 pr-12 text-left">
            <div className="flex items-center gap-2.5">
              <Paperclip className="size-4 shrink-0 text-(--ink-soft)" />
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold uppercase tracking-[0.08em] text-foreground">
                  Upload from Microsoft 365
                </DialogTitle>
                <p className="text-sm text-(--ink-muted)">
                  Browse files from SharePoint locations.
                </p>
              </div>
            </div>
          </DialogHeader>

          {/* ── Body: stacked on mobile, side-by-side on sm+ ── */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">

            {/* ── Locations panel ─────────────────────────────── */}
            {/* On mobile: compact horizontal tab strip across full width  */}
            {/* On sm+:    fixed-width vertical sidebar                    */}
            <div className="shrink-0 overflow-hidden border-b-2 border-(--border) sm:flex sm:w-52 sm:flex-col sm:border-b-0 sm:border-r-2">
              {/* Panel header */}
              <div className="flex items-center justify-between border-b-2 border-(--border) px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                  Locations
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-none"
                  onClick={() => void loadLocations()}
                  disabled={isLoadingLocations || isLoadingItems}
                  title="Refresh locations"
                >
                  <RefreshCw
                    className={`size-3.5 ${isLoadingLocations ? "animate-spin" : ""}`}
                  />
                  <span className="sr-only">Refresh</span>
                </Button>
              </div>

              {/* Mobile: horizontal scrollable tabs */}
              <div className="flex overflow-x-auto sm:hidden">
                {isLoadingLocations ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-(--ink-soft)">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading…
                  </div>
                ) : locations.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-(--ink-muted)">No locations.</p>
                ) : (
                  locations.map((location) => (
                    <button
                      key={location.id}
                      type="button"
                      onClick={() => void handleLocationSelect(location.id)}
                      className={`shrink-0 px-4 py-2.5 ${locationBtnClass(location.id === activeLocationId)}`}
                    >
                      <Folder className="size-3.5 shrink-0 opacity-70" />
                      <span className="whitespace-nowrap">{location.label}</span>
                    </button>
                  ))
                )}
              </div>

              {/* Desktop: vertical scrollable list */}
              <ScrollArea className="hidden flex-1 sm:block [&>[data-slot=scroll-area-viewport]>div]:block! [&>[data-slot=scroll-area-viewport]>div]:min-w-0 [&>[data-slot=scroll-area-viewport]>div]:w-full">
                {isLoadingLocations ? (
                  <div className="flex items-center gap-2 px-3 py-3 text-sm text-(--ink-soft)">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading…
                  </div>
                ) : locations.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-(--ink-muted)">No locations configured.</p>
                ) : (
                  <div className="py-1">
                    {locations.map((location) => (
                      <button
                        key={location.id}
                        type="button"
                        onClick={() => void handleLocationSelect(location.id)}
                        className={`px-3 py-2.5 ${locationBtnClass(location.id === activeLocationId)}`}
                      >
                        <Folder className="size-3.5 shrink-0 opacity-70" />
                        <span className="truncate">{location.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>

              {/* "Add location" — desktop sidebar footer only */}
              <div className="hidden border-t-2 border-(--border) p-2 sm:block">
                <Link
                  href="/ms365/allowlist"
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full px-2 py-1.5 text-xs text-(--ink-soft) underline-offset-2 hover:text-(--ink) hover:underline"
                >
                  + Add location
                </Link>
              </div>
            </div>

            {/* ── File browser panel ───────────────────────────── */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Breadcrumb bar */}
              <div className="flex min-h-10 items-center gap-0.5 overflow-x-auto border-b-2 border-(--border) px-3 py-2">
                {activeLocation ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleNavigateToBreadcrumb(-1)}
                      disabled={isLoadingItems || history.length === 0}
                      className="flex shrink-0 items-center px-1 py-0.5 text-(--ink-soft) transition-colors hover:text-(--ink) disabled:pointer-events-none disabled:opacity-40"
                      title={`${activeLocation.label} — go to root`}
                    >
                      <Home className="size-3.5" />
                    </button>
                    {history.map((item, index) => (
                      <Fragment key={item.id}>
                        <ChevronRight className="size-3.5 shrink-0 text-(--ink-muted)" />
                        <button
                          type="button"
                          onClick={() => void handleNavigateToBreadcrumb(index)}
                          disabled={isLoadingItems}
                          className="max-w-[8rem] shrink-0 truncate px-1 py-0.5 text-xs text-(--ink-soft) underline-offset-2 transition-colors hover:text-(--ink) hover:underline disabled:pointer-events-none disabled:opacity-40"
                        >
                          {item.name}
                        </button>
                      </Fragment>
                    ))}
                    <ChevronRight className="size-3.5 shrink-0 text-(--ink-muted)" />
                    <span className="truncate px-1 text-xs font-semibold text-(--ink)">
                      {currentFolder?.name ?? activeLocation.rootName}
                    </span>
                  </>
                ) : !isLoadingLocations ? (
                  <span className="text-xs text-(--ink-muted)">
                    Select a location to browse files.
                  </span>
                ) : null}

                {selectedFiles.length > 0 ? (
                  <span className="ml-auto shrink-0 border-2 border-(--border) bg-(--surface-light) px-2 py-0.5 text-xs font-semibold text-(--ink)">
                    {selectedFiles.length} selected
                  </span>
                ) : null}
              </div>

              {/* File list */}
              <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block! [&>[data-slot=scroll-area-viewport]>div]:min-w-0 [&>[data-slot=scroll-area-viewport]>div]:w-full">
                {/* Error */}
                {hasLocations && errorText ? (
                  <div className="m-3 border-2 border-(--danger) bg-(--danger-soft) px-3 py-2.5 text-sm text-(--danger)">
                    {errorText}
                  </div>
                ) : null}

                {/* Loading */}
                {isLoadingItems ? (
                  <div className="flex items-center justify-center gap-2 py-20 text-sm text-(--ink-soft)">
                    <Loader2 className="size-4 animate-spin" />
                    Loading files…
                  </div>
                ) : null}

                {/* No locations empty state */}
                {!hasLocations && !isLoadingLocations && !isLoadingItems ? (
                  <div className="flex min-h-60 flex-col items-center justify-center gap-3 px-8 py-10 text-center">
                    <Folder className="size-10 text-(--ink-muted)" />
                    <div>
                      <p className="text-sm font-semibold text-(--ink-soft)">
                        No locations configured
                      </p>
                      <p className="mt-1 text-xs text-(--ink-muted)">
                        Add a SharePoint location to start browsing files.
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* Items */}
                {hasLocations && !isLoadingItems && items.length > 0 ? (
                  <>
                    {/* Column headers
                        Mobile:  Name | Modified | (chevron)
                        Desktop: Name | Size | Modified | (chevron)        */}
                    <div className="grid items-center gap-x-4 border-b-2 border-(--border) bg-(--paper-3) px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.07em] text-(--ink-muted) grid-cols-[1fr_6.5rem_1.25rem] sm:grid-cols-[1fr_5.5rem_6.5rem_1.25rem]">
                      {/* Select-all checkbox + "Name" label */}
                      <div className="flex items-center gap-2.5">
                        {filesInView.length > 0 ? (
                          <button
                            type="button"
                            onClick={handleSelectAll}
                            title={allFilesSelected ? "Deselect all" : "Select all files"}
                            className={`flex size-4 shrink-0 items-center justify-center border-2 transition-colors ${
                              allFilesSelected
                                ? "border-(--brand) bg-(--brand)"
                                : someFilesSelected
                                  ? "border-(--brand) bg-(--brand)"
                                  : "border-(--border) hover:border-(--ink-soft)"
                            }`}
                          >
                            {allFilesSelected ? (
                              <Check className="size-2.5 text-(--brand-on)" strokeWidth={3} />
                            ) : someFilesSelected ? (
                              <Minus className="size-2.5 text-(--brand-on)" strokeWidth={3} />
                            ) : null}
                          </button>
                        ) : (
                          <span className="size-4 shrink-0" />
                        )}
                        <span>Name</span>
                      </div>
                      {/* Size — desktop only */}
                      <span className="hidden text-right sm:block">Size</span>
                      {/* Modified */}
                      <span>Modified</span>
                      <span />
                    </div>

                    {items.map((item) => {
                      const key = `${activeLocation?.id ?? ""}:${item.id}`;
                      const isSelected = Boolean(selectedByKey[key]);

                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`group grid w-full items-center gap-x-4 border-b border-(--border)/50 px-3 py-2.5 text-left transition-colors grid-cols-[1fr_6.5rem_1.25rem] sm:grid-cols-[1fr_5.5rem_6.5rem_1.25rem] ${
                            isSelected ? "bg-(--brand-soft)" : "hover:bg-(--surface-hover)"
                          }`}
                          onClick={() =>
                            item.kind === "folder"
                              ? void handleOpenFolder(item)
                              : handleToggleFile(item)
                          }
                        >
                          {/* Name */}
                          <div className="flex min-w-0 items-center gap-2.5">
                            {item.kind === "file" ? (
                              <div
                                className={`flex size-4 shrink-0 items-center justify-center border-2 transition-colors ${
                                  isSelected
                                    ? "border-(--brand) bg-(--brand)"
                                    : "border-(--border) group-hover:border-(--ink-soft)"
                                }`}
                              >
                                {isSelected && (
                                  <Check
                                    className="size-2.5 text-(--brand-on)"
                                    strokeWidth={3}
                                  />
                                )}
                              </div>
                            ) : (
                              <Folder className="size-4 shrink-0 text-(--ink-soft)" />
                            )}
                            <span className="truncate text-sm font-medium text-(--ink)">
                              {item.name}
                            </span>
                          </div>

                          {/* Size — desktop only */}
                          <span className="hidden text-right text-xs text-(--ink-muted) sm:block">
                            {item.kind === "file" ? formatSize(item.size) : ""}
                          </span>

                          {/* Modified */}
                          <span className="text-xs text-(--ink-muted)">
                            {formatDate(item.lastModifiedDateTime)}
                          </span>

                          {/* Chevron for folders */}
                          <span className="flex justify-end">
                            {item.kind === "folder" && (
                              <ChevronRight className="size-3.5 text-(--ink-muted) transition-colors group-hover:text-(--ink)" />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </>
                ) : null}

                {/* Empty folder */}
                {hasLocations && !isLoadingItems && !errorText && items.length === 0 ? (
                  <div className="flex min-h-60 flex-col items-center justify-center gap-2">
                    <p className="text-sm text-(--ink-muted)">This folder is empty.</p>
                  </div>
                ) : null}
              </ScrollArea>
            </div>
          </div>

          {/* ── Footer ──────────────────────────────────────── */}
          <div className="shrink-0 border-t-2 border-(--border) bg-(--paper-3) px-5 py-3">
            {selectedFiles.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {selectedFiles.map((file) => (
                  <span
                    key={`${file.locationId}:${file.id}`}
                    className="flex items-center gap-1.5 border-2 border-(--border) bg-(--surface-light) px-2 py-0.5 text-xs font-medium text-(--ink)"
                  >
                    <FileText className="size-3 shrink-0 text-(--ink-soft)" />
                    <span className="max-w-48 truncate">{file.name}</span>
                    <button
                      type="button"
                      className="ml-0.5 text-(--ink-soft) hover:text-(--ink)"
                      onClick={() => handleDeselectFile(file)}
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="agent-btn rounded-none border-2 shadow-none"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="agent-btn-primary rounded-none border-2 shadow-none"
                disabled={selectedFiles.length === 0}
                onClick={() => {}}
              >
                <Paperclip className="size-4" />
                {selectedFiles.length > 0
                  ? `Upload ${selectedFiles.length} ${selectedFiles.length === 1 ? "File" : "Files"}`
                  : "Upload"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
