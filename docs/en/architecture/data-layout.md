# Data Layout

4torm stores agent configuration, conversations, tasks, workflows, and run records in the backend's data directory. This defaults to the project's `data/` directory and can be changed for an independent deployment. Some active state exists only in the server process. Agent workspaces may also point outside the project and must be backed up separately.

## Data Types

| Type | Content | Main writer |
|------|---------|-------------|
| Control data | Agent/tool registries, Tide tasks, workflow definitions | Console, dedicated page, or API |
| Conversation data | Monsoon, meetings, seats, taskboards | Owning workspace |
| Run records | Tradewind, Tide, dispatch, execution observations | Server execution |
| Workspace files | Documents, code, and other agent output | Human or file tools |
| Personal configuration | Providers, MCP, labels, UI settings | Management pages |

Built-in file tools cannot rewrite primary control data. Workspace files follow the agent's execution permission.

## Directory Structure

Directories appear only after their features are used.

```text
data/
├── agents/
│   ├── registry.json
│   └── {agentId}/
│       ├── .workspace/
│       │   ├── role-prompt.md
│       │   ├── config.json
│       │   └── ...agent workspace files
│       ├── memory/
│       │   ├── index.md
│       │   └── {memorySlug}.md
│       ├── profile/
│       │   └── avatar.webp       # agent avatar
│       ├── sessions/
│       │   ├── _index.json
│       │   ├── {sessionId}.json
│       │   ├── {sessionId}.taskboard.json
│       │   └── {sessionId}.attachments/
│       └── sessions-tide/task-{taskIdHash}/
│           ├── _index.json
│           ├── {sessionId}.json
│           └── bak/
├── monsoon/runs/                # run status and recovery records
├── convection/
│   ├── runs/                    # meeting run status and recovery records
│   └── sessions/
│       ├── _index.json
│       ├── {sessionId}.json
│       └── {sessionId}/workspace/bak/
├── cyclone/
│   ├── _index.json
│   ├── runtime/                 # seat, room, and supervisor run history
│   └── {workshopId}/
│       ├── meta.json
│       ├── organization.json    # groups, seat positions, cross-group relations, organization revision
│       ├── workspace/
│       ├── bulletin.json
│       ├── bulletin-history.json
│       ├── supervisor.json      # single conversation and project memory
│       ├── supervisor-inbox.json
│       ├── supervisor.taskboard.json
│       ├── seats/{seatId}.json
│       ├── seats/{seatId}.memory.json
│       ├── seats/{seatId}.taskboard.json
│       ├── rooms/{roomId}.json
│       ├── dispatches/{dispatchId}.json
│       ├── contacts/{contactId}.json
│       └── bak/                 # archives and retired-seats/ snapshots
├── tradewind/
│   ├── workflows/{workflowId}/
│   │   ├── definition.json
│   │   ├── profiles.json
│   │   └── workspace/
│   └── runs/{workflowId}/{executionId}/
│       ├── meta.json
│       ├── graph-snapshot.json
│       ├── events.jsonl
│       ├── output.json
│       ├── nodes/{nodeId}/messages.json
│       └── meetings/
├── tide/
│   ├── tasks.json
│   ├── tasks.template.json
│   ├── runtime/                 # run state, usage, and compaction progress
│   └── runs/{taskId}/{timestamp}-{runId}.json
├── tools/
│   ├── registry.json
│   └── executors/
├── skills/{skillId}/
│   ├── config.json
│   ├── SKILL.md
│   ├── tools.json
│   └── executors/
├── mcp/
│   ├── servers.json
│   └── media/                   # tool images; conversations store references
├── runtime/
│   ├── compaction/               # completed summary fragments, bound to scope, model, and source
│   └── execution-observations.json
├── providers.json
├── providers.template.json
├── transport/                   # local backend HTTPS certificate and key
├── labels.json
│   Legacy Agent category labels; not read or written by this version
├── skin-config.json
└── skin-textures/
```

## Current Input Preview

The `currentInput` field in conversation reads is a read-only estimate of the effective model context. It does not enter request ledgers or accumulated costs. Each feature owns its context assembly, compaction boundaries, and scope. Previews reuse provider request compilation; unavailable configuration produces an explicitly marked canonical approximation. Edits, deletions, compaction, and model changes invalidate the previous preview and trigger a new calculation.

## Backup and Migration

For a complete backup preserve:

1. the entire `data/` directory;
2. external workspaces referenced by agent configuration; and
3. data managed independently by MCP Servers.

Feature records live in directories such as `data/cyclone/` or `data/tradewind/`. Copying one directory transfers those records; resuming work in a new environment also requires its referenced pooled Agents, providers, tools, skills, and external workspace files. Use the checklist above for a complete migration. Shut down 4torm normally before copying so files do not change mid-transfer, and restore the original hierarchy before startup.

Preserve `data/mcp/media/` when moving conversations containing MCP tool images; their references cannot resolve without the files. Seat configuration and binding history lives in each seat's main file, while memory changes live in its `.memory.json`. Older Tide directory names and run records without a `runId` may still exist; preserve them alongside the current layout.
