"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  CircleHelp,
  ChevronDown,
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

export type MatterChatSidebarSession = {
  id: string;
  title: string;
  updatedLabel: string;
  shortID: string;
};

type MatterFolderChat = {
  id: string;
  title: string;
  updatedLabel: string;
  shortID: string;
};

type MatterFolder = {
  id: string;
  code: string;
  title: string;
  chats: Array<MatterFolderChat>;
};

type MatterChatSidebarProps = {
  sessions: Array<MatterChatSidebarSession>;
  selectedSessionID: string;
  onSelectSession: (sessionID: string) => void;
};

const INITIAL_FOLDERS: Array<MatterFolder> = [
  {
    id: "matter-12868",
    code: "MATTER12868",
    title: "Dispute Between X and Y",
    chats: [
      {
        id: "matter-chat-12868-1",
        title: "Chronology review",
        updatedLabel: "Mar 10",
        shortID: "CHAT01",
      },
      {
        id: "matter-chat-12868-2",
        title: "Witness statement drafting",
        updatedLabel: "Mar 8",
        shortID: "CHAT02",
      },
    ],
  },
  {
    id: "matter-14402",
    code: "MATTER14402",
    title: "Regulatory Advice for Delta Group",
    chats: [
      {
        id: "matter-chat-14402-1",
        title: "Contract clause extraction",
        updatedLabel: "Mar 7",
        shortID: "CHAT03",
      },
      {
        id: "matter-chat-14402-2",
        title: "Client call preparation",
        updatedLabel: "Mar 5",
        shortID: "CHAT04",
      },
    ],
  },
];

function buildRecentChat(id: string, index: number): MatterChatSidebarSession {
  return {
    id,
    title: `New chat ${index}`,
    updatedLabel: "Just now",
    shortID: `CHAT${String(index).padStart(2, "0")}`,
  };
}

function buildMatterFolder(index: number): MatterFolder {
  const matterCode = `MATTER${String(15000 + index)}`;

  return {
    id: `matter-new-${index}`,
    code: matterCode,
    title: `New matter folder ${index}`,
    chats: [],
  };
}

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
          className="h-7 w-7 cursor-pointer rounded-none border-0 bg-transparent text-(--ink) shadow-none hover:bg-transparent hover:text-(--ink-soft)"
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
  activeItemID: string;
  expandedMatters: Record<string, boolean>;
  folders: Array<MatterFolder>;
  recentChats: Array<MatterChatSidebarSession>;
  onCreateChat: () => void;
  onCreateMatter: () => void;
  onSelectItem: (itemID: string, isRealSession: boolean) => void;
  onToggleMatter: (matterID: string) => void;
};

function SidebarBody({
  activeItemID,
  expandedMatters,
  folders,
  recentChats,
  onCreateChat,
  onCreateMatter,
  onSelectItem,
  onToggleMatter,
}: SidebarBodyProps) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-x-hidden bg-(--paper) text-(--ink)">
      <div className="border-b-2 border-(--border) bg-(--paper-2) px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-(--ink-soft)">
              Workspace
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-(--ink)">Chats and matters</p>
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

      <ScrollArea className="min-h-0 min-w-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block [&>[data-slot=scroll-area-viewport]>div]:min-w-0 [&>[data-slot=scroll-area-viewport]>div]:w-full">
        <div className="min-w-0 w-full space-y-5 px-3 py-3">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                Recent chats
              </p>
            </div>
            {recentChats.length > 0 ? (
              recentChats.map((chat) => {
                const active = activeItemID === chat.id;
                return (
                    <div
                      key={chat.id}
                      onClick={() => onSelectItem(chat.id, true)}
                      className={`group flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden border-2 px-2 py-2 transition-colors ${
                        active
                          ? "border-(--border) bg-(--brand-soft) shadow-[4px_4px_0_rgba(var(--shadow-ink),0.08)]"
                          : "border-transparent bg-transparent hover:border-(--border) hover:bg-(--surface-light)"
                      } cursor-pointer`}
                    >
                    <button
                      type="button"
                      onClick={() => onSelectItem(chat.id, true)}
                      className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                    >
                      <MessageSquareText className="size-4 shrink-0 text-(--ink-soft)" />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-sm font-medium">{chat.title}</p>
                        <p className="truncate mt-0.5 text-[11px] text-(--ink-muted)">
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
                No chats yet.
              </div>
            )}
          </section>

          <section className="space-y-2 border-t-2 border-(--border) pt-4">
            <div className="px-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--ink-soft)">
                Matter folders
              </p>
            </div>

            {folders.map((folder) => {
              const isExpanded = expandedMatters[folder.id] ?? false;

              return (
                <div key={folder.id} className="w-full min-w-0 rounded-md">
                  <div
                    onClick={() => onToggleMatter(folder.id)}
                    className={`group flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden border-2 px-2 py-2 transition-colors ${
                      isExpanded
                        ? "border-(--border) bg-(--surface-interactive)"
                        : "border-transparent bg-transparent hover:border-(--border) hover:bg-(--surface-hover)"
                    } cursor-pointer`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleMatter(folder.id)}
                      className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                    >
                      <Folder className="size-4 shrink-0 text-(--ink-soft)" />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-sm font-medium">{folder.code}</p>
                        <p className="truncate text-xs text-(--ink-muted)">{folder.title}</p>
                      </div>
                      <ChevronDown
                        className={`size-4 shrink-0 text-(--ink-muted) transition-transform ${
                          isExpanded ? "" : "-rotate-90"
                        }`}
                      />
                    </button>
                    <div className="shrink-0">
                      <RowActionMenu kind="matter" title={folder.title} />
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="ml-4 mt-1 min-w-0 w-full space-y-1 border-l-2 border-(--border) pl-3">
                      {folder.chats.length > 0 ? (
                        folder.chats.map((chat) => {
                          const active = activeItemID === chat.id;
                          return (
                            <div
                              key={chat.id}
                              onClick={() => onSelectItem(chat.id, false)}
                              className={`group flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden border-2 px-2 py-2 transition-colors ${
                                active
                                  ? "border-(--border) bg-(--brand-soft) shadow-[4px_4px_0_rgba(var(--shadow-ink),0.08)]"
                                  : "border-transparent bg-transparent hover:border-(--border) hover:bg-(--surface-light)"
                              } cursor-pointer`}
                            >
                              <button
                                type="button"
                                onClick={() => onSelectItem(chat.id, false)}
                                className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                              >
                                <MessageSquareText className="size-4 shrink-0 text-(--ink-muted)" />
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <p className="truncate text-sm">{chat.title}</p>
                                  <p className="truncate mt-0.5 text-[11px] text-(--ink-muted)">
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
            })}
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
              <UserCircle2 className="size-5 shrink-0 text-(--ink)" />
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium">edp2@lnpbeyondlegal.com</p>
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
            <DropdownMenuItem asChild className="agent-menu-item rounded-none">
              <Link href="/test">Test</Link>
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
  sessions,
  selectedSessionID,
  onSelectSession,
}: MatterChatSidebarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [activeItemID, setActiveItemID] = useState(selectedSessionID);
  const [mockRecentChats, setMockRecentChats] = useState<Array<MatterChatSidebarSession>>([]);
  const [folders, setFolders] = useState<Array<MatterFolder>>(INITIAL_FOLDERS);
  const [expandedMatters, setExpandedMatters] = useState<Record<string, boolean>>({
    "matter-12868": true,
    "matter-14402": false,
  });

  useEffect(() => {
    if (selectedSessionID) {
      setActiveItemID(selectedSessionID);
    }
  }, [selectedSessionID]);

  const recentChats = useMemo(
    () => [...mockRecentChats, ...sessions],
    [mockRecentChats, sessions]
  );

  const handleSelectItem = (itemID: string, isRealSession: boolean) => {
    setActiveItemID(itemID);
    if (isRealSession) {
      onSelectSession(itemID);
    }
    setIsMobileOpen(false);
  };

  const handleCreateChat = () => {
    const nextIndex = mockRecentChats.length + 1;
    const nextChat = buildRecentChat(`mock-chat-${nextIndex}`, nextIndex);
    setMockRecentChats((current) => [nextChat, ...current]);
    setActiveItemID(nextChat.id);
    setIsMobileOpen(false);
  };

  const handleCreateMatter = () => {
    const nextFolder = buildMatterFolder(folders.length + 1);
    setFolders((current) => [nextFolder, ...current]);
    setExpandedMatters((existing) => ({
      ...existing,
      [nextFolder.id]: true,
    }));
    setIsMobileOpen(false);
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

      <aside
        className="agent-panel hidden h-full min-h-0 w-[320px] min-w-0 overflow-hidden border-2 bg-(--paper) lg:flex"
      >
        <SidebarBody
          activeItemID={activeItemID}
          expandedMatters={expandedMatters}
          folders={folders}
          recentChats={recentChats}
          onCreateChat={handleCreateChat}
          onCreateMatter={handleCreateMatter}
          onSelectItem={handleSelectItem}
          onToggleMatter={handleToggleMatter}
        />
      </aside>

      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[88vw] max-w-[340px] border-r-2 border-(--border) bg-(--paper) p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Chats and matter folders</SheetTitle>
            <SheetDescription>
              Browse recent chats, open matter folders, and access account actions.
            </SheetDescription>
          </SheetHeader>
          <SidebarBody
            activeItemID={activeItemID}
            expandedMatters={expandedMatters}
            folders={folders}
            recentChats={recentChats}
            onCreateChat={handleCreateChat}
            onCreateMatter={handleCreateMatter}
            onSelectItem={handleSelectItem}
            onToggleMatter={handleToggleMatter}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
