"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
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

import { CreateMatterDialog } from "@/components/agent-shell/create-matter-dialog";
import { RecentChatsLoader } from "@/components/loaders/recent-chats-loader";
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

function buildExpandedMattersState(
  matters: Array<MatterChatSidebarMatter>,
  selectedMatterID: string,
  selectedTrackedSessionID: string,
  current: Record<string, boolean> = {}
): Record<string, boolean> {
  const next = { ...current };
  const activeMatterForSelectedChat = selectedTrackedSessionID
    ? matters.find((matter) =>
        matter.chats.some((chat) => chat.trackedSessionId === selectedTrackedSessionID)
      )?.id
    : undefined;

  for (const matter of matters) {
    if (!(matter.id in next)) {
      next[matter.id] = false;
    }
  }

  if (selectedMatterID) {
    next[selectedMatterID] = true;
  }

  if (activeMatterForSelectedChat) {
    next[activeMatterForSelectedChat] = true;
  }

  return next;
}

type WorkspaceMode = "chats" | "matters";

type MatterChatSidebarProps = {
  canCreateChat: boolean;
  isLoadingRecentChats: boolean;
  matters: Array<MatterChatSidebarMatter>;
  recentChats: Array<MatterChatSidebarSession>;
  selectedMatterID: string;
  selectedTrackedSessionID: string;
  userEmail: string;
  workspaceMode: WorkspaceMode;
  onCreateChat: () => void;
  onMatterCreated: (matterID: string) => void;
  onOpenChatsWorkspace: () => void;
  onOpenMattersWorkspace: () => void;
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
  canCreateChat: boolean;
  expandedMatters: Record<string, boolean>;
  isLoadingRecentChats: boolean;
  matters: Array<MatterChatSidebarMatter>;
  recentChats: Array<MatterChatSidebarSession>;
  userEmail: string;
  workspaceMode: WorkspaceMode;
  onCreateChat: () => void;
  onCreateMatter: () => void;
  onOpenChatsWorkspace: () => void;
  onOpenMattersWorkspace: () => void;
  onSelectMatter: (matterID: string) => void;
  onSelectSession: (trackedSessionID: string) => void;
  onToggleMatter: (matterID: string) => void;
};

function SidebarBody({
  activeMatterID,
  activeTrackedSessionID,
  canCreateChat,
  expandedMatters,
  isLoadingRecentChats,
  matters,
  recentChats,
  userEmail,
  workspaceMode,
  onCreateChat,
  onCreateMatter,
  onOpenChatsWorkspace,
  onOpenMattersWorkspace,
  onSelectMatter,
  onSelectSession,
  onToggleMatter,
}: SidebarBodyProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeSidebarItemID = activeTrackedSessionID || activeMatterID;

  useEffect(() => {
    if (!activeSidebarItemID) return;
    if (!rootRef.current || rootRef.current.getClientRects().length === 0) return;

    const frameID = window.requestAnimationFrame(() => {
      const viewport = rootRef.current?.querySelector(
        '[data-slot="scroll-area-viewport"]'
      ) as HTMLDivElement | null;
      const activeRow = rootRef.current?.querySelector(
        '[data-active-sidebar-item="true"]'
      ) as HTMLDivElement | null;

      if (!viewport || !activeRow) return;

      const viewportRect = viewport.getBoundingClientRect();
      const activeRowRect = activeRow.getBoundingClientRect();
      const isFullyVisible =
        activeRowRect.top >= viewportRect.top &&
        activeRowRect.bottom <= viewportRect.bottom;

      if (isFullyVisible) return;

      activeRow.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "smooth",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameID);
    };
  }, [activeSidebarItemID]);

  return (
    <div
      ref={rootRef}
      className="flex h-full w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-background text-foreground"
    >
      <div className="border-b-2 border-(--border) bg-(--paper-2) px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-(--ink-soft)">
              Workspace
            </p>
          </div>

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
              {canCreateChat ? (
                <DropdownMenuItem
                  onSelect={onCreateChat}
                  className="agent-menu-item rounded-none"
                >
                  <MessageSquareText className="size-4" />
                  New chat
                </DropdownMenuItem>
              ) : null}
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

      <ScrollArea className="min-h-0 min-w-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block! [&>[data-slot=scroll-area-viewport]>div]:min-w-0 [&>[data-slot=scroll-area-viewport]>div]:w-full">
        <div className="min-w-0 w-full space-y-5 px-3 py-3">
          {workspaceMode === "chats" ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                  Recent chats
                </p>
                <button
                  type="button"
                  onClick={onOpenMattersWorkspace}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-(--ink-soft) transition-colors hover:text-foreground"
                  aria-label="Open matters workspace"
                >
                  Matters
                  <ArrowRight className="size-3.5" />
                </button>
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
                      data-active-sidebar-item={active ? "true" : undefined}
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
          ) : null}

          {workspaceMode === "matters" ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                  Matter folders
                </p>
                <button
                  type="button"
                  onClick={onOpenChatsWorkspace}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-(--ink-soft) transition-colors hover:text-foreground"
                  aria-label="Open chats workspace"
                >
                  Chats
                  <ArrowRight className="size-3.5" />
                </button>
              </div>

              {matters.length > 0 ? (
                matters.map((matter) => {
                  const isExpanded = expandedMatters[matter.id] ?? false;
                  const matterActive = activeMatterID === matter.id;

                  return (
                    <div
                      key={matter.id}
                      data-active-sidebar-item={matterActive ? "true" : undefined}
                      className="w-full min-w-0 rounded-md"
                    >
                      <div
                        onClick={() => onSelectMatter(matter.id)}
                        className={`group flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden border-2 px-2 py-2 transition-colors ${
                          matterActive
                            ? "border-(--border) border-l-4 bg-(--brand-soft) shadow-[4px_4px_0_rgba(var(--shadow-ink),0.08)]"
                            : "border-transparent bg-transparent hover:border-(--border) hover:bg-(--surface-hover)"
                        } cursor-pointer`}
                        style={matterActive ? { borderLeftColor: "var(--brand)" } : undefined}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectMatter(matter.id)}
                          className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                        >
                          <Folder
                            className={`size-4 shrink-0 ${
                              matterActive ? "text-foreground" : "text-(--ink-soft)"
                            }`}
                          />
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <p
                              className={`truncate text-sm font-medium ${
                                matterActive ? "font-semibold text-foreground" : ""
                              }`}
                            >
                              {matter.code}
                            </p>
                            <p
                              className={`truncate text-xs ${
                                matterActive
                                  ? "font-semibold text-(--ink-soft)"
                                  : "text-(--ink-muted)"
                              }`}
                            >
                              {matter.title}
                            </p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleMatter(matter.id);
                          }}
                          className={`inline-flex shrink-0 cursor-pointer items-center rounded-none border p-1 transition-colors ${
                            isExpanded
                              ? "border-(--brand) bg-(--brand-soft) text-(--brand)"
                              : matterActive
                                ? "border-(--border) text-foreground"
                                : "border-(--border) text-(--ink-muted) hover:text-foreground"
                          }`}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${matter.code}`}
                          title={isExpanded ? "Collapse folder" : "Expand folder"}
                        >
                          <ChevronDown
                            className={`size-4 transition-transform ${
                              isExpanded ? "stroke-[2.5]" : "-rotate-90 stroke-2"
                            }`}
                          />
                        </button>
                        <div className="shrink-0">
                          <RowActionMenu kind="matter" title={matter.title} />
                        </div>
                      </div>

                      {isExpanded && matter.chats.length > 0 ? (
                        <div className="ml-6 mt-1 min-w-0 space-y-1 border-l-2 border-(--border) pl-4">
                          {matter.chats.map((chat) => {
                            const active = activeTrackedSessionID === chat.trackedSessionId;
                            return (
                              <div
                                key={chat.trackedSessionId}
                                onClick={() => onSelectSession(chat.trackedSessionId)}
                                data-active-sidebar-item={active ? "true" : undefined}
                                data-active-sidebar-session={active ? "true" : undefined}
                                className={`group relative flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden border-2 px-2 py-2 transition-colors before:absolute before:-left-4 before:top-1/2 before:h-px before:w-3 before:-translate-y-1/2 before:bg-(--border) ${
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
                          })}
                        </div>
                      ) : null}
                      {isExpanded && matter.chats.length === 0 && matterActive ? (
                        <p className="ml-6 mt-1 px-2 py-1 text-xs italic text-(--ink-muted)">
                          No items yet
                        </p>
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
          ) : null}
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
  canCreateChat,
  isLoadingRecentChats,
  matters,
  recentChats,
  selectedMatterID,
  selectedTrackedSessionID,
  userEmail,
  workspaceMode,
  onCreateChat,
  onMatterCreated,
  onOpenChatsWorkspace,
  onOpenMattersWorkspace,
  onSelectMatter,
  onSelectSession,
}: MatterChatSidebarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCreateMatterOpen, setIsCreateMatterOpen] = useState(false);
  const [expandedMatters, setExpandedMatters] = useState<Record<string, boolean>>(() =>
    buildExpandedMattersState(matters, selectedMatterID, selectedTrackedSessionID)
  );

  useLayoutEffect(() => {
    setExpandedMatters((current) =>
      buildExpandedMattersState(matters, selectedMatterID, selectedTrackedSessionID, current)
    );
  }, [matters, selectedMatterID, selectedTrackedSessionID]);

  const handleSelectMatter = (matterID: string) => {
    onSelectMatter(matterID);
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
          canCreateChat={canCreateChat}
          expandedMatters={expandedMatters}
          isLoadingRecentChats={isLoadingRecentChats}
          matters={matters}
          recentChats={recentChats}
          userEmail={userEmail}
          workspaceMode={workspaceMode}
          onCreateChat={onCreateChat}
          onCreateMatter={handleCreateMatter}
          onOpenChatsWorkspace={onOpenChatsWorkspace}
          onOpenMattersWorkspace={onOpenMattersWorkspace}
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
            canCreateChat={canCreateChat}
            expandedMatters={expandedMatters}
            isLoadingRecentChats={isLoadingRecentChats}
            matters={matters}
            recentChats={recentChats}
            userEmail={userEmail}
            workspaceMode={workspaceMode}
            onCreateChat={onCreateChat}
            onCreateMatter={handleCreateMatter}
            onOpenChatsWorkspace={onOpenChatsWorkspace}
            onOpenMattersWorkspace={onOpenMattersWorkspace}
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
