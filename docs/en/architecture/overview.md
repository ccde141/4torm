# Architecture Overview

4torm separates the React interface, Fastify API and execution engine, Electron shell, and local runtime data. Collaboration workspaces share stable agent, model, tool, and streaming protocols without directly owning one another's internal state.

## Runtime Components

| Component | Responsibility |
|-----------|----------------|
| React + Vite | Console and workspace interfaces, local view state, SSE consumption |
| Fastify | HTTP/SSE routes, persistence, task execution, scheduling, and recovery |
| Shared engine | Model requests, message normalization, tool assembly, streaming events, and common execution rules |
| Workspace engines | Monsoon, Convection, Cyclone, Tradewind, and Tide business flows |
| Electron | Desktop window, managed server lifecycle, native paths, and execution windows |
| `data/` | Local configuration, conversations, workflows, runs, and workspaces |

The browser normally reaches Fastify on port `3001`. During development Vite runs on `5173` and proxies API traffic; production Fastify serves the built frontend and documentation itself.

## How an Agent Task Runs

1. A workspace route validates the request and locates the persistent agent and current context.
2. The engine assembles the role prompt, conversation history, recalled memory, model settings, enabled tools, skill tools, and workspace-specific system capabilities.
3. The provider adapter sends the normalized request to the configured model protocol.
4. Generated text, reasoning, tool calls, and state changes stream over SSE.
5. Tool calls enter the shared executor with the current workspace and execution permission context.
6. The workspace engine records durable messages and final state through its own persistence boundary.

Feature routes adapt protocols; business flows live under `server/src/engine/`; shared model and tool behavior belongs under `server/src/engine/shared/`; storage, scheduling, runtime observation, and execution infrastructure belong under `server/src/services/`.

## Browser and Live State

The browser holds drafts, panel selections, and temporary stream presentation. The server remains the source of truth for persisted conversations, run records, queues, and active server-managed work.

SSE transports live output rather than acting as durable storage. Once a final message or run state is persisted, pages reload it through normal APIs. Tokens, transient reasoning, and animations emitted only before a disconnect are not replayed.

## Background Execution

Monsoon and ordinary Cyclone seat conversations can detach eligible tools. Each execution remains bound to its originating conversation or seat; other contexts cannot inspect, wait for, or terminate it.

Agents use the execution ID to inspect, wait briefly, or terminate. Humans use the originating taskboard. Finished observations remain temporarily visible.

Actual execution handles live in the server process. Graceful shutdown terminates running background tools and waits for them; after a forced process exit, unfinished results cannot resume.

## Data and State

| Type | Examples | Storage |
|------|----------|---------|
| Configuration | Agents, providers, tools, skills, MCP, Tide tasks, workflows | JSON, Markdown, executor files |
| Conversations and runs | Monsoon, meetings, seats, Tradewind runs, Tide history | JSON or JSONL |
| Workspace files | Agent, room, workshop, and workflow output | Corresponding workspace |
| Runtime state | Activity locations, live output, queues, running tasks | Primarily server memory |

Control data should change through the Console, dedicated pages, or APIs. Built-in file tools cannot directly rewrite agent/tool registries, Tide task tables, or workflow control files. See [Data Layout](./data-layout) and [Security](./security).

## Page Refresh

Refreshing or closing a browser page does not stop Fastify. Server-managed background commands and Cyclone dispatches can continue. An interactive reply tied to the page's streaming connection may stop when that connection closes.

Reopening reloads persisted messages and states and, where supported, synchronizes active server work. Previously emitted transient tokens, reasoning, and animations are not replayed; persisted final results are.

## Shutdown and Restart

On a normal exit, the server stops Tide scheduling and Tradewind execution, terminates background tools, waits for Tide runs, Cyclone dispatches, background work, and atomic write queues, then disconnects MCP and closes. Drain time is capped at ten seconds.

A forced exit or power loss skips draining. Files already atomically replaced remain valid, but unsaved live output and current results may be lost.

At startup, the server:

- removes leftover framework temporary files;
- releases stale agent activity locks;
- marks unfinished Tradewind runs `crashed`;
- marks interrupted Cyclone dispatches failed and continues those not yet started;
- reconnects enabled MCP Servers; and
- restarts the Tide scheduler.

Agent activity locations are process-local and return to idle. Tide tasks do not run while 4torm is closed.

## Developer Entry Points

| Change | Primary location |
|--------|------------------|
| UI and interaction | Feature `ui/`, shared components, and stores under `src/` |
| HTTP and SSE | `server/src/routes/` |
| Workspace execution | `server/src/engine/` |
| Shared model/tool protocols | `server/src/engine/shared/` |
| Tool execution, runtime state, storage, scheduling | `server/src/services/` |
| Desktop bridge | `electron/` |
| Runtime data | `data/` |
| Documentation | `docs/` |

Start UI issues in the relevant feature UI/store; status-code issues in routes; conversation behavior in the relevant engine; tool/background issues in services and tool routes; persistence issues in stores, `data-paths`, `atomic-io`, and startup recovery; MCP issues in its page, routes, and manager; restart issues in `startup-recovery` and `graceful-shutdown`.

## Code Layout

```text
4torm/
├── src/                     frontend, feature UI, stores, model adapters
├── server/src/
│   ├── routes/              HTTP and SSE adapters
│   ├── engine/              workspace and shared agent execution
│   ├── services/            tools, runtime state, storage, scheduling
│   ├── config/              development and logging policy
│   ├── types/
│   └── utils/
├── electron/                desktop main process and preload bridge
├── docs/                    VitePress sources
├── public/                  static assets
└── data/                    local runtime data
```

Tests normally sit beside their modules as `.test.ts` or `.test.mjs` files.
