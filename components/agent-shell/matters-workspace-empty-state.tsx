"use client";

export function MattersWorkspaceEmptyState() {
  return (
    <div className="agent-empty min-h-[320px] border-2 border-dashed px-6 py-6">
      <div className="max-w-2xl space-y-4">
        <div>
         
          <h2 className="mt-2 text-lg font-semibold text-foreground">Select a matter folder</h2>
          <p className="mt-2 text-sm leading-relaxed text-(--ink-muted)">
            Choose a matter from the left to view its chats, or create a new matter folder to start organising related conversations.
          </p>
        </div>
      </div>
    </div>
  );
}
