# MCP · External Tool Integration

MCP connects external tool services to 4torm, giving agents access to search, browsers, databases, and other applications without implementing every capability as a local tool.

Three transports are supported:

- **stdio**: 4torm launches a local MCP Server process and communicates over standard input and output.
- **Streamable HTTP**: connects to a modern remote MCP Server URL.
- **SSE**: supports older remote MCP Servers that still use SSE transport.

4torm currently integrates MCP tools, not MCP Resources or Prompts. Remote services may use fixed tokens or API keys in custom headers; OAuth login flows are not currently supported.

Connecting a server does not give its tools to every agent automatically. Open each agent's configuration and select either all tools from that service or individual tools. Calls look like local tool calls to the agent, but actual capability, data access, and execution are controlled by the MCP Server.

## Add an MCP Server

Open **MCP** under **Capabilities** in the sidebar, select **Add**, choose a transport, and enter its configuration.

The service name identifies it on the page and groups its tools for agents; it cannot be renamed after creation.

For local **stdio**, enter the launch command and add arguments in order. Each item is one complete argument and retains its spaces. Environment variables and a working directory are optional.

For **Streamable HTTP** or **SSE**, enter the service URL and add any fixed token, API key, or other required request headers individually.

Existing configurations can be imported as JSON, either as a single entry or several entries wrapped in `mcpServers`. A batch is saved only when every entry is valid and no names conflict.

After saving, a server is enabled and connection begins immediately. A successful card shows the discovered tool count. Failure preserves the configuration and reports the error. Health checks attempt to restore enabled connections about once a minute; manual reconnection is also available. Reconnection never replays previous tool calls.

## Manage MCP Servers

![MCP Server management](/images/extend/mcp-server-current.png)

Each card shows its transport, command or URL, and connection state. Discovered tool counts appear after connection. Disabled or failed services provide no tools to agents.

Turning a server off disconnects it while preserving both its configuration and agents' existing tool selections. Enabling it reconnects and reads the tool list again.

**Edit** changes the transport configuration but not the service name. Saving an enabled service reconnects with the new settings.

**Reconnect All** reconnects every enabled service. Background health checks also attempt recovery after unexpected disconnects. Disabled and deleted services stay disconnected. Recheck state after restoring a stateful service, and do not repeat an operation whose outcome is unknown.

Deleting a server removes its configuration, disconnects it, and makes its tools unavailable immediately.

## Select MCP Tools for an Agent

After a server connects, open an agent in the Console. Its tool section groups discovered MCP tools by service name.

Select individual tools or use **Select All** for every tool currently listed. Neither new nor existing agents receive MCP tools merely because the server is connected; selection is always explicit.

**Select All** covers only tools discovered at that moment. If the server adds tools later, return to agent settings and select them separately.

Saved changes apply on the agent's next execution. If the server disconnects, selections remain stored but cannot be used until reconnection.

Use **Refresh MCP tools** in agent settings to reload discovery. Returning to the tools page or focusing the window also refreshes it. Errors remain visible, and refresh never selects new tools for the agent. Paginated service inventories replace the previous list only after every page has been read successfully.

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

MCP arguments retain their JSON types, including numbers, booleans, arrays, and nested objects. Text and structured results reach the agent; images use separate media references rather than base64 in the result text.

When the model's image-input check reports support, subsequent requests include tool images. A tool result can save up to four images of 8 MiB each; a model request includes at most the two most recent tool images, up to 12 MiB combined. Older references remain in history, and compaction does not delete image files. With a cloud model, included images are sent to the selected provider.

Results explain unavailable or unconfirmed image support, invalid or oversized images, and missing files while retaining other text and metadata. Audio and other binary resources currently receive descriptive notices rather than becoming model input. Resource links are not downloaded automatically. Media-storage failures never automatically replay the tool.

Tool records include previews of saved images and links to their originals, scoped to the owning conversation or execution. Reloading an image only reads the saved file; it does not repeat capture or input tools. A visible frontend preview does not prove that a model received the image: model capability checks and the actual provider request still determine that.

Click an image preview to view the original image. The viewer provides **Open in new tab** and **Close image** buttons in the upper-right corner. You can also press **Esc** to exit. After closing the image, you can continue working in the window underneath.

If an image cannot be read, the viewer explains why and provides a **Reload image** button. If it says the image has been deleted or moved, check the file location first.

## Visual Desktop Example

The general loop is **capture → model chooses an action from the image → invoke the action tool → receive a new screenshot → model checks the result**. It uses the existing agent execution loop. The MCP service performs the operation, the Skill describes how to use it, and 4torm manages tool selection, execution, and image delivery.

For a separately installed `vision-desktop` project:

1. Install and check the service on the controlled Windows interactive desktop. A 4torm backend on the same Windows machine can launch its stdio service; use the command, arguments, and stop-file path supplied by that installation.
2. Import the MCP configuration and verify discovery of `desktop_list_windows`, `desktop_bind`, `desktop_observe`, `desktop_act`, `desktop_status`, and `desktop_stop`.
3. Install the project's portable Skill. For a guide-only package, run this from the 4torm source directory:

   ```sh
   npm run skill:install -- --source C:/tools/vision-desktop/skills/vision-desktop --data-dir ./data
   ```

   The installer creates 4torm metadata and preserves the guide. It does not overwrite an existing skill, install the desktop service, execute scripts, or grant MCP tools. Packages with executors need the separate [skill tool integration](./skills).
4. Enable the Skill and select its MCP tools for the agent. Choose a model with confirmed vision and tool-call support. Short tool names in the guide correspond to discovered names such as `mcp:service-name:desktop_observe`.
5. Start with a newly created practice window. Ask the model to read visible content, try one simple click, and verify the new screenshot. Connection success, accepted tool calls, and a human-visible preview are separate from actual model vision and input validation.

Hosts without MCP can provide ordinary tool adapters for the same execution layer, retaining JSON argument types, images, observation identifiers, and error semantics. Copying a Skill does not create executable tools. Describing an image also does not prove accurate coordinate selection.

`vision-desktop` currently provides local Windows stdio. Linux or Docker backends need a separate controlled relay or executor on the target Windows desktop; a Windows frontend alone does not supply one. Services with a single binding and observation state should have one active controlling conversation per instance. Serialized requests do not isolate conversation state. After disconnection, timeout, or cancellation, observe and establish the outcome before continuing instead of replaying clicks.
