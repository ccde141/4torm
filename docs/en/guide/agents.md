# Console and Agent Management

## What Is the Console?

The Console is the management entry point for every agent. Agents created here persist and can be reused in Monsoon conversations, Convection meetings, Cyclone workshops, Tradewind workflows, and Tide automation. You configure one agent—not a temporary role tied to one conversation.

Each agent card shows its role, default model, workspace, and current status. Summary counts and custom labels help with filtering but do not change agent capabilities.

If an agent's model becomes unavailable—for example, because its provider was deleted—the card displays an error state. The agent and its data remain intact and can be used again after a valid model is assigned.

![Agent overview in the Console](/images/guide/agent-console-overview.webp)

## Create an Agent

Select **Create Agent** in the upper-right corner. You do not need to configure every capability immediately; use the settings button on the agent card to change them later.

- **Name** is how the agent appears throughout the app.
- **Role** is a short UI label such as “Programmer” or “Research Organizer.” It does not affect behavior.
- **Description** explains the agent's responsibility and helps distinguish similar agents.
- **Category labels** are only Console filters. They are not included in prompts and do not change execution.

The avatar accepts any image file up to 20 MB. Before saving, 4torm centers and crops it into a 256px WebP; removing it restores the name-initial fallback. Avatars appear in the Console, Monsoon, and Convection. Cyclone, Tradewind, and Tide keep their own initials or workspace markers instead of using agent avatars.

The default model is used unless a workspace overrides it. Choose one explicitly; if left empty, 4torm uses the first registered model.

The **role prompt** controls how the agent understands its identity and work. The role shown on its card is only display metadata.

If the workspace is left empty, 4torm creates a private directory for the agent.

Execution permissions are stored with the agent and automatically applied whenever built-in file tools run. Shared workspaces used by Convection, Cyclone, and Tradewind are added to the allowed scope. See [Security and Isolation](../architecture/security).

## Configure Tools and Skills

Tools determine what an agent can execute; skills provide reusable methods and knowledge. They are configured independently, and a skill may include dedicated tools.

![Agent configuration](/images/guide/agent-configuration.webp)

Built-in framework tools are enabled for new agents by default, allowing file access, command execution, and web lookup. Disable them manually if the agent should only converse.

Some capabilities belong to a workspace rather than the agent's Console tool list. Monsoon and Cyclone seat conversations can ask the human and delegate to SubAgents. Tradewind agent nodes can delegate but cannot ask the human mid-run. Convection, Tide, and Cyclone group rooms do not provide SubAgents.

Cyclone `contact`, `dispatch`, and bulletin-board capabilities, along with taskboards in Monsoon and Cyclone, are also controlled by their workspaces. Moving between workspaces does not modify the agent's saved tool configuration.

Tool selection follows these rules:

- After saving, the selection is the agent's local tool set; unselected tools are unavailable.
- **Custom and MCP tools are not enabled by default and must be selected explicitly.**
- Tools bundled with a skill are added with that skill and need not be selected again globally.

Installed skills are enabled for new agents by default and can be disabled before saving. A skill's `SKILL.md` is not permanently placed in conversation context. The agent calls `use_skill` to load it when needed; this remains available while the skill is enabled.

A warning beside a tool name only indicates that it can write or delete files, run commands, or perform similarly consequential actions. It does not mean every call displays another confirmation prompt.
