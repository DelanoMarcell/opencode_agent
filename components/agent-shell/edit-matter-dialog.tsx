"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Spinner } from "@/components/loaders/spinner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export type EditableMatter = {
  id: string;
  code: string;
  title: string;
  description?: string;
};

type EditMatterDialogProps = {
  matter: EditableMatter | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMatterUpdated: (matter: EditableMatter) => void;
};

type UpdateMatterResponse = {
  matter?: {
    id?: string;
    code?: string;
    title?: string;
    description?: string;
  };
  error?: string;
};

export function EditMatterDialog({
  matter,
  open,
  onOpenChange,
  onMatterUpdated,
}: EditMatterDialogProps) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetErrors = useCallback(() => {
    setCodeError(null);
    setTitleError(null);
    setSubmitError(null);
    setIsSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open || !matter) {
      resetErrors();
      return;
    }

    setCode(matter.code);
    setTitle(matter.title);
    setDescription(matter.description ?? "");
    resetErrors();
  }, [matter, open, resetErrors]);

  const canSubmit = useMemo(
    () => !isSubmitting && Boolean(matter) && code.trim().length > 0 && title.trim().length > 0,
    [code, isSubmitting, matter, title]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matter) return;

    const trimmedCode = code.trim();
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    let hasError = false;

    if (!trimmedCode) {
      setCodeError("Matter code is required");
      hasError = true;
    } else {
      setCodeError(null);
    }

    if (!trimmedTitle) {
      setTitleError("Matter name is required");
      hasError = true;
    } else {
      setTitleError(null);
    }

    if (hasError) return;

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/matters/${matter.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: trimmedCode,
          title: trimmedTitle,
          description: trimmedDescription || undefined,
        }),
      });

      const data = (await response.json().catch(() => null)) as UpdateMatterResponse | null;
      if (!response.ok) {
        setSubmitError(data?.error ?? "Failed to update matter");
        return;
      }

      const updatedMatter = data?.matter;
      if (!updatedMatter?.id || !updatedMatter.code || !updatedMatter.title) {
        setSubmitError("Matter was updated but no complete matter payload was returned");
        return;
      }

      onOpenChange(false);
      onMatterUpdated({
        id: updatedMatter.id,
        code: updatedMatter.code,
        title: updatedMatter.title,
        description: updatedMatter.description ?? undefined,
      });
    } catch {
      setSubmitError("Failed to update matter");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isSubmitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={!isSubmitting}
        className="rounded-none border-2 border-(--border) bg-(--paper-2) p-0 shadow-[8px_8px_0_rgba(var(--shadow-ink),0.12)] sm:max-w-xl"
      >
        <DialogHeader className="border-b-2 border-(--border) px-5 py-4 text-left">
          <DialogTitle className="text-base font-semibold uppercase tracking-[0.08em] text-foreground">
            Edit Matter Folder
          </DialogTitle>
          <DialogDescription className="text-sm text-(--ink-muted)">
            Update matter metadata for this folder.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="edit-matter-code"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)"
            >
              Matter Code
            </Label>
            <input
              id="edit-matter-code"
              type="text"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                if (codeError) setCodeError(null);
              }}
              placeholder="MATTER12045"
              disabled={isSubmitting}
              aria-invalid={codeError ? true : undefined}
              className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
            />
            {codeError ? <p className="text-xs text-red-700">{codeError}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="edit-matter-title"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)"
            >
              Matter Name
            </Label>
            <input
              id="edit-matter-title"
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError) setTitleError(null);
              }}
              placeholder="Dispute Between X and Y"
              disabled={isSubmitting}
              aria-invalid={titleError ? true : undefined}
              className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
            />
            {titleError ? <p className="text-xs text-red-700">{titleError}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="edit-matter-description"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)"
            >
              Description
              <span className="ml-2 text-[10px] font-medium tracking-[0.06em] text-(--ink-muted)">
                Optional
              </span>
            </Label>
            <textarea
              id="edit-matter-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Brief context for this matter folder"
              disabled={isSubmitting}
              className="app-field min-h-24 w-full border-2 px-3 py-2 text-sm outline-none"
            />
          </div>

          {submitError ? (
            <p className="border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {submitError}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t-2 border-(--border) pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
              className="agent-btn rounded-none border-2 shadow-none"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="agent-btn-primary rounded-none border-2 shadow-none"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner size="sm" className="text-(--brand-on)" />
                  Saving changes...
                </span>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

