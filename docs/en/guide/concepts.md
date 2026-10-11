# Core Concepts

In 4torm, an agent is a persistent collaborator. Monsoon conversations, Convection meeting rooms, Cyclone seats, Tradewind workflows, and Tide tasks are different places where it can work. Understanding who is working, where the work takes place, and which capabilities are available helps distinguish what persists from what belongs to a particular task.

## Agents and Workspaces

You can create an agent in the console and configure its default model, role prompt, tools, skills, memory, and workspace. The same agent can work across multiple areas without being recreated for each task.

Each place keeps its own content. Two Monsoon conversations with the same agent remain separate; a Cyclone seat keeps its own private chat; a Convection meeting room keeps its public discussion; and Tradewind saves workflows and run results. Moving to another place does not bring the entire previous conversation along. Provide the relevant background there, or ask the agent to read records it can access.

A place may also give an agent a task-specific role or shared directory. A Cyclone seat can have its own role instructions, while meeting rooms and workflows have their own workspaces. These settings do not change the agent's base configuration in the console.

Monsoon team members are different: the main agent creates them for the current conversation, and they do not appear in the console's agent list. A member has its own conversation context and can receive further assignments. The main agent must supply the necessary background and check and integrate the member's reports.

## Tools, Skills, and MCP

**Tools** let an agent read information, modify files, run commands, and collaborate. You can choose which tools to enable for an agent in the console.

**Skills** store reusable knowledge and working methods. You can enable them for an agent in the console. The agent reads a skill's instructions when needed, instead of loading all of them into every conversation. A skill can also include dedicated tools. You can create skills yourself, or an agent can register them.

**MCP** connects external tool services. After connecting a service, you can select its tools for an agent in the console. What an agent can do when calling them depends on the capabilities and configuration of that external service.

## Workspaces and Execution Permissions

An agent has a default workspace. Meeting rooms, workshops, and workflows can also provide shared workspaces. When referring to a file, specify which workspace it belongs to so that identical filenames do not cause confusion.

Execution permissions have two levels: **Project** and **Unrestricted**. Project lets built-in file tools access the 4torm project and the current workspace; Unrestricted lets them access other paths. Framework-managed data must still be changed through the corresponding feature entry points. This setting constrains only built-in file tools. Commands, custom tools, and MCP tools operate according to their own capabilities.

## Activity Records and Memory

An agent's console card and details help you find recent activity. The full content remains in the area where the work took place. Older activity may no longer appear in the current conversation. When needed, tell the agent what happened and roughly when, and ask it to search the saved records.

**Long-term memory** belongs to an agent and preserves preferences, agreements, and experience that remain useful across tasks. It is not a complete conversation record; information is not automatically written to memory merely because it appeared in a conversation. Each agent has its own memory.

Starting work, receiving a successful tool response, or getting a team member's report does not mean the overall goal is complete. To confirm the outcome, check the run status and actual deliverables in the relevant area. You can also continue observing work that is still running there.

To get started, see [Monsoon Chat](../modes/chat), [Convection Meeting Rooms](../modes/convection), [Cyclone Workshops](../modes/cyclone), [Tradewind Workflows](../modes/tradewind), or [Tide Automation](../modes/tide).
