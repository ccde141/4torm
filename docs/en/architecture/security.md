# Security and Isolation

4torm runs locally but retains file boundaries, dangerous-tool restrictions, and sensitive-data isolation to reduce accidental damage and configuration leaks.

## Execution Permissions

An agent has **Project** or **Unrestricted** permission, applied automatically to built-in file tools in every workspace.

- **Project** permits the 4torm project and current execution workspace. The workspace may be outside 4torm; other unconfigured external paths are denied.
- **Unrestricted** permits built-in file tools to access any path.

Convection supplies the meeting workspace, Cyclone the workshop directory, Tradewind the workflow workspace, and Monsoon and Tide the configured agent workspace.

Both levels prevent ordinary file tools from rewriting agent registries, Tide task tables, and workflow control files. Agent memory, conversations, and normal workspace files are not part of this control-plane restriction.

Path checks resolve relative and absolute paths and symbolic links. A boundary violation fails the tool call and reports the error in its existing card without an extra confirmation dialog.

These permissions automatically constrain only built-in file tools. `run_command` can change directory after starting in the workspace; MCP tools and custom executors follow their own implementation and do not inherit the file path guard.

## Dangerous Tools

Write, edit, delete, and command tools are marked dangerous for capability identification and workspace restrictions, not per-call confirmation.

- Agent permission controls built-in file paths.
- Cyclone `plan` rooms expose read-only tools.
- `run_command` rejects selected high-risk system commands and limits maximum runtime.

## Sensitive Data

Most runtime data is excluded by `.gitignore`, especially secrets:

- `data/providers.json` — model-provider API keys;
- `data/mcp/servers.json` — MCP configuration and possible credentials; and
- `data/agents/`, `data/cyclone/`, `data/convection/sessions/`, `data/tradewind/`, and `data/tide/` — agent registries, conversations, workspaces, and runs.

See [Data Layout](./data-layout) for the complete boundary. Git exclusion is not encryption or backup.
