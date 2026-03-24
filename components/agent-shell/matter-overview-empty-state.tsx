"use client";

import { Folder } from "lucide-react";

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
          <div className="inline-flex items-center gap-2">
            <Folder className="size-5 text-(--ink-soft)" />
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
            {code}
          </p>
          {description ? (
            <p className="mt-2 text-sm leading-relaxed text-(--ink-muted)">{description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
