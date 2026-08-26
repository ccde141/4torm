# MCP · External Tool Integration

MCP connects external tool services to 4torm, giving agents access to search, browsers, databases, and other applications without implementing every capability as a local tool.

Three transports are supported:

- **stdio**: 4torm launches a local MCP Server process and communicates over standard input and output.
- **Streamable HTTP**: connects to a modern remote MCP Server URL.
- **SSE**: supports older remote MCP Servers that still use SSE transport.

4torm currently integrates MCP tools, not MCP Resources or Prompts. Remote services may use fixed tokens or API keys in custom headers; OAuth login flows are not currently supported.

Connecting a server does not give its tools to every agent automatically. Open each agent's configuration and select either all tools from that service or individual tools. Calls look like local tool calls to the agent, but actual capability, data access, and execution are controlled by the MCP Server.

## Add an MCP Server

Open MCP from the sidebar, select **Add**, choose a transport, and enter its configuration. The service name identifies it on the page and groups its tools for agents; it cannot be renamed after creation.

For local **stdio**, enter the launch command and add arguments in order. Each item is one complete argument and retains its spaces. Environment variables and a working directory are optional.

For **Streamable HTTP** or **SSE**, enter the service URL and add any fixed token, API key, or other required request headers individually.

Existing configurations can be imported as JSON, either as a single entry or several entries wrapped in `mcpServers`. A batch is saved only when every entry is valid and no names conflict.

After saving, a server is enabled and connection begins immediately. A successful card shows the discovered tool count. Failure preserves the configuration and reports the error. There is no automatic retry; correct the configuration and reconnect manually.

## Manage MCP Servers

![MCP Server management](/images/extend/mcp-server-management.webp)

Each card shows its transport, command or URL, and connection state. Discovered tool counts appear after connection. Disabled or failed services provide no tools to agents.

Turning a server off disconnects it while preserving both its configuration and agents' existing tool selections. Enabling it reconnects and reads the tool list again.

**Edit** changes the transport configuration but not the service name. Saving an enabled service reconnects with the new settings.

**Reconnect All** reconnects every enabled service. Unexpected disconnects and failed connections are not retried automatically; inspect the service or correct its settings, then reconnect manually.

Deleting a server removes its configuration, disconnects it, and makes its tools unavailable immediately.

## Select MCP Tools for an Agent

After a server connects, open an agent in the Console. Its tool section groups discovered MCP tools by service name.

Select individual tools or use **Select All** for every tool currently listed. Neither new nor existing agents receive MCP tools merely because the server is connected; selection is always explicit.

**Select All** covers only tools discovered at that moment. If the server adds tools later, return to agent settings and select them separately.

Saved changes apply on the agent's next execution. If the server disconnects, selections remain stored but cannot be used until reconnection.

## Configuration File

Server configuration is stored in `data/mcp/servers.json`. The file is excluded from Git because environment variables and headers may contain tokens or API keys. Git exclusion is not a backup; preserve it separately when moving environments.

The MCP page is the normal management entry point. Developers may also edit the file directly; a running 4torm process reloads changes.

```jsonc
[
  {
    "name": "local-tools",
    "enabled": true,
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "some-mcp-package"],
    "env": {},
    "cwd": "/path/to/server"
  },
  {
    "name": "remote-tools",
    "enabled": true,
    "transport": "streamable-http",
    "url": "https://example.com/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_TOKEN"
    }
  }
]
```

SSE uses the same `url` and `headers` fields as remote HTTP; set `transport` to `sse`.

## Management API

All endpoints begin with `/api/mcp`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/list` | Read configurations, connection states, and tool counts |
| `POST` | `/add` | Add and connect a server |
| `POST` | `/update` | Update a server's connection configuration |
| `POST` | `/import` | Import parsed server configurations in bulk |
| `POST` | `/remove` | Delete a server |
| `POST` | `/toggle` | Enable or disable a server |
| `POST` | `/reconnect` | Reconnect one server, or every enabled server when no name is supplied |
| `GET` | `/tools` | List currently discovered tools grouped by service |

Add and update use the server structures above. Bulk import accepts `{ "configs": [...] }`. Remove, toggle, and targeted reconnect identify the server by name.

## Capability Boundaries

4torm controls whether an MCP tool is offered to an agent; it does not restrict the MCP Server's own permissions. File, account, and remote-data access depend on that service's configuration. Local-tool workspace boundaries do not automatically apply to MCP Servers.

Text returned by MCP tools can be passed to agents. Non-text results such as images and audio are not silently discarded, but currently produce an explicit unsupported-result message instead of becoming model input.
