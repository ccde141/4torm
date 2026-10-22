# Tools · Usage and Development

Tools determine which real operations an agent can perform. A local tool combines a definition—which tells the model when to call it and with which arguments—with an executor that actually reads files, runs commands, or reaches external services.

Global tools, skill tools, and MCP tools all enter an agent's available tool set, but have different sources and management paths.

## Using Tools

Enable tools in the Console agent configuration. New agents select framework tools by default. Custom and MCP tools require explicit selection; tools bundled with enabled skills are added automatically.

A dangerous marker identifies write, delete, or command capability and supports restrictions such as Cyclone `plan` mode. It does not imply a confirmation prompt before every call.

## Built-In Tools

| Tool | Purpose |
|------|---------|
| `read_file` | Read file content |
| `write_file` | Create or overwrite a file |
| `edit_file` | Replace exact file content |
| `delete_file` | Delete files or directories |
| `list_directory` | List directory content |
| `search_content` | Search files recursively |
| `run_command` | Run a command in the current workspace |
| `webfetch` | Fetch web or API text |
| `webfetch_advanced` | Fetch dynamic pages through a browser |
| `use_skill` | Load enabled skill instructions on demand |

Feature-owned capabilities such as `ask`, taskboards, the Monsoon session team, and `delegate` in supported workspaces are not global tools. Framework definitions live in `server/src/tools/framework/catalog.json`, are read-only in the Tools page, and cannot be replaced by user definitions.

## Create and Manage Tools

![Global tool registry](/images/extend/tool-registry-current.png)

Use **Register Tool** to provide a stable unique name, purpose, JSON Schema arguments, dangerous marker, execution lifecycle, and either a command template or custom JavaScript executor.

- **Synchronous** waits for the executor and suits short work or executors that cannot stop safely.
- **Detachable** allows long work to move into the background after the synchronous window. Use it only when the executor handles cancellation and safely stops child processes, requests, and timers.

Definition edits apply the next time an agent assembles its tool set. Deleting a definition removes registration but not executor files or historical records.

### Tools Created by Agents

Agents in Monsoon and ordinary Cyclone seat conversations can create JavaScript executors and definitions, then submit a registration request. Creating from scratch requires file-write capability.

4torm validates the name, schema, executor, and collisions with global and skill tools, then asks for confirmation in the current conversation. The global registry is unchanged until approval.

Registration exposes the tool in management and agent settings but does not add it to existing agents. Enable it explicitly. Tide, Tradewind, Convection, Cyclone rooms, assistant chats, and unattended communication turns cannot register tools.

Use the Tools page or agent registration flow instead of editing the control-plane file `data/tools/registry.json` directly.

### Minimal Creation Flow

1. Choose a name beginning with a lowercase letter, containing only lowercase letters, digits, and underscores, up to 64 characters.
2. Create `data/tools/executors/{executorFile}.js`.
3. Define the description, dangerous marker, and parameter schema.
4. Confirm that the executor loads, then register the definition.
5. Enable the registered tool for relevant agents.

Agent registration uses `register_tool`:

```json
{
  "name": "word_count",
  "description": "Count characters and lines in a text file",
  "dangerous": "false",
  "executionMode": "sync",
  "executorFile": "word_count",
  "parameters": "{\"type\":\"object\",\"properties\":{\"filePath\":{\"type\":\"string\"}},\"required\":[\"filePath\"]}"
}
```

`executorFile` omits `.js`; `parameters` is a serialized JSON Schema string. `executionMode` is `sync` or `detachable`. Missing executors, invalid schemas or lifecycles, and duplicate names are rejected.

## Tool Definitions

Parameters use JSON Schema. Fields listed in `required` must be supplied; all others are optional. Descriptions are shown directly to the model and should state formats, units, and valid scope precisely.

```json
{
  "name": "word_count",
  "description": "Count characters and lines in a text file",
  "category": "custom",
  "dangerous": false,
  "executorType": "custom",
  "executorFile": "word_count",
  "executionMode": "sync",
  "parameters": {
    "type": "object",
    "properties": { "filePath": { "type": "string" } },
    "required": ["filePath"]
  }
}
```

## Executor Types

### Built-In Executors

Framework executors provide file, command, web, and skill-loading capabilities and normally require no changes.

### Command Templates

Templates interpolate `{{parameter}}` directly into a shell command:

```json
{ "name": "curl_fetch", "executorType": "template", "executorTemplate": "curl -s {{url}}" }
```

They start in the current workspace and have a 15-second limit. Because arguments enter the command string directly, templates suit bounded short operations, not arbitrary external input, large downloads, or complex scripts.

### Custom JavaScript

Custom executors live at `data/tools/executors/{executorFile}.js` and default-export an async function:

```javascript
export default async function (args, ctx) {
  return 'execution result'
}
```

Return a string or `{ result, meta }`. `result` enters model context; `meta` is display-only. Modified executor files reload on the next call without restarting 4torm.

## Long-Running Work

`run_command` supports ordinary builds, installation, and downloads. Its default timeout is two minutes; `timeout` accepts `1000`–`600000` milliseconds.

In Monsoon and ordinary Cyclone seat conversations, commands still running after roughly three seconds return an execution ID and continue in the background. Agents can inspect, wait up to 30 seconds, or terminate them; humans can watch and stop them from the taskboard.

A detachable custom executor must listen to `ctx.signal` and report incremental output with `ctx.onOutput`. It is not subject to the command-template 15-second limit. Other workspaces and MCP tools retain their synchronous behavior.

## Executor Context

```typescript
{
  dataDir: string
  workspaceDir: string
  projectDir: string
  sandboxLevel: 'project' | 'unrestricted'
  signal?: AbortSignal
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void
}
```

`dataDir`, `workspaceDir`, and `projectDir` identify local data, the active workspace, and project root. `sandboxLevel` carries the agent's permission. `signal` fires on turn stop, manual background termination, or shutdown; detachable executors must use it to stop their resources. `onOutput` streams output into the execution window.

Built-in file tools validate paths, resolving relative paths from the workspace. Project permission allows the project and workspace; unrestricted permission permits other paths. `run_command` and templates start in the workspace but do not use the file-tool path guard.

Write, edit, and delete tools protect agent, tool, Tide, and workflow control files; workflow `workspace/` files remain writable.

Custom executors are trusted local code and do not gain path restrictions merely by receiving `ctx`. File tools should call the shared guard:

```javascript
import { resolvePath } from './_resolve.js'
const file = resolvePath(args.filePath, ctx, { write: true })
```

`{ write: true }` also protects framework control data. Executors that bypass `resolvePath` own their path and write boundaries.

## Skill Tools

Skills may bundle `tools.json` and `executors/`. Their executors load from the skill first, then fall back to the global executor directory. Avoid duplicate names across global tools and skills. See [Skills](./skills).

## MCP Tools

MCP tools come from external services and use neither the local registry nor JavaScript executors. Select them explicitly for agents. Names use `mcp:service:tool` to avoid collisions. See [MCP](./mcp).

## Storage and API

```text
server/src/tools/framework/catalog.json  # read-only framework catalog
data/tools/registry.json                 # local custom definitions
data/tools/executors/{executorFile}.js
```

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/tools/catalog` | Merge framework and custom catalogs |
| `PUT` | `/api/tools/custom` | Save custom tools; framework overrides are rejected |
| `POST` | `/api/tools/exec` | Execute a local tool |

Taskboard execution observation uses separate APIs and is not part of tool registration. Core implementation lives in the framework catalog, `custom-registry.ts`, `tool-defs-loader.ts`, `tool-executor.ts`, tool routes, and the frontend tool store.
