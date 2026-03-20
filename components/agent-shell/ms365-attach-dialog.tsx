"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  FileText,
  Folder,
  Loader2,
  Paperclip,
  RefreshCw,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  onAttach: (files: Array<Ms365AttachmentSelection>) => void;
};

type BrowseResponse = {
  currentFolder: Ms365BrowserItem;
  items: Array<Ms365BrowserItem>;
};

type ResolveResponse = {
  parsed: {
    hostname: string;
    sitePath: string;
    libraryName: string;
    folderPath: string | null;
  };
  resolved: {
    siteId: string;
    siteName: string | null;
    siteWebUrl: string | null;
    driveId: string;
    driveName: string | null;
    driveWebUrl: string | null;
    rootItemId: string | null;
    rootName: string;
    webUrl: string;
  };
  suggestedJson: string;
};

function formatItemMeta(item: Ms365BrowserItem) {
  if (item.kind === "folder") {
    return "Folder";
  }

  if (typeof item.size === "number") {
    const kb = item.size / 1024;
    if (kb < 1024) {
      return `${Math.max(1, Math.round(kb))} KB`;
    }
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  return "File";
}

export function Ms365AttachDialog({
  disabled = false,
  onAttach,
}: Ms365AttachDialogProps) {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<Array<Ms365LocationSummary>>([]);
  const [activeLocationId, setActiveLocationId] = useState<string>("");
  const [history, setHistory] = useState<Array<Ms365BrowserItem>>([]);
  const [currentFolder, setCurrentFolder] = useState<Ms365BrowserItem | null>(null);
  const [items, setItems] = useState<Array<Ms365BrowserItem>>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selectedByKey, setSelectedByKey] = useState<
    Record<string, Ms365AttachmentSelection>
  >({});
  const [showResolver, setShowResolver] = useState(false);
  const [resolverUrl, setResolverUrl] = useState("");
  const [resolverLabel, setResolverLabel] = useState("");
  const [resolverId, setResolverId] = useState("");
  const [resolverError, setResolverError] = useState<string | null>(null);
  const [resolverOutput, setResolverOutput] = useState("");
  const [resolverSummary, setResolverSummary] = useState<ResolveResponse | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [copiedResolverOutput, setCopiedResolverOutput] = useState(false);

  const activeLocation = useMemo(
    () => locations.find((location) => location.id === activeLocationId) ?? null,
    [activeLocationId, locations]
  );

  const selectedFiles = useMemo(() => Object.values(selectedByKey), [selectedByKey]);
  const hasLocations = locations.length > 0;

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

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load Microsoft 365 items.");
        }

        setItems(data.items);
        setCurrentFolder(data.currentFolder);
        setHistory(nextHistory ?? []);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load Microsoft 365 items.";
        setErrorText(message);
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

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load Microsoft 365 locations.");
      }

      const nextLocations = data.locations ?? [];
      setLocations(nextLocations);

      if (nextLocations.length === 0) {
        setActiveLocationId("");
        setItems([]);
        setCurrentFolder(null);
        setHistory([]);
        setErrorText(null);
        return;
      }

      const nextActiveLocationId =
        nextLocations.find((location) => location.id === activeLocationId)?.id ??
        nextLocations[0]?.id ??
        "";
      setActiveLocationId(nextActiveLocationId);
      await loadItems(nextActiveLocationId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load Microsoft 365 locations.";
      setErrorText(message);
    } finally {
      setIsLoadingLocations(false);
    }
  }, [activeLocationId, loadItems]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setErrorText(null);
    setCopiedResolverOutput(false);
    void loadLocations();
  }, [loadLocations, open]);

  const handleLocationSelect = useCallback(
    async (locationId: string) => {
      setActiveLocationId(locationId);
      await loadItems(locationId);
    },
    [loadItems]
  );

  const handleOpenFolder = useCallback(
    async (folder: Ms365BrowserItem) => {
      if (!currentFolder || !activeLocationId) {
        return;
      }

      await loadItems(activeLocationId, folder.id, [...history, currentFolder]);
    },
    [activeLocationId, currentFolder, history, loadItems]
  );

  const handleBack = useCallback(async () => {
    if (!activeLocationId || history.length === 0) {
      return;
    }

    const nextHistory = history.slice(0, -1);
    const targetFolder = history[history.length - 1];
    await loadItems(activeLocationId, targetFolder.id, nextHistory);
  }, [activeLocationId, history, loadItems]);

  const handleToggleFile = useCallback(
    (item: Ms365BrowserItem) => {
      if (!activeLocation) {
        return;
      }

      const key = `${activeLocation.id}:${item.id}`;
      setSelectedByKey((current) => {
        if (current[key]) {
          const next = { ...current };
          delete next[key];
          return next;
        }

        return {
          ...current,
          [key]: {
            ...item,
            locationId: activeLocation.id,
            locationLabel: activeLocation.label,
          },
        };
      });
    },
    [activeLocation]
  );

  const handleDeselectFile = useCallback((file: Ms365AttachmentSelection) => {
    setSelectedByKey((current) => {
      const key = `${file.locationId}:${file.id}`;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const handleAttach = useCallback(() => {
    if (selectedFiles.length === 0) {
      return;
    }

    onAttach(selectedFiles);
    setSelectedByKey({});
    setOpen(false);
  }, [onAttach, selectedFiles]);

  const handleResolveSharePointUrl = useCallback(async () => {
    const url = resolverUrl.trim();
    if (!url) {
      setResolverError("Paste a SharePoint or Teams Files URL first.");
      return;
    }

    setIsResolving(true);
    setResolverError(null);

    try {
      const response = await fetch("/api/ms365/resolve-sharepoint-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          label: resolverLabel.trim() || undefined,
          id: resolverId.trim() || undefined,
        }),
      });
      const data = (await response.json()) as ResolveResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to resolve SharePoint URL.");
      }

      setResolverSummary(data);
      setResolverOutput(data.suggestedJson);
      setCopiedResolverOutput(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve SharePoint URL.";
      setResolverError(message);
      setResolverSummary(null);
      setResolverOutput("");
    } finally {
      setIsResolving(false);
    }
  }, [resolverId, resolverLabel, resolverUrl]);

  const handleCopyResolverOutput = useCallback(async () => {
    if (!resolverOutput) {
      return;
    }

    try {
      await navigator.clipboard.writeText(resolverOutput);
      setCopiedResolverOutput(true);
      window.setTimeout(() => {
        setCopiedResolverOutput(false);
      }, 1500);
    } catch {
      setCopiedResolverOutput(false);
    }
  }, [resolverOutput]);

  const breadcrumb = useMemo(() => {
    if (!hasLocations) return null;
    const parts = [
      ...history.map((f) => f.name),
      currentFolder?.name ?? activeLocation?.rootName ?? "Root",
    ];
    return parts.join(" / ");
  }, [activeLocation?.rootName, currentFolder?.name, hasLocations, history]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="agent-btn rounded-none border-2 shadow-none"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Paperclip className="size-4" />
        Attach MS365
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="agent-dialog flex h-[min(88vh,56rem)] !w-[min(84rem,calc(100vw-2rem))] !max-w-none flex-col gap-0 overflow-hidden rounded-none border-2 border-(--border) bg-(--paper-2) p-0 shadow-[8px_8px_0_rgba(var(--shadow-ink),0.12)]"
          showCloseButton
        >
          {/* ── Header ────────────────────────────────────────── */}
          <DialogHeader className="shrink-0 border-b-2 border-(--border) px-5 py-4 pr-12 text-left">
            <div className="flex items-center gap-2.5">
              <Paperclip className="size-4 shrink-0 text-(--ink-soft)" />
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold uppercase tracking-[0.08em] text-foreground">
                  Attach from Microsoft 365
                </DialogTitle>
                <p className="text-sm text-(--ink-muted)">
                  Browse allowlisted SharePoint and OneDrive locations.
                </p>
              </div>
            </div>
          </DialogHeader>

          {/* ── Scrollable body ───────────────────────────────── */}
          <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block! [&>[data-slot=scroll-area-viewport]>div]:min-w-0 [&>[data-slot=scroll-area-viewport]>div]:w-full">

            {/* Allowlist Helper */}
            <Collapsible
              open={showResolver}
              onOpenChange={setShowResolver}
              className="border-b-2 border-(--border)"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-(--surface-hover)"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                      Allowlist Helper
                    </p>
                    <p className="text-sm text-(--ink-muted)">
                      Resolve a SharePoint URL to generate the env JSON entry.
                    </p>
                  </div>
                  <ChevronDown
                    className={`size-4 shrink-0 text-(--ink-soft) transition-transform duration-150 ${
                      showResolver ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-4 border-t-2 border-(--border) bg-(--surface)/50 px-5 py-5">
                  {/* URL */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                      SharePoint or Teams Files URL
                    </p>
                    <textarea
                      value={resolverUrl}
                      onChange={(e) => setResolverUrl(e.target.value)}
                      placeholder="Paste a SharePoint or Teams Files URL here…"
                      className="agent-field min-h-20 w-full resize-y border-2 px-3 py-2 text-sm outline-none [field-sizing:fixed]"
                    />
                  </div>

                  {/* Label + ID */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                        Label{" "}
                        <span className="ml-1 text-[10px] font-medium tracking-normal text-(--ink-muted)">
                          Optional
                        </span>
                      </p>
                      <input
                        value={resolverLabel}
                        onChange={(e) => setResolverLabel(e.target.value)}
                        placeholder="Agent Chronologies"
                        className="agent-field h-9 w-full border-2 px-3 text-sm outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                        ID{" "}
                        <span className="ml-1 text-[10px] font-medium tracking-normal text-(--ink-muted)">
                          Optional
                        </span>
                      </p>
                      <input
                        value={resolverId}
                        onChange={(e) => setResolverId(e.target.value)}
                        placeholder="agent-chronologies"
                        className="agent-field h-9 w-full border-2 px-3 text-sm outline-none"
                      />
                    </div>
                  </div>

                  {/* Resolve action row */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      className="agent-btn-primary rounded-none border-2 shadow-none"
                      onClick={() => void handleResolveSharePointUrl()}
                      disabled={isResolving}
                    >
                      {isResolving ? <Loader2 className="size-4 animate-spin" /> : null}
                      Resolve URL
                    </Button>
                    {resolverSummary ? (
                      <p className="min-w-0 flex-1 text-xs text-(--ink-soft)">
                        <span className="font-medium">
                          {resolverSummary.resolved.siteName ?? resolverSummary.parsed.sitePath}
                        </span>
                        {" · "}
                        {resolverSummary.resolved.driveName ?? resolverSummary.parsed.libraryName}
                        {" · "}
                        {resolverSummary.resolved.rootName}
                      </p>
                    ) : null}
                  </div>

                  {/* Resolver error */}
                  {resolverError ? (
                    <div className="border-2 border-(--danger) bg-(--danger-soft) px-3 py-2.5 text-sm text-(--danger)">
                      {resolverError}
                    </div>
                  ) : null}

                  {/* JSON output */}
                  {resolverOutput ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                          Env JSON
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="agent-btn rounded-none border-2 shadow-none"
                          onClick={() => void handleCopyResolverOutput()}
                        >
                          {copiedResolverOutput ? (
                            <Check className="size-4" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                          {copiedResolverOutput ? "Copied" : "Copy JSON"}
                        </Button>
                      </div>
                      <pre className="agent-field max-h-44 overflow-y-auto whitespace-pre-wrap break-all border-2 px-3 py-3 font-mono text-xs leading-5">
                        {resolverOutput}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* ── Location tab bar ──────────────────────────────── */}
            <div className="border-b-2 border-(--border)">
              <div className="flex items-center gap-3 px-4 py-3">
                <p className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                  Location
                </p>
                <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-px">
                  {isLoadingLocations ? (
                    <div className="flex items-center gap-2 text-sm text-(--ink-soft)">
                      <Loader2 className="size-4 animate-spin" />
                      Loading…
                    </div>
                  ) : locations.length === 0 ? (
                    <p className="text-sm text-(--ink-muted)">No locations configured.</p>
                  ) : (
                    locations.map((location) => (
                      <button
                        key={location.id}
                        type="button"
                        onClick={() => void handleLocationSelect(location.id)}
                        className={`shrink-0 border-2 border-(--border) px-3 py-1 text-sm font-medium transition-colors ${
                          location.id === activeLocationId
                            ? "bg-(--brand) text-(--brand-on)"
                            : "bg-(--surface-light) text-(--ink) hover:bg-(--brand-soft)"
                        }`}
                      >
                        {location.label}
                      </button>
                    ))
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 rounded-none"
                  onClick={() => void loadLocations()}
                  disabled={isLoadingLocations || isLoadingItems}
                  title="Refresh locations"
                >
                  <RefreshCw
                    className={`size-4 ${isLoadingLocations ? "animate-spin" : ""}`}
                  />
                  <span className="sr-only">Refresh locations</span>
                </Button>
              </div>
            </div>

            {/* ── File browser ──────────────────────────────────── */}
            <div>
              {/* Browser header */}
              <div className="flex items-center gap-2 border-b-2 border-(--border) px-3 py-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 rounded-none"
                  disabled={history.length === 0 || isLoadingItems}
                  onClick={() => void handleBack()}
                >
                  <ChevronLeft className="size-4" />
                  <span className="sr-only">Back</span>
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-(--ink)">
                    {activeLocation?.label ?? "Microsoft 365 Browser"}
                  </p>
                  {breadcrumb ? (
                    <p className="truncate text-xs text-(--ink-soft)">{breadcrumb}</p>
                  ) : !hasLocations ? (
                    <p className="truncate text-xs text-(--ink-muted)">
                      Configure a location above to browse files.
                    </p>
                  ) : null}
                </div>
                {selectedFiles.length > 0 ? (
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-none border-2 px-2 py-0.5 text-xs"
                  >
                    {selectedFiles.length} selected
                  </Badge>
                ) : null}
              </div>

              {/* Browser content */}
              <div className="p-3">
                {/* Error */}
                {hasLocations && errorText ? (
                  <div className="mb-2 border-2 border-(--danger) bg-(--danger-soft) px-3 py-2.5 text-sm text-(--danger)">
                    {errorText}
                  </div>
                ) : null}

                {/* Loading */}
                {isLoadingItems ? (
                  <div className="flex items-center justify-center gap-2 py-14 text-sm text-(--ink-soft)">
                    <Loader2 className="size-4 animate-spin" />
                    Loading files…
                  </div>
                ) : null}

                {/* No locations empty state */}
                {!hasLocations && !isLoadingLocations && !isLoadingItems ? (
                  <div className="flex min-h-40 flex-col items-center justify-center gap-2 border-2 border-dashed border-(--border) px-6 py-10 text-center">
                    <p className="text-sm font-semibold text-(--ink-soft)">
                      No locations configured
                    </p>
                    <p className="max-w-xs text-xs text-(--ink-muted)">
                      Use the Allowlist Helper above to resolve a SharePoint URL, then copy
                      the JSON into{" "}
                      <code className="font-mono">MS365_ALLOWED_LOCATIONS_JSON</code>.
                    </p>
                  </div>
                ) : null}

                {/* Empty folder */}
                {hasLocations && !isLoadingItems && !errorText && items.length === 0 ? (
                  <p className="py-14 text-center text-sm text-(--ink-muted)">
                    This folder is empty.
                  </p>
                ) : null}

                {/* Items list */}
                {hasLocations && !isLoadingItems && items.length > 0 ? (
                  <div className="space-y-1">
                    {items.map((item) => {
                      const key = `${activeLocation?.id ?? ""}:${item.id}`;
                      const isSelected = Boolean(selectedByKey[key]);

                      return (
                        <div
                          key={item.id}
                          className={`flex items-center gap-3 border-2 border-(--border) px-3 py-2.5 transition-colors ${
                            isSelected
                              ? "bg-(--brand-soft)"
                              : "bg-(--surface-light) hover:bg-(--surface-hover)"
                          }`}
                        >
                          {/* Icon + name (clickable) */}
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                            onClick={() =>
                              item.kind === "folder"
                                ? void handleOpenFolder(item)
                                : handleToggleFile(item)
                            }
                          >
                            {item.kind === "folder" ? (
                              <Folder className="size-4 shrink-0 text-(--ink-soft)" />
                            ) : (
                              <FileText className="size-4 shrink-0 text-(--ink-soft)" />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-(--ink)">
                                {item.name}
                              </p>
                              <p className="text-xs text-(--ink-muted)">{formatItemMeta(item)}</p>
                            </div>
                          </button>

                          {/* Action button */}
                          {item.kind === "file" ? (
                            <button
                              type="button"
                              onClick={() => handleToggleFile(item)}
                              className={`shrink-0 border-2 border-(--border) px-3 py-1 text-xs font-semibold transition-colors ${
                                isSelected
                                  ? "bg-(--brand) text-(--brand-on) hover:bg-(--brand-hover)"
                                  : "bg-(--surface-light) text-(--ink) hover:bg-(--brand-soft)"
                              }`}
                            >
                              {isSelected ? "Selected" : "Select"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleOpenFolder(item)}
                              className="shrink-0 border-2 border-(--border) bg-(--surface-light) px-3 py-1 text-xs font-semibold text-(--ink) transition-colors hover:bg-(--brand-soft)"
                            >
                              Open
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </ScrollArea>

          {/* ── Footer ────────────────────────────────────────── */}
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
                onClick={handleAttach}
              >
                <Paperclip className="size-4" />
                {selectedFiles.length > 0
                  ? `Attach ${selectedFiles.length} ${selectedFiles.length === 1 ? "File" : "Files"}`
                  : "Attach Files"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
