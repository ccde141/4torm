# Data Layout

4torm stores agent configuration, conversations, tasks, workflows, and run records under the project's `data/` directory. Some active state exists only in the server process. Agent workspaces may also point outside the project and must be backed up separately.

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
│       ├── sessions/
│       │   ├── _index.json
│       │   ├── {sessionId}.json
│       │   ├── {sessionId}.taskboard.json
│       │   └── {sessionId}.attachments/
│       └── sessions-tide/{taskName}_{taskId}/
│           ├── _index.json
│           ├── {sessionId}.json
│           └── bak/
├── convection/sessions/
│   ├── _index.json
│   ├── {sessionId}.json
│   └── {sessionId}/workspace/bak/
├── cyclone/
│   ├── _index.json
│   └── {workshopId}/
│       ├── meta.json
│       ├── workspace/
│       ├── bulletin.json
│       ├── bulletin-history.json
│       ├── seats/{seatId}.json
│       ├── seats/{seatId}.taskboard.json
│       ├── rooms/{roomId}.json
│       ├── dispatches/{dispatchId}.json
│       └── bak/
├── tradewind/
│   ├── workflows/{workflowId}/
│   │   ├── graph.json
│   │   ├── meta.json
│   │   ├── profiles.json
│   │   └── workspace/
│   └── runs/{workflowId}/{executionId}/
│       ├── meta.json
│       ├── events.jsonl
│       ├── output.json
│       ├── nodes/{nodeId}/messages.json
│       └── meetings/
├── tide/
│   ├── tasks.json
│   ├── tasks.template.json
│   └── runs/{taskId}/{timestamp}.json
├── tools/
│   ├── registry.json
│   └── executors/
├── skills/{skillId}/
│   ├── config.json
│   ├── SKILL.md
│   ├── tools.json
│   └── executors/
├── mcp/servers.json
├── runtime/execution-observations.json
├── providers.json
├── providers.template.json
├── labels.json
├── skin-config.json
└── skin-textures/
```

New agents may still receive `.workspace/MEMORY.md`, but current long-term memory uses the index and entries under `memory/`; `MEMORY.md` is no longer read as memory.

## Process-Only State

The server primarily keeps these in memory:

- current agent activity and workspace location;
- unpersisted live tokens, reasoning, and temporary tool progress;
- SSE connections and pending write queues;
- active MCP connections; and
- Tide scheduler timers.

These are rebuilt after restart. Persisted conversations, tasks, and run records remain independently readable.

Visible background-command observations are stored in `data/runtime/execution-observations.json` so taskboards can reappear after refresh. Actual execution handles remain process-only. After restart, unfinished observations are marked interrupted; commands are not resumed.

## Git Tracking Boundary

The following are excluded by default:

| Path | Content |
|------|---------|
| `data/providers.json` | Provider endpoints and API keys |
| `data/agents/` | Agent settings, memory, conversations, workspaces |
| `data/labels.json` | Custom labels |
| `data/skin-config.json`, `data/skin-textures/` | UI settings and imported images |
| `data/mcp/servers.json` | MCP settings and possible secrets |
| `data/runtime/` | Local execution observations |
| `data/convection/sessions/` | Convection meetings |
| `data/cyclone/` | Cyclone workshops |
| `data/tradewind/workflows/`, `data/tradewind/runs/` | Workflow definitions, files, and runs |
| `data/tide/tasks.json`, `data/tide/runs/` | Tide tasks and history |
| user directories under `data/skills/` | Installed or created skills |

Provider and Tide templates, framework tool catalogs and executors, and built-in skills remain tracked. `data/tools/registry.json` and user executors are local and ignored.

Git exclusion controls commits; it does not create backups.

## Backup and Migration

For a complete backup preserve:

1. the entire `data/` directory;
2. external workspaces referenced by agent configuration; and
3. data managed independently by MCP Servers.

For one workspace, copy its directory—for example `data/cyclone/` or `data/tradewind/`. Shut down 4torm normally before copying so files do not change mid-transfer. Restore the original directory hierarchy before startup.

## Writes and Recovery

Framework-managed JSON and text state is generally written to a unique temporary file and then atomically replaces the target. Startup removes leftover framework temporary files from control directories.

Atomic replacement prevents partially written target files; it does not replace backups. Unsaved model output, tool progress, and process-only state may still be lost on forced exit.
