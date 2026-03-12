"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export type MatterChatSidebarSession = {
  id: string;
  title: string;
  updatedLabel: string;
  shortID: string;
};

type MatterChatGroup = {
  matter: string;
  code: string;
  chats: Array<MatterChatSidebarSession>;
};

type MatterChatSidebarProps = {
  sessions: Array<MatterChatSidebarSession>;
  selectedSessionID: string;
  onSelectSession: (sessionID: string) => void;
};

const EXTRA_MATTER_GROUPS: Array<MatterChatGroup> = [
  {
    matter: "MATTER100244",
    code: "MATTER100244",
    chats: [
      {
        id: "demo-matter-100244-1",
        title: "Initial chronology review",
        updatedLabel: "Mar 10",
        shortID: "CHAT01",
      },
      {
        id: "demo-matter-100244-2",
        title: "Witness statement drafting",
        updatedLabel: "Mar 8",
        shortID: "CHAT02",
      },
    ],
  },
  {
    matter: "MATTER100245",
    code: "MATTER100245",
    chats: [
      {
        id: "demo-matter-100245-1",
        title: "Contract clause extraction",
        updatedLabel: "Mar 7",
        shortID: "CHAT03",
      },
      {
        id: "demo-matter-100245-2",
        title: "Advice note follow-up",
        updatedLabel: "Mar 5",
        shortID: "CHAT04",
      },
      {
        id: "demo-matter-100245-3",
        title: "Client call prep",
        updatedLabel: "Mar 1",
        shortID: "CHAT05",
      },
    ],
  },
];

export function MatterChatSidebar({
  sessions,
  selectedSessionID,
  onSelectSession,
}: MatterChatSidebarProps) {
  const groupedSessions: Array<MatterChatGroup> = [
    {
      matter: "MATTER100243",
      code: "MATTER100243",
      chats: sessions,
    },
    ...EXTRA_MATTER_GROUPS,
  ];
  const [expandedMatters, setExpandedMatters] = useState<Record<string, boolean>>({
    MATTER100243: true,
    MATTER100244: false,
    MATTER100245: false,
  });

  const toggleMatter = (matterCode: string) => {
    setExpandedMatters((current) => ({
      ...current,
      [matterCode]: !current[matterCode],
    }));
  };

  return (
    <Card className="flex h-full min-h-0 min-w-0 gap-0 overflow-hidden rounded-none border-2 py-0 shadow-none">
      <CardHeader className="border-b-2 px-4 py-4">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--ink-muted)">
            Matter Chats
          </p>
          <CardTitle className="text-base leading-tight">Folders and Working Threads</CardTitle>
          <p className="text-xs text-(--ink-soft)">
            Example matter group with current sessions shown as chats.
          </p>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <ScrollArea type="always" className="h-full">
          <div className="space-y-3 p-3">
            {sessions.length === 0 ? (
              <div className="border-2 border-dashed p-3 text-sm text-(--ink-soft)">
                No saved sessions found.
              </div>
            ) : (
              groupedSessions.map((group) => (
                <section key={group.code} className="border-2 bg-(--surface-light) p-3">
                  <button
                    type="button"
                    onClick={() => toggleMatter(group.code)}
                    className="flex w-full items-center justify-between gap-3 border-b pb-2 text-left"
                  >
                    <p className="truncate text-sm font-semibold text-foreground">
                      {group.matter}
                    </p>
                    <Badge
                      variant="secondary"
                      className="rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                    >
                      {expandedMatters[group.code] ? "Open" : "Closed"}
                    </Badge>
                  </button>

                  {expandedMatters[group.code] ? (
                    <div className="mt-3 space-y-2">
                      {group.chats.map((chat) => {
                        const active = chat.id === selectedSessionID;
                        return (
                          <button
                            key={chat.id}
                            type="button"
                            onClick={() => onSelectSession(chat.id)}
                            className={`block w-full border-2 px-3 py-3 text-left transition-colors ${
                              active
                                ? "bg-(--brand-soft) text-foreground"
                                : "bg-transparent hover:bg-(--surface-hover)"
                            }`}
                          >
                            <p className="line-clamp-2 text-sm font-medium">{chat.title}</p>
                            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em] text-(--ink-muted)">
                              <span className="truncate">{chat.shortID}</span>
                              <span className="shrink-0">{chat.updatedLabel}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
