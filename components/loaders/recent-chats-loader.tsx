import { Spinner } from "@/components/loaders/spinner";

export function RecentChatsLoader() {
  return (
    <div className="border-2 border-dashed border-(--border) bg-(--surface-light) px-3 py-4">
      <div className="flex items-center gap-3 text-sm text-(--ink-muted)">
        <Spinner size="sm" className="text-(--ink-soft)" />
        <span>Loading chats...</span>
      </div>
    </div>
  );
}
