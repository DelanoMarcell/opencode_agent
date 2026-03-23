import type React from "react";

/**
 * AgentPageSkeleton
 *
 * A full-page skeleton that mirrors the exact structure of the agent layout:
 * sidebar + main panel (session header, timeline, composer).
 *
 * Use this as a loading state so the page appears structurally stable while
 * data loads, instead of the screen going blank or flashing a spinner.
 */

function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-(--paper-3) ${className ?? ""}`}
      style={style}
    />
  );
}

export function AgentPageSkeleton() {
  return (
    <main
      className="agent-page h-dvh overflow-hidden p-3 text-foreground sm:p-4"
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      <div className="agent-layout grid h-full gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">

        {/* ── Sidebar — desktop only ──────────────────────────────── */}
        <aside className="agent-panel hidden h-full w-[320px] min-h-0 flex-col overflow-hidden border-2 lg:flex">

          {/* Workspace header */}
          <div className="border-b-2 border-(--border) bg-(--paper-2) px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <Bone className="h-2.5 w-20" />
              <Bone className="h-9 w-[4.5rem]" />
            </div>
          </div>

          {/* Scrollable chat list */}
          <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
            <div className="space-y-5">
              {/* Section: Recent chats */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1 py-0.5">
                  <Bone className="h-2 w-24" />
                  <Bone className="h-2 w-16" />
                </div>
                {/* Active item */}
                <div className="flex items-center gap-3 border-2 border-(--border) bg-(--brand-soft)/30 px-3 py-2.5 shadow-[4px_4px_0_rgba(var(--shadow-ink),0.08)]">
                  <Bone className="size-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Bone className="h-3 w-4/5" />
                    <Bone className="h-2 w-1/2" />
                  </div>
                </div>
                {/* Regular items */}
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 border-2 border-transparent px-3 py-2.5"
                  >
                    <Bone className="size-4 shrink-0 opacity-60" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Bone className="h-3" style={{ width: `${65 + (i % 3) * 12}%` }} />
                      <Bone className="h-2 w-2/5 opacity-70" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* User footer */}
          <div className="border-t-2 border-(--border) bg-(--paper-2) p-3">
            <div className="flex items-center gap-3 border-2 border-(--border) px-3 py-2.5">
              <Bone className="size-5 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Bone className="h-3 w-4/5" />
                <Bone className="h-2 w-1/2" />
              </div>
            </div>
          </div>
        </aside>

        {/* ── Mobile: hamburger strip (< lg) ─────────────────────── */}
        <div className="flex items-center gap-2 lg:hidden">
          <Bone className="size-9" />
        </div>

        {/* ── Main panel ─────────────────────────────────────────── */}
        <div className="agent-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-none border-2">

          {/* Session header */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-4 sm:px-5">
            <div className="min-w-0 flex-1 space-y-2">
              <Bone className="h-2 w-24" />
              <Bone className="h-4 w-56" />
            </div>
            <Bone className="h-6 w-14" />
            <Bone className="h-7 w-14" />
          </div>

          {/* Timeline */}
          <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-5">
            <div className="flex h-full flex-col gap-5">

              {/* Assistant */}
              <div className="flex gap-3">
                <Bone className="size-8 shrink-0" />
                <div className="w-[min(60%,28rem)] space-y-2 border-2 border-(--border) p-3">
                  <Bone className="h-3 w-full" />
                  <Bone className="h-3 w-5/6" />
                  <Bone className="h-3 w-11/12" />
                  <Bone className="h-3 w-4/5" />
                </div>
              </div>

              {/* User */}
              <div className="flex justify-end">
                <div className="w-[min(52%,22rem)] space-y-2 border-2 border-(--border) bg-(--paper-3)/60 p-3">
                  <Bone className="h-3 w-full" />
                  <Bone className="h-3 w-3/4" />
                </div>
              </div>

              {/* Assistant */}
              <div className="flex gap-3">
                <Bone className="size-8 shrink-0" />
                <div className="w-[min(66%,32rem)] space-y-2 border-2 border-(--border) p-3">
                  <Bone className="h-3 w-full" />
                  <Bone className="h-3 w-full" />
                  <Bone className="h-3 w-5/6" />
                  <Bone className="h-3 w-4/5" />
                  <Bone className="h-3 w-3/5" />
                </div>
              </div>

              {/* User */}
              <div className="flex justify-end">
                <div className="w-[min(48%,20rem)] space-y-2 border-2 border-(--border) bg-(--paper-3)/60 p-3">
                  <Bone className="h-3 w-full" />
                </div>
              </div>

              {/* Assistant */}
              <div className="flex gap-3">
                <Bone className="size-8 shrink-0" />
                <div className="w-[min(58%,26rem)] space-y-2 border-2 border-(--border) p-3">
                  <Bone className="h-3 w-full" />
                  <Bone className="h-3 w-4/5" />
                  <Bone className="h-3 w-2/3" />
                </div>
              </div>
            </div>
          </div>

          {/* Composer */}
          <div className="min-w-0 border-t-2 border-(--border) px-4 py-3">
            <div className="space-y-2">
              {/* Textarea */}
              <Bone className="h-16 w-full border-2 border-(--border)" />
              {/* Footer bar */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <Bone className="h-2 w-48" />
                  <Bone className="h-2 w-36" />
                  <Bone className="h-[0.6rem] w-56 opacity-70" />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Bone className="h-8 w-20" />
                  <Bone className="h-8 w-16" />
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
