# Console and Agent Management

## What Is the Console?

The Console is the management entry point for every agent. Agents created here persist and can be reused in Monsoon, Convection, Cyclone, Tradewind, and Tide. You configure one agent, not a temporary role tied to a conversation.

Each card shows the agent's name, role, current status, recent activity, default model, and workspace. The summary shows the total agent count, idle count, and conversation count. Select the whole card to open details and change its configuration.

Status and recent activity come from actual feature runs. If some activity cannot be read, the card indicates incomplete information. An unavailable model configuration is shown separately.

![Example agent cards in the Console](/images/guide/agent-console-current.png)

## View Agent Details

Select a card to open the detail window. Its navigation includes **Overview**, **Statistics**, **Configuration**, **Prompt**, **Tools**, **Skills**, and **Memory**.

- **Overview** shows the current state and recent attributable work. Select an item to inspect its feature, status, and available records. When there is a destination, you can open the original feature.
- **Statistics** counts only visible items explicitly attributed to this agent. It indicates when some features could not be read.
- **Configuration, Prompt, Tools, Skills, and Memory** contain the agent's persistent settings. Save configuration changes to apply them.

![Agent details and current status](/images/guide/agent-detail-current.png)

## Create an Agent

Select **Create Agent** in the upper-right corner. The form has **Basic**, **Prompt**, **Tools**, and **Skills** tabs. You can finish the remaining settings later by opening the agent's card.

The **Prompt** tab starts with a general collaboration prompt covering fact-checking, tool use, handoffs, and reporting results. Adapt it to the Agent's purpose. It is a starting point for newly created Agents and does not replace prompts already saved for existing Agents.

![Basic settings while creating an agent](/images/guide/agent-create-current.png)

- **Name** is how the agent appears throughout the app.
- **Role** is a short UI label. It does not replace the role prompt.
- **Description** explains the agent's responsibility.
- **Default model** is the model the agent normally uses. If left empty, 4torm chooses the first registered model.
- **Workspace** defaults to an independent directory for the agent; you may enter another path.
- **Execution permission** can be **Project** or **Unrestricted**. It controls the paths accessible to built-in file tools. See [Security and Isolation](../architecture/security) for the exact boundary.

You can select an avatar image up to 20 MB. Before saving, 4torm centers and crops it into a 256px WebP. Removing it restores the name-initial fallback. Avatars appear in the Console, Monsoon, and Convection; Cyclone, Tradewind, and Tide retain their own initials or feature markers.

## Configure Tools and Skills

**Tools** determine what an agent can call. **Skills** supply methods and knowledge for particular kinds of work. Built-in framework tools are enabled for a new agent; custom and MCP tools require explicit selection.

On the agent's **Tools** page, framework collaboration capabilities are grouped under Convection, Cyclone, Tradewind, and Tide. You can enable or disable a whole group; Cyclone and Tradewind also let you select individual operations.

The agent receives instructions for enabled capabilities. Your selection determines which operations it can call, such as creating collaboration structures or scheduled tasks, starting execution, checking progress, and reading results.

Foundation, custom, and MCP tools appear in separate sections. Select the tools you need, then click **Save** to apply the changes.

![Framework capability groups on the agent Tools page](/images/guide/agent-configuration-current.png)

Installed skills are enabled for a new agent by default and can be deselected individually. Their instructions do not occupy conversation context continuously; the agent loads a skill through `use_skill` when needed. Tools bundled with a skill are added with that skill and need not be selected again in the ordinary tool list.

A warning beside a tool name indicates that it can write or delete files, run commands, or perform similar actions. It does not mean every call displays another confirmation prompt.

## Global Conversation Compaction

In the Console, select **Global settings**, then open **Conversation compaction**. Automatic compaction is off by default. When enabled, you can set separate thresholds for each kind of conversation or meeting and choose the fraction of older content to compact. Tide tasks that append to a Monsoon conversation use the Monsoon threshold.

After a threshold is reached, the system summarizes older content before the next message or model call and retains recent text. For example, a threshold of **240K tokens** with a **2/3** fraction compacts roughly the older two-thirds and keeps the most recent third unchanged. Original records are archived.

Saved changes require no restart; subsequent checks use the latest settings.

Ordinary conversations can use their current model or a fixed compaction model. After choosing a fixed model, select **Test model** to check whether it is available. Meetings use the meeting assistant's model and compaction prompt, with the fixed model available as a fallback.

If the preferred model cannot complete compaction, the system reports the reason and tries a different configured fallback model. If that also fails, it preserves the original content and displays the error. The automatic compaction switch controls threshold-triggered compaction. If the model API explicitly reports that the input exceeds its limit, the system still attempts compaction before continuing the current request, even with automatic compaction disabled.

To compact manually, send `/compact` to summarize the current conversation's entire history while archiving the original records. Independent Tide conversations use the **Compact session** button in the task details.

During compaction, the interface shows progress and provides **Stop compaction**. Stopping or failing preserves the original content, and you can start compaction again when needed. The conversation's summary changes only after it has been saved successfully. Select the **History summary** divider to expand the summary. During replies and compaction, the last known usage remains visible until the count is refreshed when the operation ends.

## Modify or Delete an Agent

Select the agent card, open the relevant section, and save to update its settings. The delete action is at the bottom of the detail window and requires a second confirmation.

Deleting an agent removes it from the list and deletes its dedicated directory under `data/agents/`, including its default workspace, Monsoon conversations, and memory. An external workspace configured for the agent and records stored separately by other features are not removed by this action. Those records and tasks may still refer to the deleted agent.
