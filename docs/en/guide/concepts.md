# Core Concepts

Every collaboration mode in 4torm shares the same foundations. Understanding agents, tools, skills, MCP, memory, and execution permissions explains how the five workspaces operate together.

## Agent · Persistent Entity

An agent is 4torm's basic unit of work: a long-term identity reused across workspaces. Each agent has:

- a **role prompt** (`role-prompt.md`) defining identity, responsibilities, and working style;
- a **model configuration** selecting the model, provider, temperature, and related parameters;
- a **tool list** controlling which tools it can call;
- a **skill list** providing expertise and methods loaded on demand; and
- an **independent workspace** for long-lived files.

After creation, the same agent can join a Monsoon conversation today, enter a Tradewind workflow tomorrow, and later be awakened by a Tide task. Its base capabilities do not need to be configured again in each workspace.

## Tool

Tools perform real interactions with the environment, including file access, directory browsing, command execution, and web retrieval. Built-in tools come from a fixed server-side registry. Custom tools are stored in `data/tools/registry.json` and `data/tools/executors/*.js`.

## Skill

Skills preserve reusable expertise and working methods, primarily in `data/skills/{id}/SKILL.md`. Agents call `use_skill` to load instructions when needed, so every skill does not permanently consume conversation context. Skills may also include dedicated tools.

## MCP · External Capabilities

MCP (Model Context Protocol) connects external tool services. The MCP page supports stdio, Streamable HTTP, and compatible SSE connections for search, browsers, databases, and other services. After connecting, explicitly select the tools to enable in each agent's configuration.

## Long-Term Memory

Long-term memory belongs to an agent and persists across conversations and workspaces. In supported conversations, the system recalls entries relevant to the current task, and the agent can inspect, write, or update memory itself.

Merely including a conversation in context does not save it to memory, and memory is never shared between agents. Availability varies by workspace and role; see the relevant workspace guide for exact behavior.

## Streaming Output

Generated text, reasoning, tool calls, and delegated subtasks stream to the frontend over SSE (`text/event-stream`). Closing a conversation window does not interrupt the running task; reopen it to continue watching. Tradewind nodes and meeting-room nodes use the same live-status mechanism.

## Execution Permissions

Agents provide two permission levels:

- **Project**: built-in file tools can access the 4torm project and the current workspace. An explicitly configured workspace remains accessible even outside the project; other external paths are denied.
- **Unrestricted**: built-in file tools can access any path, for agents that need to work across directories.

At either level, ordinary file tools cannot directly rewrite the agent registry, Tide task table, or workflow control files. Those changes must go through the corresponding feature entry point or dedicated tool.

Execution permissions primarily constrain built-in file tools. Commands, MCP tools, and custom executors still operate with their own capabilities. See [Security and Isolation](../architecture/security).
