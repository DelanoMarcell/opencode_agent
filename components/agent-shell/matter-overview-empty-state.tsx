"use client";

type MatterOverviewEmptyStateProps = {
  code: string;
  title: string;
  description?: string;
  chatCount: number;
};

export function MatterOverviewEmptyState({
  code,
  title,
  description,
  chatCount,
}: MatterOverviewEmptyStateProps) {
  const bodyText =
    chatCount === 0
      ? "This matter does not have any chats yet. Send a message below to create the first chat in this folder."
      : "Choose a chat from this matter in the sidebar, or send a message below to start another chat in this folder.";

  return (
    <div className="agent-empty min-h-[320px] border-2 border-dashed px-6 py-6">
      <div className="max-w-2xl space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
            Matter Folder
          </p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">{code}</h2>
          <p className="mt-1 text-sm text-foreground">{title}</p>
          {description ? (
            <p className="mt-2 text-sm leading-relaxed text-(--ink-muted)">{description}</p>
          ) : null}
        </div>

        <div className="border-2 bg-(--surface-light) px-4 py-4">
          <p className="text-sm font-medium text-foreground">
            {chatCount === 0 ? "No chats in this matter yet." : "No chat selected."}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-(--ink-muted)">{bodyText}</p>
        </div>
      </div>
    </div>
  );
}
