import { Spinner } from "@/components/loaders/spinner";

export function AgentComposerLoader() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-(--ink-soft)">
        <Spinner size="sm" className="text-(--ink-soft)" />
        <span>Loading session metadata...</span>
      </div>
      <div className="space-y-1.5">
        <div className="h-3 w-48 animate-pulse bg-(--paper-2)" />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="h-3 w-32 animate-pulse bg-(--paper-2)" />
          <span aria-hidden="true" className="text-(--ink-muted)">
            ·
          </span>
          <div className="h-3 w-24 animate-pulse bg-(--paper-2)" />
        </div>
      </div>
    </div>
  );
}
