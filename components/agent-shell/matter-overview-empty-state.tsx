"use client";

type MatterOverviewEmptyStateProps = {
  code: string;
  title: string;
  description?: string;
};

export function MatterOverviewEmptyState({
  code,
  title,
  description,
}: MatterOverviewEmptyStateProps) {
  return (
    <div className="agent-empty min-h-[320px] border-2 border-dashed px-6 py-6">
      <div className="max-w-2xl">
        <div>
          <h2 className="mt-2 text-lg font-semibold text-foreground">{code}</h2>
          <p className="mt-1 text-sm text-foreground">{title}</p>
          {description ? (
            <p className="mt-2 text-sm leading-relaxed text-(--ink-muted)">{description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
