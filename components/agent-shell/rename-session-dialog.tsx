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

export type EditableSession = {
  sessionRecordId: string;
  rawSessionId: string;
  title: string;
};

type RenameSessionDialogProps = {
  open: boolean;
  session: EditableSession | null;
  onOpenChange: (open: boolean) => void;
  onSessionRenamed: (session: EditableSession) => void;
};

type UpdateSessionResponse = {
  sessionRecord?: {
    id?: string;
    rawSessionId?: string;
    title?: string;
  };
  error?: string;
};

export function RenameSessionDialog({
  open,
  session,
  onOpenChange,
  onSessionRenamed,
}: RenameSessionDialogProps) {
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetState = useCallback(() => {
    setTitleError(null);
    setSubmitError(null);
    setIsSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open || !session) {
      resetState();
      return;
    }

    setTitle(session.title);
    resetState();
  }, [open, resetState, session]);

  const canSubmit = useMemo(
    () => !isSubmitting && Boolean(session) && title.trim().length > 0,
    [isSubmitting, session, title]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError("Chat name is required");
      return;
    }

    setTitleError(null);
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/opencode-sessions/${session.rawSessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: trimmedTitle,
        }),
      });

      const data = (await response.json().catch(() => null)) as UpdateSessionResponse | null;
      if (!response.ok) {
        setSubmitError(data?.error ?? "Failed to rename chat");
        return;
      }

      const updatedSession = data?.sessionRecord;
      if (!updatedSession?.id || !updatedSession?.rawSessionId || !updatedSession?.title) {
        setSubmitError("Chat was renamed but no complete session payload was returned");
        return;
      }

      onSessionRenamed({
        sessionRecordId: updatedSession.id,
        rawSessionId: updatedSession.rawSessionId,
        title: updatedSession.title,
      });
      onOpenChange(false);
    } catch {
      setSubmitError("Failed to rename chat");
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
        className="rounded-none border-2 border-(--border) bg-(--paper-2) p-0 shadow-[8px_8px_0_rgba(var(--shadow-ink),0.12)] sm:max-w-lg"
      >
        <DialogHeader className="border-b-2 border-(--border) px-5 py-4 text-left">
          <DialogTitle className="text-base font-semibold uppercase tracking-[0.08em] text-foreground">
            Rename Chat
          </DialogTitle>
          <DialogDescription className="text-sm text-(--ink-muted)">
            Update the name shown in the sidebar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="rename-session-title"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)"
            >
              Chat Name
            </Label>
            <input
              id="rename-session-title"
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError) setTitleError(null);
                if (submitError) setSubmitError(null);
              }}
              placeholder="New chat"
              disabled={isSubmitting}
              aria-invalid={titleError ? true : undefined}
              className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
            />
            {titleError ? <p className="text-xs text-red-700">{titleError}</p> : null}
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
                  Saving...
                </span>
              ) : (
                "Save name"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
