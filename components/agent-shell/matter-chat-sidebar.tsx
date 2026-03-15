"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  CircleHelp,
  FileText,
  Folder,
  FolderInput,
  LogOut,
  Menu,
  MessageSquareText,
  MoreVertical,
  Pencil,
  Plus,
  Shield,
  UserCircle2,
} from "lucide-react";
import { signOut } from "next-auth/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RecentChatsLoader } from "@/components/loaders/recent-chats-loader";
import { CreateMatterDialog } from "@/components/agent-shell/create-matter-dialog";

export type MatterChatSidebarSession = {
  trackedSessionId: string;
  rawSessionId: string;
  title: string;
  updatedLabel: string;
  shortID: string;
};

export type MatterChatSidebarMatter = {
  id: string;
  code: string;
  title: string;
  chats: Array<MatterChatSidebarSession>;
};

type MatterChatSidebarProps = {
  isLoadingRecentChats: boolean;
  matters: Array<MatterChatSidebarMatter>;
  recentChats: Array<MatterChatSidebarSession>;
  selectedMatterID: string;
  selectedTrackedSessionID: string;
  userEmail: string;
  onCreateChat: () => void;
  onMatterCreated: (matterID: string) => void;
  onSelectMatter: (matterID: string) => void;
  onSelectSession: (trackedSessionID: string) => void;
};

type RowActionMenuProps = {
  kind: "chat" | "matter";
  title: string;
};

function RowActionMenu({ kind, title }: RowActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="h-7 w-7 cursor-pointer rounded-none border-0 bg-transparent text-foreground shadow-none hover:bg-transparent hover:text-(--ink-soft)"
          aria-label={`Open ${kind} actions for ${title}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MoreVertical className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="agent-menu w-44 rounded-none border-2 shadow-[6px_6px_0_rgba(var(--shadow-ink),0.12)]"
      >
        <DropdownMenuItem className="agent-menu-item rounded-none py-2">
          <Pencil className="size-4" />
          Rename
        </DropdownMenuItem>
        {kind === "matter" ? (
          <DropdownMenuItem className="agent-menu-item rounded-none py-2">
            <FileText className="size-4" />
            Matter files
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="agent-menu-item rounded-none py-2">
          {kind === "matter" ? (
            <>
              <Archive className="size-4" />
              Archive folder
            </>
          ) : (
            <>
              <FolderInput className="size-4" />
              Move to matter
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SidebarBodyProps = {
  activeMatterID: string;
  activeTrackedSessionID: string;
  expandedMatters: Record<string, boolean>;
  isLoadingRecentChats: boolean;
  matters: Array<MatterChatSidebarMatter>;
  recentChats: Array<MatterChatSidebarSession>;
  userEmail: string;
  onCreateChat: () => void;
  onCreateMatter: () => void;
  onSelectMatter: (matterID: string) => void;
  onSelectSession: (trackedSessionID: string) => void;
  onToggleMatter: (matterID: string) => void;
};

function SidebarBody({
  activeMatterID,
  activeTrackedSessionID,
  expandedMatters,
  isLoadingRecentChats,
  matters,
  recentChats,
  userEmail,
  onCreateChat,
  onCreateMatter,
  onSelectMatter,
  onSelectSession,
  onToggleMatter,
}: SidebarBodyProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeTrackedSessionID) return;
    if (!rootRef.current || rootRef.current.getClientRects().length === 0) return;

    const frameID = window.requestAnimationFrame(() => {
      const viewport = rootRef.current?.querySelector(
        '[data-slot="scroll-area-viewport"]'
      ) as HTMLDivElement | null;
      const activeRow = rootRef.current?.querySelector(
        '[data-active-sidebar-session="true"]'
      ) as HTMLDivElement | null;

      if (!viewport || !activeRow) return;

      const viewportRect = viewport.getBoundingClientRect();
      const activeRowRect = activeRow.getBoundingClientRect();
      const isFullyVisible =
        activeRowRect.top >= viewportRect.top &&
        activeRowRect.bottom <= viewportRect.bottom;

      if (isFullyVisible) return;

      activeRow?.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "smooth",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameID);
    };
  }, [activeTrackedSessionID, expandedMatters]);

  return (
    <div
      ref={rootRef}
      className="flex h-full w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-background text-foreground"
    >
      <div className="border-b-2 border-(--border) bg-(--paper-2) px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-(--ink-soft)">
              Workspace
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">Chats and matters</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className="agent-btn-primary h-9 shrink-0 cursor-pointer rounded-none border-2 px-3 shadow-none"
                >
                  <Plus className="size-4" />
                  New
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => event.preventDefault()}
                className="agent-menu w-48 rounded-none border-2 shadow-[6px_6px_0_rgba(var(--shadow-ink),0.12)]"
              >
                <DropdownMenuItem onSelect={onCreateChat} className="agent-menu-item rounded-none">
                  <MessageSquareText className="size-4" />
                  New chat
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onCreateMatter}
                  className="agent-menu-item rounded-none"
                >
                  <Folder className="size-4" />
                  New matter folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block! [&>[data-slot=scroll-area-viewport]>div]:min-w-0 [&>[data-slot=scroll-area-viewport]>div]:w-full">
        <div className="min-w-0 w-full space-y-5 px-3 py-3">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                Recent chats
              </p>
            </div>
            {isLoadingRecentChats && recentChats.length === 0 ? (
              <RecentChatsLoader />
            ) : recentChats.length > 0 ? (
              recentChats.map((chat) => {
                const active = activeTrackedSessionID === chat.trackedSessionId;
                return (
                  <div
                    key={chat.trackedSessionId}
                    onClick={() => onSelectSession(chat.trackedSessionId)}
                    data-active-sidebar-session={active ? "true" : undefined}
                    className={`group flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden border-2 px-2 py-2 transition-colors ${
                      active
                        ? "border-(--border) bg-(--brand-soft) shadow-[4px_4px_0_rgba(var(--shadow-ink),0.08)]"
                        : "border-transparent bg-transparent hover:border-(--border) hover:bg-(--surface-light)"
                    } cursor-pointer`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(chat.trackedSessionId)}
                      className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                    >
                      <MessageSquareText className="size-4 shrink-0 text-(--ink-soft)" />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-sm font-medium">{chat.title}</p>
                        <p className="mt-0.5 truncate text-[11px] text-(--ink-muted)">
                          {chat.shortID} • {chat.updatedLabel}
                        </p>
                      </div>
                    </button>
                    <div className="shrink-0">
                      <RowActionMenu kind="chat" title={chat.title} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="border-2 border-dashed border-(--border) bg-(--surface-light) px-3 py-4 text-sm text-(--ink-muted)">
                No tracked chats yet.
              </div>
            )}
          </section>

          <section className="space-y-2 border-t-2 border-(--border) pt-4">
            <div className="px-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                Matter folders
              </p>
            </div>

            {matters.length > 0 ? (
              matters.map((matter) => {
                const isExpanded = expandedMatters[matter.id] ?? false;
                const matterActive = activeMatterID === matter.id && !activeTrackedSessionID;

                return (
                  <div key={matter.id} className="w-full min-w-0 rounded-md">
                    <div
                      onClick={() => onSelectMatter(matter.id)}
                      className={`group flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden border-2 px-2 py-2 transition-colors ${
                        matterActive || isExpanded
                          ? "border-(--border) bg-(--surface-interactive)"
                          : "border-transparent bg-transparent hover:border-(--border) hover:bg-(--surface-hover)"
                      } cursor-pointer`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectMatter(matter.id)}
                        className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                      >
                        <Folder className="size-4 shrink-0 text-(--ink-soft)" />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="truncate text-sm font-medium">{matter.code}</p>
                          <p className="truncate text-xs text-(--ink-muted)">{matter.title}</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleMatter(matter.id);
                        }}
                        className="shrink-0 cursor-pointer rounded-none p-1 text-(--ink-muted)"
                        aria-label={`Toggle ${matter.code}`}
                      >
                        <ChevronDown
                          className={`size-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                        />
                      </button>
                      <div className="shrink-0">
                        <RowActionMenu kind="matter" title={matter.title} />
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className="ml-4 mt-1 min-w-0 w-full space-y-1 border-l-2 border-(--border) pl-3">
                        {matter.chats.length > 0 ? (
                          matter.chats.map((chat) => {
                            const active = activeTrackedSessionID === chat.trackedSessionId;
                            return (
                              <div
                                key={chat.trackedSessionId}
                                onClick={() => onSelectSession(chat.trackedSessionId)}
                                data-active-sidebar-session={active ? "true" : undefined}
                                className={`group flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden border-2 px-2 py-2 transition-colors ${
                                  active
                                    ? "border-(--border) bg-(--brand-soft) shadow-[4px_4px_0_rgba(var(--shadow-ink),0.08)]"
                                    : "border-transparent bg-transparent hover:border-(--border) hover:bg-(--surface-light)"
                                } cursor-pointer`}
                              >
                                <button
                                  type="button"
                                  onClick={() => onSelectSession(chat.trackedSessionId)}
                                  className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                                >
                                  <MessageSquareText className="size-4 shrink-0 text-(--ink-muted)" />
                                  <div className="min-w-0 flex-1 overflow-hidden">
                                    <p className="truncate text-sm">{chat.title}</p>
                                    <p className="mt-0.5 truncate text-[11px] text-(--ink-muted)">
                                      {chat.shortID} • {chat.updatedLabel}
                                    </p>
                                  </div>
                                </button>
                                <div className="shrink-0">
                                  <RowActionMenu kind="chat" title={chat.title} />
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="border-2 border-dashed border-(--border) bg-(--surface-light) px-3 py-3 text-xs text-(--ink-muted)">
                            Empty matter folder
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="border-2 border-dashed border-(--border) bg-(--surface-light) px-3 py-4 text-sm text-(--ink-muted)">
                No matter folders yet.
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      <div className="border-t-2 border-(--border) bg-(--paper-2) p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full min-w-0 cursor-pointer items-center gap-3 overflow-hidden border-2 border-(--border) bg-(--surface-light) px-3 py-2.5 text-left hover:bg-(--brand-soft)"
            >
              <UserCircle2 className="size-5 shrink-0 text-foreground" />
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium">{userEmail}</p>
                <p className="truncate text-xs text-(--ink-muted)">
                  Account settings, privacy and logout
                </p>
              </div>
              <ChevronDown className="size-4 shrink-0 text-(--ink-muted)" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="agent-menu w-56 rounded-none border-2 shadow-[6px_6px_0_rgba(var(--shadow-ink),0.12)]"
          >
            <DropdownMenuItem className="agent-menu-item rounded-none">
              <UserCircle2 className="size-4" />
              Account settings
            </DropdownMenuItem>
            <DropdownMenuItem className="agent-menu-item rounded-none">
              <Shield className="size-4" />
              Privacy and access
            </DropdownMenuItem>
            <DropdownMenuItem className="agent-menu-item rounded-none">
              <CircleHelp className="size-4" />
              Help and support
            </DropdownMenuItem>
           
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="agent-menu-item rounded-none"
              onSelect={() => void signOut({ callbackUrl: "/auth/sign-in" })}
            >
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function MatterChatSidebar({
  isLoadingRecentChats,
  matters,
  recentChats,
  selectedMatterID,
  selectedTrackedSessionID,
  userEmail,
  onCreateChat,
  onMatterCreated,
  onSelectMatter,
  onSelectSession,
}: MatterChatSidebarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCreateMatterOpen, setIsCreateMatterOpen] = useState(false);
  const [expandedMatters, setExpandedMatters] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedMatters((current) => {
      const next = { ...current };

      for (const matter of matters) {
        if (!(matter.id in next)) {
          next[matter.id] = matter.id === selectedMatterID;
        }
      }

      if (selectedMatterID) {
        next[selectedMatterID] = true;
      }

      return next;
    });
  }, [matters, selectedMatterID]);

  const handleSelectMatter = (matterID: string) => {
    onSelectMatter(matterID);
    setExpandedMatters((current) => ({
      ...current,
      [matterID]: true,
    }));
    setIsMobileOpen(false);
  };

  const handleSelectSession = (trackedSessionID: string) => {
    onSelectSession(trackedSessionID);
    setIsMobileOpen(false);
  };

  const handleCreateMatter = () => {
    setIsMobileOpen(false);
    setIsCreateMatterOpen(true);
  };

  const handleMatterCreated = (matterID: string) => {
    setIsCreateMatterOpen(false);
    onMatterCreated(matterID);
  };

  const handleToggleMatter = (matterID: string) => {
    setExpandedMatters((current) => ({
      ...current,
      [matterID]: !current[matterID],
    }));
  };

  return (
    <>
      <div className="fixed left-3 top-3 z-40 lg:hidden">
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => setIsMobileOpen(true)}
          className="agent-btn cursor-pointer rounded-none border-2 shadow-[6px_6px_0_rgba(var(--shadow-ink),0.12)]"
        >
          <Menu className="size-4" />
          <span className="sr-only">Open chat sidebar</span>
        </Button>
      </div>

      <aside className="agent-panel hidden h-full min-h-0 w-[320px] min-w-0 overflow-hidden border-2 bg-background lg:flex">
        <SidebarBody
          activeMatterID={selectedMatterID}
          activeTrackedSessionID={selectedTrackedSessionID}
          expandedMatters={expandedMatters}
          isLoadingRecentChats={isLoadingRecentChats}
          matters={matters}
          recentChats={recentChats}
          userEmail={userEmail}
          onCreateChat={onCreateChat}
          onCreateMatter={handleCreateMatter}
          onSelectMatter={handleSelectMatter}
          onSelectSession={handleSelectSession}
          onToggleMatter={handleToggleMatter}
        />
      </aside>

      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[88vw] max-w-[340px] border-r-2 border-(--border) bg-background p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Chats and matter folders</SheetTitle>
            <SheetDescription>
              Browse tracked chats, open matter folders, and access account actions.
            </SheetDescription>
          </SheetHeader>
          <SidebarBody
            activeMatterID={selectedMatterID}
            activeTrackedSessionID={selectedTrackedSessionID}
            expandedMatters={expandedMatters}
            isLoadingRecentChats={isLoadingRecentChats}
            matters={matters}
            recentChats={recentChats}
            userEmail={userEmail}
            onCreateChat={onCreateChat}
            onCreateMatter={handleCreateMatter}
            onSelectMatter={handleSelectMatter}
            onSelectSession={handleSelectSession}
            onToggleMatter={handleToggleMatter}
          />
        </SheetContent>
      </Sheet>

      <CreateMatterDialog
        open={isCreateMatterOpen}
        onOpenChange={setIsCreateMatterOpen}
        onMatterCreated={handleMatterCreated}
      />
    </>
  );
}
