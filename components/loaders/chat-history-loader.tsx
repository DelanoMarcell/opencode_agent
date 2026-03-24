export function ChatHistoryLoader() {
  return (
    <div className="agent-empty min-h-[320px] border-2 border-dashed p-6">
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
          Loading chat history...
        </p>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={`timeline-loader-${index}`} className="space-y-2">
            <div className="h-3 w-24 animate-pulse bg-(--paper-2)" />
            <div className="space-y-2 border-2 bg-(--surface-light) px-4 py-3">
              <div className="h-3 w-5/6 animate-pulse bg-(--paper-2)" />
              <div className="h-3 w-4/6 animate-pulse bg-(--paper-2)" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
