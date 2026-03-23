"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  Cloud,
  FileText,
  HardDriveUpload,
  Loader2,
  Paperclip,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Ms365AttachDialog } from "@/components/agent-shell/ms365-attach-dialog";
import type {
  StoredFileListItem,
  StoredFileSource,
  StoredFileSummary,
  StoredFileUploadResult,
} from "@/lib/files/types";
import type { Ms365AttachmentSelection } from "@/lib/ms365/types";

type FilesDialogScope = "session" | "matter";

type SessionFilesDialogProps = {
  canUploadFiles: boolean;
  isUploadingFiles: boolean;
  onAddFiles: (
    files: Array<File>
  ) => Promise<{
    files: Array<StoredFileListItem>;
    summary: StoredFileSummary;
    uploadResults: Array<StoredFileUploadResult>;
  } | null>;
  onAddMs365Files: (
    files: Array<Ms365AttachmentSelection>
  ) => Promise<{
    files: Array<StoredFileListItem>;
    summary: StoredFileSummary;
    uploadResults: Array<StoredFileUploadResult>;
  } | null>;
  open: boolean;
  scope: FilesDialogScope;
  resourceId?: string;
  onAttachFiles: (files: Array<StoredFileListItem>) => void;
  onOpenChange: (open: boolean) => void;
  onSummaryChange: (
    scope: FilesDialogScope,
    resourceId: string,
    summary: StoredFileSummary
  ) => void;
  refreshToken?: number;
};

type SessionFilesResponse = {
  files: Array<StoredFileListItem>;
  summary: StoredFileSummary;
  uploadResults?: Array<StoredFileUploadResult>;
  deletedFileIds?: string[];
  error?: string;
};

const PAGE_SIZE = 8;

type PendingUploadStatus = "uploading" | "failed";

type PendingUploadRow = {
  createdAt: string;
  fileId: string;
  mime?: string;
  originalName: string;
  size: number;
  source: StoredFileSource;
  status: PendingUploadStatus;
  uploadIndex: number;
};

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/zip": "ZIP",
  "application/x-zip-compressed": "ZIP",
  "application/x-msdownload": "EXE",
  "application/octet-stream": "Binary",
  "text/plain": "TXT",
  "text/csv": "CSV",
  "text/html": "HTML",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/gif": "GIF",
  "image/webp": "WEBP",
  "image/svg+xml": "SVG",
  "video/mp4": "MP4",
  "audio/mpeg": "MP3",
};

function formatMimeType(mime: string | null | undefined): string {
  if (!mime) return "Unknown";
  if (MIME_LABELS[mime]) return MIME_LABELS[mime];
  // Fallback: take the subtype after "/" and the last segment after "."
  const subtype = mime.split("/")[1] ?? mime;
  const parts = subtype.split(".");
  return (parts[parts.length - 1] ?? subtype).toUpperCase();
}

function formatFileSource(source: StoredFileSource): string {
  return source === "ms365" ? "Microsoft 365" : "Device";
}

function getScopeLabel(scope: FilesDialogScope) {
  return scope === "matter" ? "matter" : "session";
}

function getFilesDialogTitle(scope: FilesDialogScope) {
  return scope === "matter" ? "Files In This Matter" : "Files In This Session";
}

function getFilesDialogDescription(scope: FilesDialogScope, hasResource: boolean) {
  if (scope === "matter") {
    return hasResource
      ? "Manage files stored for this matter."
      : "Open a matter folder first to manage its files.";
  }

  return hasResource
    ? "Manage files stored for this session."
    : "Open a chat session first to manage its files.";
}

function buildFilesEndpoint(scope: FilesDialogScope, resourceId: string) {
  return scope === "matter"
    ? `/api/matters/${encodeURIComponent(resourceId)}/files`
    : `/api/opencode-sessions/${encodeURIComponent(resourceId)}/files`;
}

export function SessionFilesDialog({
  canUploadFiles,
  isUploadingFiles,
  onAddFiles,
  onAddMs365Files,
  open,
  scope,
  resourceId,
  onAttachFiles,
  onOpenChange,
  onSummaryChange,
  refreshToken = 0,
}: SessionFilesDialogProps) {
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const tableScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [isMs365DialogOpen, setIsMs365DialogOpen] = useState(false);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const [files, setFiles] = useState<Array<StoredFileListItem>>([]);
  const [pendingUploads, setPendingUploads] = useState<Array<PendingUploadRow>>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const shouldShowInitialLoadingState = isLoading && files.length === 0;
  const scopeLabel = getScopeLabel(scope);
  const filesEndpoint = resourceId ? buildFilesEndpoint(scope, resourceId) : null;

  const clearPendingUploadCleanupTimers = useCallback(() => {
    for (const timeoutId of pendingUploadCleanupTimersRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    pendingUploadCleanupTimersRef.current.clear();
  }, []);

  const schedulePendingUploadRemoval = useCallback((fileIds: Array<string>, delayMs: number) => {
    for (const fileId of fileIds) {
      const existingTimeoutId = pendingUploadCleanupTimersRef.current.get(fileId);
      if (existingTimeoutId) {
        window.clearTimeout(existingTimeoutId);
      }

      const timeoutId = window.setTimeout(() => {
        setPendingUploads((current) => current.filter((upload) => upload.fileId !== fileId));
        pendingUploadCleanupTimersRef.current.delete(fileId);
      }, delayMs);

      pendingUploadCleanupTimersRef.current.set(fileId, timeoutId);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    if (!resourceId || !filesEndpoint) {
      setFiles([]);
      setSelectedFileIds(new Set());
      setQuery("");
      setPage(1);
      return;
    }

    setIsLoading(true);
    setErrorText(null);

    try {
      const response = await fetch(filesEndpoint, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as SessionFilesResponse | null;

      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? `Failed to load ${scopeLabel} files`);
      }

      const nextFiles = payload.files ?? [];

      setFiles(nextFiles);
      setSelectedFileIds((current) => {
        const next = new Set<string>();
        const validFileIds = new Set(nextFiles.map((file) => file.fileId));
        for (const fileId of current) {
          if (validFileIds.has(fileId)) {
            next.add(fileId);
          }
        }
        return next;
      });
      onSummaryChange(scope, resourceId, payload.summary);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : `Failed to load ${scopeLabel} files`);
    } finally {
      setIsLoading(false);
    }
  }, [filesEndpoint, onSummaryChange, resourceId, scopeLabel]);

  useEffect(() => {
    if (!open) return;
    void loadFiles();
  }, [loadFiles, open, refreshToken]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPage(1);
      setSelectedFileIds(new Set());
      setIsBulkDeleteConfirmOpen(false);
      setIsUploadMenuOpen(false);
      setIsMs365DialogOpen(false);
      setPendingUploads([]);
      clearPendingUploadCleanupTimers();
    }
  }, [clearPendingUploadCleanupTimers, open]);

  useEffect(() => {
    return () => {
      clearPendingUploadCleanupTimers();
    };
  }, [clearPendingUploadCleanupTimers]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const filteredFiles = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return files;
    }

    return files.filter((file) => {
      return (
        file.originalName.toLowerCase().includes(trimmed) ||
        (file.mime ?? "").toLowerCase().includes(trimmed)
      );
    });
  }, [files, query]);

  const filteredPendingUploads = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return pendingUploads;
    }

    return pendingUploads.filter((upload) => {
      return (
        upload.originalName.toLowerCase().includes(trimmed) ||
        (upload.mime ?? "").toLowerCase().includes(trimmed)
      );
    });
  }, [pendingUploads, query]);

  const tableRows = useMemo(
    () => [
      ...filteredPendingUploads.map((upload) => ({ kind: "pending" as const, upload })),
      ...filteredFiles.map((file) => ({ kind: "stored" as const, file })),
    ],
    [filteredFiles, filteredPendingUploads]
  );

  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = tableRows.slice(pageStart, pageStart + PAGE_SIZE);
  const pageStoredFiles = pageRows
    .filter((row): row is { kind: "stored"; file: StoredFileListItem } => row.kind === "stored")
    .map((row) => row.file);
  const pageFileIds = pageStoredFiles.map((file) => file.fileId);
  const allPageSelected =
    pageFileIds.length > 0 && pageFileIds.every((fileId) => selectedFileIds.has(fileId));
  const hasSelectedFiles = selectedFileIds.size > 0;
  const selectedOnCurrentPage = pageFileIds.filter((fileId) => selectedFileIds.has(fileId)).length;
  const uploadingCount = pendingUploads.filter((upload) => upload.status === "uploading").length;
  const selectedStoredFiles = useMemo(
    () => files.filter((file) => selectedFileIds.has(file.fileId)),
    [files, selectedFileIds]
  );

  useEffect(() => {
    const root = tableScrollAreaRef.current;
    if (!root) return;

    const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;

    viewport.scrollTo({ top: 0, behavior: "auto" });
  }, [currentPage]);

  const toggleFileSelection = useCallback((fileId: string, checked: boolean) => {
    setSelectedFileIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(fileId);
      } else {
        next.delete(fileId);
      }
      return next;
    });
  }, []);

  const toggleAllOnPage = useCallback((checked: boolean) => {
    setSelectedFileIds((current) => {
      const next = new Set(current);
      for (const fileId of pageFileIds) {
        if (checked) {
          next.add(fileId);
        } else {
          next.delete(fileId);
        }
      }
      return next;
    });
  }, [pageFileIds]);

  const handleDeleteSelected = useCallback(async () => {
    if (!filesEndpoint || !resourceId || selectedFileIds.size === 0) {
      return;
    }

    setIsDeletingSelected(true);
    setErrorText(null);

    try {
      const response = await fetch(filesEndpoint, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileIds: Array.from(selectedFileIds),
        }),
      });
      const payload = (await response.json().catch(() => null)) as SessionFilesResponse | null;

      if (!response.ok || !payload?.summary) {
        throw new Error(payload?.error ?? `Failed to delete selected ${scopeLabel} files`);
      }

      const deletedIds = new Set(payload.deletedFileIds ?? []);
      setFiles(payload.files ?? []);
      setSelectedFileIds((current) => {
        const next = new Set(current);
        for (const fileId of deletedIds) {
          next.delete(fileId);
        }
        return next;
      });
      onSummaryChange(scope, resourceId, payload.summary);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : `Failed to delete selected ${scopeLabel} files`);
    } finally {
      setIsDeletingSelected(false);
      setIsBulkDeleteConfirmOpen(false);
    }
  }, [filesEndpoint, onSummaryChange, resourceId, scopeLabel, selectedFileIds]);

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      if (!filesEndpoint || !resourceId) return;

      setDeletingFileId(fileId);
      setErrorText(null);

      try {
        const response = await fetch(`${filesEndpoint}/${encodeURIComponent(fileId)}`, {
          method: "DELETE",
        });
        const payload = (await response.json().catch(() => null)) as
          | { summary?: StoredFileSummary; error?: string }
          | null;

        if (!response.ok || !payload?.summary) {
          throw new Error(payload?.error ?? `Failed to delete ${scopeLabel} file`);
        }

        setFiles((current) => current.filter((file) => file.fileId !== fileId));
        setSelectedFileIds((current) => {
          const next = new Set(current);
          next.delete(fileId);
          return next;
        });
        onSummaryChange(scope, resourceId, payload.summary);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : `Failed to delete ${scopeLabel} file`);
      } finally {
        setDeletingFileId(null);
      }
    },
    [filesEndpoint, onSummaryChange, resourceId, scopeLabel]
  );

  function handleOpenLocalFilePicker() {
    if (!canUploadFiles || isUploadingFiles || !resourceId) {
      return;
    }

    localFileInputRef.current?.click();
  }

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setIsUploadMenuOpen(false);
        setIsMs365DialogOpen(false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const handleAttachFiles = useCallback(() => {
    if (selectedStoredFiles.length === 0) {
      return;
    }

    onAttachFiles(selectedStoredFiles);
    handleDialogOpenChange(false);
  }, [handleDialogOpenChange, onAttachFiles, selectedStoredFiles]);

  const processChosenFiles = useCallback(async (nextFiles: Array<File>) => {
    if (nextFiles.length > 0) {
      const createdAt = new Date().toISOString();
      const optimisticUploads = nextFiles.map((file, uploadIndex) => ({
        createdAt,
        fileId: `pending_${crypto.randomUUID()}`,
        mime: file.type || undefined,
        originalName: file.name,
        size: file.size,
        source: "device" as const,
        status: "uploading" as const,
        uploadIndex,
      }));

      setPendingUploads((current) => [...optimisticUploads, ...current]);
      const uploadResult = await onAddFiles(nextFiles);

      if (uploadResult && resourceId) {
        setFiles(uploadResult.files);
        setSelectedFileIds((current) => {
          const next = new Set<string>();
          const validFileIds = new Set(uploadResult.files.map((file) => file.fileId));
          for (const fileId of current) {
            if (validFileIds.has(fileId)) {
              next.add(fileId);
            }
          }
          return next;
        });
        onSummaryChange(scope, resourceId, uploadResult.summary);
        const uploadResultByIndex = new Map(uploadResult.uploadResults.map((result) => [result.index, result]));
        const optimisticUploadIds = optimisticUploads.map((upload) => upload.fileId);
        const failedUploadIds = optimisticUploads
          .filter((upload) => !uploadResultByIndex.has(upload.uploadIndex))
          .map((upload) => upload.fileId);
        const failedUploadIdSet = new Set(failedUploadIds);

        setPendingUploads((current) =>
          current.flatMap((upload) => {
            if (!optimisticUploadIds.includes(upload.fileId)) {
              return [upload];
            }

            if (failedUploadIdSet.has(upload.fileId)) {
              return [{
                ...upload,
                status: "failed",
              }];
            }

            return [];
          })
        );
        if (failedUploadIds.length > 0) {
          schedulePendingUploadRemoval(failedUploadIds, 3200);
        }
      } else {
        const optimisticUploadIds = optimisticUploads.map((upload) => upload.fileId);

        setPendingUploads((current) =>
          current.map((upload) =>
            optimisticUploadIds.includes(upload.fileId)
              ? {
                  ...upload,
                  status: "failed",
                }
              : upload
          )
        );
        schedulePendingUploadRemoval(optimisticUploadIds, 3200);
      }
    }
  }, [onAddFiles, onSummaryChange, resourceId, schedulePendingUploadRemoval]);

  async function handleLocalFilesChosen(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const nextFiles = Array.from(input.files ?? []);
    await processChosenFiles(nextFiles);
    input.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="agent-dialog flex h-[min(85vh,48rem)] !w-[min(56rem,calc(100vw-2rem))] !max-w-none flex-col gap-0 overflow-hidden rounded-none border-2 border-(--border) bg-(--paper-2) p-0 shadow-[8px_8px_0_rgba(var(--shadow-ink),0.12)]">
        <input
          ref={localFileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleLocalFilesChosen}
        />
        <Ms365AttachDialog
          disabled={!resourceId}
          isUploading={isUploadingFiles}
          open={isMs365DialogOpen}
          onOpenChange={setIsMs365DialogOpen}
          onUploadFiles={async (selectedFiles) => {
            if (selectedFiles.length === 0) {
              return false;
            }

            const createdAt = new Date().toISOString();
            const optimisticUploads = selectedFiles.map((file, uploadIndex) => ({
              createdAt,
              fileId: `pending_${crypto.randomUUID()}`,
              mime: undefined,
              originalName: file.name,
              size: file.size ?? 0,
              source: "ms365" as const,
              status: "uploading" as const,
              uploadIndex,
            }));

            setPendingUploads((current) => [...optimisticUploads, ...current]);
            const uploadResult = await onAddMs365Files(selectedFiles);

            if (uploadResult && resourceId) {
              setFiles(uploadResult.files);
              setSelectedFileIds((current) => {
                const next = new Set<string>();
                const validFileIds = new Set(uploadResult.files.map((file) => file.fileId));
                for (const fileId of current) {
                  if (validFileIds.has(fileId)) {
                    next.add(fileId);
                  }
                }
                return next;
              });
              onSummaryChange(scope, resourceId, uploadResult.summary);
              const uploadResultByIndex = new Map(
                uploadResult.uploadResults.map((result) => [result.index, result])
              );
              const optimisticUploadIds = optimisticUploads.map((upload) => upload.fileId);
              const failedUploadIds = optimisticUploads
                .filter((upload) => !uploadResultByIndex.has(upload.uploadIndex))
                .map((upload) => upload.fileId);
              const failedUploadIdSet = new Set(failedUploadIds);

              setPendingUploads((current) =>
                current.flatMap((upload) => {
                  if (!optimisticUploadIds.includes(upload.fileId)) {
                    return [upload];
                  }

                  if (failedUploadIdSet.has(upload.fileId)) {
                    return [
                      {
                        ...upload,
                        status: "failed",
                      },
                    ];
                  }

                  return [];
                })
              );
              if (failedUploadIds.length > 0) {
                schedulePendingUploadRemoval(failedUploadIds, 3200);
              }
              return true;
            }

            const optimisticUploadIds = optimisticUploads.map((upload) => upload.fileId);
            setPendingUploads((current) =>
              current.map((upload) =>
                optimisticUploadIds.includes(upload.fileId)
                  ? {
                      ...upload,
                      status: "failed",
                    }
                  : upload
              )
            );
            schedulePendingUploadRemoval(optimisticUploadIds, 3200);
            return false;
          }}
          showTrigger={false}
        />

        {/* Header */}
        <DialogHeader className="shrink-0 border-b-2 border-(--border) px-5 py-4 text-left">
          <DialogTitle className="text-base uppercase tracking-[0.08em]">
            {getFilesDialogTitle(scope)}
          </DialogTitle>
          <DialogDescription className="text-sm text-(--ink-soft)">
            {getFilesDialogDescription(scope, Boolean(resourceId))}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 px-5 py-4">
          <div className="flex h-full min-h-0 flex-col gap-4">
            {errorText ? (
              <div className="border-2 border-(--danger) bg-(--danger-soft) px-3 py-2 text-sm text-(--danger)">
                {errorText}
              </div>
            ) : null}

            {resourceId ? (
              <div className="flex items-center justify-between gap-4 text-xs text-(--ink-soft)">
                <p>{files.length} file{files.length === 1 ? "" : "s"} stored</p>
                <div className="flex items-center gap-3">
                  {uploadingCount > 0 ? (
                    <p className="inline-flex items-center gap-1 text-(--brand-strong)">
                      <Loader2 className="size-3.5 animate-spin" />
                      Uploading {uploadingCount} file{uploadingCount === 1 ? "" : "s"}
                    </p>
                  ) : null}
                  <p>{selectedFileIds.size} selected</p>
                </div>
              </div>
            ) : null}

            {!resourceId ? (
              <div className="flex flex-1 items-center justify-center border-2 border-dashed border-(--border) px-4 py-10 text-center text-sm text-(--ink-soft)">
                {scope === "matter"
                  ? "Open a matter folder first, then upload files into that matter."
                  : "Start or open a chat first, then upload files into that session."}
              </div>
            ) : shouldShowInitialLoadingState ? (
              <div className="flex flex-1 items-center justify-center gap-2 py-14 text-sm text-(--ink-soft)">
                <Loader2 className="size-4 animate-spin" />
                {`Loading ${scopeLabel} files...`}
              </div>
            ) : files.length === 0 && pendingUploads.length === 0 ? (
              <div className="flex flex-1 items-center justify-center border-2 border-dashed border-(--border) px-4 py-10 text-center text-sm text-(--ink-soft)">
                {`No files have been uploaded into this ${scopeLabel} yet.`}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-(--ink-soft)" />
                    <input
                      ref={searchInputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={`Search files in this ${scopeLabel}`}
                      className="app-field h-10 w-full border-2 pl-9 pr-10 text-sm outline-none"
                    />
                    {query ? (
                      <button
                        type="button"
                        aria-label="Clear search"
                        className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center text-(--ink-soft) transition-colors hover:text-foreground"
                        onClick={() => {
                          setQuery("");
                          searchInputRef.current?.focus();
                        }}
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="agent-btn w-full shrink-0 whitespace-nowrap rounded-none border-2 shadow-none sm:w-auto"
                    disabled={!hasSelectedFiles || isDeletingSelected || isLoading}
                    onClick={() => setIsBulkDeleteConfirmOpen(true)}
                  >
                    {isDeletingSelected ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Delete selected
                    {hasSelectedFiles ? ` (${selectedFileIds.size})` : ""}
                  </Button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col border-2 border-(--border) bg-(--surface-light)">
                  <div className="flex items-center border-b-2 border-(--border) text-xs font-semibold text-(--ink-soft)">
                    <div className="w-12 shrink-0 px-4 py-3">
                      <Checkbox
                        checked={allPageSelected}
                        onCheckedChange={(checked) => toggleAllOnPage(Boolean(checked))}
                        aria-label="Select all files on this page"
                      />
                    </div>
                    <div className="min-w-0 flex-1 px-2 py-3">Name</div>
                    <div className="hidden w-28 shrink-0 px-2 py-3 sm:block">Source</div>
                    <div className="hidden w-14 shrink-0 px-2 py-3 sm:block">Type</div>
                    <div className="hidden w-16 shrink-0 px-2 py-3 sm:block">Size</div>
                    <div className="hidden w-24 shrink-0 px-2 py-3 sm:block">Added</div>
                    <div className="flex w-14 shrink-0 items-center justify-center px-2 py-3">Action</div>
                  </div>

                  <ScrollArea
                    ref={tableScrollAreaRef}
                    className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block! [&>[data-slot=scroll-area-viewport]>div]:min-w-0 [&>[data-slot=scroll-area-viewport]>div]:w-full"
                  >
                    <div>
                      {pageRows.length > 0 ? (
                        pageRows.map((row) => {
                      if (row.kind === "pending") {
                        const upload = row.upload;
                        const isUploading = upload.status === "uploading";
                        const isFailed = upload.status === "failed";
                        const statusIconClassName = isFailed ? "text-red-700" : "text-(--brand-strong)";
                        const statusTitle = isUploading
                          ? "Uploading"
                          : "Upload failed";

                        return (
                          <div
                            key={upload.fileId}
                            className="flex items-center border-b border-(--border)/20 bg-(--brand-soft)/25 last:border-b-0"
                          >
                            <div className="flex w-12 shrink-0 items-center justify-center px-4 py-3">
                              {isUploading ? (
                                <Loader2
                                  className="size-4 animate-spin text-(--brand-strong)"
                                  aria-label={statusTitle}
                                />
                              ) : (
                                <AlertCircle
                                  className={`size-4 ${statusIconClassName}`}
                                  aria-label={statusTitle}
                                />
                              )}
                            </div>
                            <div className="min-w-0 flex-1 px-2 py-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <FileText className="size-4 shrink-0 text-(--ink-soft)" />
                                <span className="truncate text-sm font-medium text-foreground" title={upload.originalName}>
                                  {upload.originalName}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-(--ink-muted) sm:hidden">
                                {formatFileSource(upload.source)} · {formatMimeType(upload.mime)} · {formatBytes(upload.size)}
                              </p>
                            </div>
                            <div className="hidden w-28 shrink-0 px-2 py-3 text-sm text-(--ink-soft) sm:block">
                              {formatFileSource(upload.source)}
                            </div>
                            <div className="hidden w-14 shrink-0 px-2 py-3 text-sm text-(--ink-soft) sm:block" title={upload.mime ?? undefined}>
                              {formatMimeType(upload.mime)}
                            </div>
                            <div className="hidden w-16 shrink-0 px-2 py-3 text-sm text-(--ink-soft) sm:block">
                              {formatBytes(upload.size)}
                            </div>
                            <div className="hidden w-24 shrink-0 px-2 py-3 text-sm text-(--ink-soft) sm:block">
                              {new Date(upload.createdAt).toLocaleDateString()}
                            </div>
                            <div className="w-14 shrink-0 px-2 py-3" />
                          </div>
                        );
                      }

                      const file = row.file;
                      const isDeleting = deletingFileId === file.fileId;
                      const isSelected = selectedFileIds.has(file.fileId);

                        return (
                          <div
                            key={file.fileId}
                            className={`flex cursor-pointer items-center border-b border-(--border)/20 transition-colors last:border-b-0 ${isSelected ? "bg-(--brand-soft)" : "hover:bg-(--surface-hover)"}`}
                            onClick={() => toggleFileSelection(file.fileId, !isSelected)}
                          >
                            <div className="w-12 shrink-0 px-4 py-3">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) => toggleFileSelection(file.fileId, Boolean(checked))}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Select ${file.originalName}`}
                              />
                            </div>
                            <div className="min-w-0 flex-1 px-2 py-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <FileText className="size-4 shrink-0 text-(--ink-soft)" />
                                <span className="truncate text-sm font-medium text-foreground" title={file.originalName}>
                                  {file.originalName}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-(--ink-muted) sm:hidden">
                                {formatFileSource(file.source)} · {formatMimeType(file.mime)} · {formatBytes(file.size)} · {new Date(file.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="hidden w-28 shrink-0 px-2 py-3 text-sm text-(--ink-soft) sm:block">
                              {formatFileSource(file.source)}
                            </div>
                            <div className="hidden w-14 shrink-0 px-2 py-3 text-sm text-(--ink-soft) sm:block" title={file.mime ?? undefined}>
                              {formatMimeType(file.mime)}
                            </div>
                            <div className="hidden w-16 shrink-0 px-2 py-3 text-sm text-(--ink-soft) sm:block">
                              {formatBytes(file.size)}
                            </div>
                            <div className="hidden w-24 shrink-0 px-2 py-3 text-sm text-(--ink-soft) sm:block">
                              {new Date(file.createdAt).toLocaleDateString()}
                            </div>
                            <div
                              className="flex w-14 shrink-0 items-center justify-center px-2 py-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-red-700 hover:bg-red-50 hover:text-red-800"
                                disabled={isDeleting || isDeletingSelected}
                                aria-label={`Delete ${file.originalName}`}
                                title={`Delete ${file.originalName}`}
                                onClick={() => void handleDeleteFile(file.fileId)}
                              >
                                {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-4 py-8 text-center text-sm text-(--ink-soft)">
                        {query.trim()
                          ? "No files match your search."
                          : `No files have been uploaded into this ${scopeLabel} yet.`}
                      </div>
                    )}
                    </div>
                  </ScrollArea>
                </div>

                {tableRows.length > PAGE_SIZE ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-(--ink-soft)">
                      Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, tableRows.length)} of{" "}
                      {tableRows.length}
                      {selectedOnCurrentPage > 0 ? ` · ${selectedOnCurrentPage} selected on this page` : ""}
                    </p>
                    <Pagination className="mx-0 w-auto justify-end">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            href="#"
                            onClick={(event) => {
                              event.preventDefault();
                              setPage((currentValue) => Math.max(1, currentValue - 1));
                            }}
                            className={currentPage <= 1 ? "pointer-events-none opacity-50" : ""}
                          />
                        </PaginationItem>
                        <PaginationItem>
                          <span className="px-3 text-xs text-(--ink-soft)">
                            Page {currentPage} of {totalPages}
                          </span>
                        </PaginationItem>
                        <PaginationItem>
                          <PaginationNext
                            href="#"
                            onClick={(event) => {
                              event.preventDefault();
                              setPage((currentValue) => Math.min(totalPages, currentValue + 1));
                            }}
                            className={currentPage >= totalPages ? "pointer-events-none opacity-50" : ""}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t-2 border-(--border) bg-(--paper-3) px-5 py-3">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="agent-btn rounded-none border-2 shadow-none"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="outline"
              className="agent-btn rounded-none border-2 shadow-none"
              disabled={!hasSelectedFiles}
              onClick={handleAttachFiles}
            >
              <Paperclip className="size-4" />
              {hasSelectedFiles
                ? `Attach${selectedFileIds.size > 0 ? ` (${selectedFileIds.size})` : ""}`
                : "Attach"}
            </Button>
            <DropdownMenu open={isUploadMenuOpen} onOpenChange={setIsUploadMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="agent-btn rounded-none border-2 shadow-none"
                  disabled={!canUploadFiles || !resourceId}
                >
                  {isUploadingFiles ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {isUploadingFiles ? "Adding files..." : "Upload files"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="agent-menu w-56 rounded-none border-2 shadow-[6px_6px_0_rgba(var(--shadow-ink),0.12)]"
              >
                <DropdownMenuItem
                  className="agent-menu-item rounded-none py-2"
                  disabled={isUploadingFiles}
                  onSelect={(event) => {
                    event.preventDefault();
                    setIsUploadMenuOpen(false);
                    window.setTimeout(() => {
                      handleOpenLocalFilePicker();
                    }, 0);
                  }}
                >
                  <HardDriveUpload className="size-4" />
                  {isUploadingFiles ? "Uploading…" : "From your device"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="agent-menu-item rounded-none py-2"
                  onSelect={(event) => {
                    event.preventDefault();
                    setIsUploadMenuOpen(false);
                    setIsMs365DialogOpen(true);
                  }}
                >
                  <Cloud className="size-4" />
                  From Microsoft 365
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
        <AlertDialogContent className="rounded-none border-2 shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base uppercase tracking-[0.08em]">
              Delete selected files?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Delete {selectedFileIds.size} selected file{selectedFileIds.size === 1 ? "" : "s"} from
              {` this ${scopeLabel}. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="agent-btn rounded-none border-2 shadow-none"
              disabled={isDeletingSelected}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="agent-btn-primary rounded-none border-2 shadow-none"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteSelected();
              }}
              disabled={isDeletingSelected}
            >
              {isDeletingSelected ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
