# Compare + Claude Code Integration

## Overview

Compare and Claude Code both operate on the same git repo. Compare reviews diffs in a desktop GUI (and on mobile via sync server); Claude Code works in a terminal. The goal is bidirectional communication between them without embedding one inside the other.

## What Already Works (free, no code needed)

- **Claude Code changes -> Compare**: Compare's file watcher detects git changes and reloads automatically.
- **Claude Code can read review state**: `.git/compare/reviews/<comparison>.json` is plain JSON that Claude Code can read with its Read tool.
- **The CLI exists**: `compare-cli` already supports `--format json` on all commands (`status`, `diff --labeled`, `files`, `approve`, `reject`, `trust`, `untrust`, `classify`, `taxonomy`).

## Integration Architecture

### Direction 1: Claude Code -> Compare (MCP server)

Claude Code connects to a `compare` MCP server (exposed by `compare-cli mcp`). The MCP server provides structured tools that let Claude Code read review state, approve/reject hunks, manage trust patterns, etc. When the MCP server writes to `.git/compare/`, Compare's file watcher picks up the change and updates the UI in real-time.

### Direction 2: Compare -> Claude Code (messages + hook)

There is no way to push messages into a running Claude Code terminal session (no IPC socket, no stdin injection, no push notifications). The workaround:

1. Compare writes messages to `.git/compare/agent-messages.json` (via `compare-cli messages send`)
2. A `UserPromptSubmit` hook runs `compare-cli messages check` every time the user types in Claude Code
3. If pending messages exist, the hook outputs them as context and clears them
4. Claude Code sees the messages alongside the user's prompt

### Detecting Claude Code activity

Claude Code stores session transcripts at `~/.claude/projects/<project-id>/` where the project ID is the absolute repo path with `/` replaced by `-`:

```
Repo:    /Users/dave/Developer/dropseed/compare
Project: ~/.claude/projects/-Users-dave-Developer-dropseed-compare/
```

Session files are `.jsonl` files written in real-time. Compare can detect active Claude Code sessions by checking if any session file was modified recently (e.g., within the last 2-5 minutes). There are no PID files or lock files - file modification time is the only signal.

## End-to-End Workflows

### Claude Code reads Compare state

1. User asks Claude Code "what needs attention in my review?"
2. Claude calls `compare_status` MCP tool -> gets hunk counts, trust list, progress
3. Claude calls `compare_diff` MCP tool -> gets hunks with classification labels
4. Claude responds with a summary of what's pending

### Claude Code writes to Compare

1. User tells Claude Code "approve all the import-only hunks"
2. Claude loops through matching hunks, calling `compare_approve` for each
3. Each call writes to `.git/compare/reviews/<comparison>.json`
4. Compare's file watcher detects the change, UI updates in real-time

### Compare sends feedback to Claude Code

1. User is in Compare (desktop or mobile), sees a problematic hunk
2. User writes feedback: "The error handling in src/app.rs is missing a catch block"
3. Compare calls `compare-cli messages send "..."` (via Tauri command or sync server)
4. CLI appends the message to `.git/compare/agent-messages.json`
5. User goes back to Claude Code, types anything ("what should I fix next?")
6. `UserPromptSubmit` hook runs `compare-cli messages check --format context`
7. CLI outputs pending messages as context, then clears them
8. Claude sees both the user's prompt AND the Compare feedback

### Mobile -> Claude Code

Same flow as above. Mobile sends the message through the sync server HTTP API. Compare desktop receives it and writes to `agent-messages.json`. Claude Code picks it up via the hook.

## Why Hooks Are Needed

CLAUDE.md instructions are advisory (~50-80% reliable, degrades as context fills up during long sessions). MCP tool descriptions don't trigger proactive invocation. The Claude Code docs say: "Use hooks for actions that must happen every time with zero exceptions."

The hook itself is trivial:

```bash
#!/bin/bash
compare-cli messages check --format context 2>/dev/null
```

No messages pending = no output = no effect. Messages pending = output as context + clear.

## Implementation

### Part 1: MCP Server (`compare-cli mcp`)

Add an `mcp` subcommand to the existing CLI. Implements JSON-RPC 2.0 over stdio (the MCP protocol). Reuses existing core library functions - no Tauri dependency.

**MCP Tools:**

| Tool                     | Description                              |
| ------------------------ | ---------------------------------------- |
| `compare_status`         | Review progress, trust list, hunk counts |
| `compare_diff`           | Hunks with labels, filterable by status  |
| `compare_approve`        | Approve a hunk by ID (filepath:hash)     |
| `compare_reject`         | Reject a hunk by ID                      |
| `compare_trust`          | Add a trust pattern (e.g., "imports:\*") |
| `compare_untrust`        | Remove a trust pattern                   |
| `compare_add_note`       | Set review notes                         |
| `compare_taxonomy`       | Get the trust pattern taxonomy           |
| `compare_check_messages` | Read pending messages from Compare       |

No heavy MCP SDK needed. The protocol is JSON-RPC 2.0 with three methods (`initialize`, `tools/list`, `tools/call`). Implement directly with `serde_json`.

Concurrency with Compare desktop: uses optimistic concurrency via `version` field in ReviewState. Load -> modify -> `prepare_for_save()` -> save. Retry on `VersionConflict`. Compare's file watcher detects the write and updates the UI.

Configuration (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "compare": {
      "command": "compare-cli",
      "args": ["mcp"]
    }
  }
}
```

### Part 2: CLI Message Commands

New `messages` subcommand group, backed by a core library module for reading/writing `.git/compare/agent-messages.json`.

```
compare-cli messages send "feedback text"          # Append a message
compare-cli messages send --context hunk:id "text" # With hunk context
compare-cli messages list --format json            # List pending messages
compare-cli messages check --format context        # Output as context text, then clear
compare-cli messages clear                         # Clear all messages
```

Message file format (`.git/compare/agent-messages.json`):

```json
{
  "messages": [
    {
      "id": "uuid",
      "from": "compare-desktop",
      "timestamp": "2026-01-28T12:00:00Z",
      "content": "The error handling in src/app.rs is missing a catch block",
      "context": { "hunk_id": "src/app.rs:abc123" }
    }
  ]
}
```

### Part 3: Hook + Configuration

`.claude/hooks/compare-context.sh`:

```bash
#!/bin/bash
compare-cli messages check --format context 2>/dev/null
```

`.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/compare-context.sh"
          }
        ]
      }
    ]
  }
}
```

### Part 4: Compare Desktop / Mobile UI (future)

- Add a message input in the review UI for sending feedback to Claude Code
- Call `compare-cli messages send` via Tauri command
- Mobile: new sync server endpoint relays messages from mobile -> desktop -> file
- Optional: show Claude Code activity status by checking session file mtimes

## Key Technical Details

### Claude Code extensibility points used

| Mechanism                 | What we use it for                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------- |
| **MCP Server**            | Claude Code -> Compare: reading state, writing approvals                                |
| **UserPromptSubmit hook** | Compare -> Claude Code: injecting pending messages as context                           |
| **CLI**                   | Intermediary for both directions (messages, MCP tool backends)                          |
| **File system**           | Message bus (`.git/compare/agent-messages.json`) + state sync (`.git/compare/reviews/`) |
| **File watcher**          | Compare picks up changes made by MCP server                                             |

### What Claude Code can NOT do

- No way to push messages into a running terminal session
- No PID/lock files to detect active sessions (use file mtime heuristic instead)
- CLAUDE.md instructions are not reliable enough for critical behaviors (use hooks)
- MCP servers cannot proactively trigger Claude Code to take action

### Files to create/modify

| File                                   | Change                                      |
| -------------------------------------- | ------------------------------------------- |
| `compare/src/cli/commands/mcp.rs`      | **New**: MCP server implementation          |
| `compare/src/cli/commands/messages.rs` | **New**: Message CLI commands               |
| `compare/src/review/messages.rs`       | **New**: Core message read/write/clear      |
| `compare/src/cli/mod.rs`               | Add `Mcp` and `Messages` to `Commands` enum |
| `compare/src/cli/commands/mod.rs`      | Register new modules                        |
| `.claude/settings.json`                | MCP server + hook configuration             |
| `.claude/hooks/compare-context.sh`     | **New**: One-line hook script               |
