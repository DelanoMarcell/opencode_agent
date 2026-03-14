import { Skeleton } from "@/components/ui/skeleton";

export function AgentRouteLoading() {
  return (
    <main className="agent-page h-dvh overflow-hidden p-3 text-foreground sm:p-4">
      <div className="grid h-full gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="hidden h-full min-h-0 overflow-hidden border-2 bg-background lg:flex lg:flex-col">
          <div className="space-y-3 border-b-2 bg-(--paper-2) p-4">
            <Skeleton className="h-3 w-24 rounded-none" />
            <Skeleton className="h-8 w-28 rounded-none" />
          </div>
          <div className="space-y-3 p-4">
            <Skeleton className="h-14 w-full rounded-none" />
            <Skeleton className="h-14 w-full rounded-none" />
            <Skeleton className="h-14 w-full rounded-none" />
            <Skeleton className="h-16 w-full rounded-none" />
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden border-2 bg-background">
          <div className="flex items-center justify-between gap-3 border-b-2 px-4 py-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-28 rounded-none" />
              <Skeleton className="h-5 w-56 rounded-none" />
            </div>
            <Skeleton className="h-8 w-20 rounded-none" />
          </div>

          <div className="flex-1 space-y-4 p-4">
            <Skeleton className="h-20 w-full rounded-none" />
            <Skeleton className="h-28 w-[88%] rounded-none" />
            <Skeleton className="h-24 w-[72%] rounded-none" />
          </div>

          <div className="border-t-2 p-4">
            <Skeleton className="h-28 w-full rounded-none" />
          </div>
        </section>
      </div>
    </main>
  );
}
