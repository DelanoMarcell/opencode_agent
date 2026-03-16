# Agent Route UI States

This document describes the practical UI state that `AgentClientRuntime` renders for each main route.

## `/agent`
- `workspaceMode = "chats"`
- `selectedSessionID = ""`
- sidebar shows `Recent chats`
- RHS shows the blank compose state

## `/agent/chats/:trackedSessionId`
- `workspaceMode = "chats"`
- `selectedSessionID` is set
- sidebar shows `Recent chats`
- RHS shows the selected chat timeline or the chat loader

## `/agent/matters`
- `workspaceMode = "matters"`
- no selected session
- no selected matter
- sidebar shows `Matter folders` only
- RHS shows the matters workspace empty state

## `/agent/matters/:matterId`
- `workspaceMode = "matters"`
- selected matter is set
- no selected session
- sidebar shows `Matter folders` only
- RHS shows the matter overview empty state

## `/agent/matters/:matterId/chats/:trackedSessionId`
- `workspaceMode = "matters"`
- selected matter is set
- `selectedSessionID` is set
- sidebar shows `Matter folders` only
- RHS shows the selected chat timeline or the chat loader

## Summary
`AgentClientRuntime` keeps one shared shell and changes the visible UI mainly from:
- `workspaceMode`
- `selectedSessionID`
- `selectedMatterID`
- loading and busy state

It does not swap to completely different page components for each route. Instead, it derives the sidebar data, empty states, and timeline state from those values.
