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
│       ├── profile/
│       │   └── avatar.webp       # agent avatar
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
│       ├── organization.json    # groups, seat positions, cross-group relations, organization revision
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

## Backup and Migration

For a complete backup preserve:

1. the entire `data/` directory;
2. external workspaces referenced by agent configuration; and
3. data managed independently by MCP Servers.

For one workspace, copy its directory—for example `data/cyclone/` or `data/tradewind/`. Shut down 4torm normally before copying so files do not change mid-transfer. Restore the original directory hierarchy before startup.
