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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type CreateMatterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMatterCreated: (matterID: string) => void;
};

type CreateMatterResponse = {
  matter?: {
    id?: string;
  };
  error?: string;
};

export function CreateMatterDialog({
  open,
  onOpenChange,
  onMatterCreated,
}: CreateMatterDialogProps) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setCode("");
    setTitle("");
    setDescription("");
    setCodeError(null);
    setTitleError(null);
    setSubmitError(null);
    setIsSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open, resetForm]);

  const canSubmit = useMemo(
    () => !isSubmitting && code.trim().length > 0 && title.trim().length > 0,
    [code, isSubmitting, title]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

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

    if (hasError) {
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/matters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: trimmedCode,
          title: trimmedTitle,
          description: trimmedDescription || undefined,
        }),
      });

      const data = (await response.json().catch(() => null)) as CreateMatterResponse | null;
      if (!response.ok) {
        setSubmitError(data?.error ?? "Failed to create matter");
        return;
      }

      const matterID = data?.matter?.id;
      if (!matterID) {
        setSubmitError("Matter was created but no matter id was returned");
        return;
      }

      onOpenChange(false);
      onMatterCreated(matterID);
    } catch {
      setSubmitError("Failed to create matter");
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
            New Matter Folder
          </DialogTitle>
          <DialogDescription className="text-sm text-(--ink-muted)">
            Create a matter folder to group related chats in one workspace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="matter-code"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)"
            >
              Matter Code
            </Label>
            <Input
              id="matter-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                if (codeError) setCodeError(null);
              }}
              placeholder="LIT-2026-001"
              disabled={isSubmitting}
              aria-invalid={codeError ? true : undefined}
              className="h-10 rounded-none border-2 bg-background shadow-none"
            />
            {codeError ? <p className="text-xs text-red-700">{codeError}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="matter-title"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)"
            >
              Matter Name
            </Label>
            <Input
              id="matter-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError) setTitleError(null);
              }}
              placeholder="Dispute Between X and Y"
              disabled={isSubmitting}
              aria-invalid={titleError ? true : undefined}
              className="h-10 rounded-none border-2 bg-background shadow-none"
            />
            {titleError ? <p className="text-xs text-red-700">{titleError}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="matter-description"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)"
            >
              Description
              <span className="ml-2 text-[10px] font-medium tracking-[0.06em] text-(--ink-muted)">
                Optional
              </span>
            </Label>
            <Textarea
              id="matter-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Brief context for this matter folder"
              disabled={isSubmitting}
              className="min-h-24 rounded-none border-2 bg-background shadow-none"
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
                  Creating matter...
                </span>
              ) : (
                "Create Matter"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
