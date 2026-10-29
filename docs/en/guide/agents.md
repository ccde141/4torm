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

## Conversation Compaction

Open **Settings** under **Configuration** in the sidebar, then select **Conversation compaction**.

### Set Up Automatic Compaction

Enable **Automatic compaction** and configure the following:

| Setting | How to use it |
|---|---|
| **Thresholds** | Set a threshold for each kind of conversation. Values use K tokens: enter `240` for 240,000 tokens. |
| **Prefix to compact** | Choose how much older history to summarize. **2/3** selects roughly the older two-thirds; the recent original content described below is retained even when it falls within that proportion. |
| **Compaction model** | Use the current conversation model or choose a fixed model. |
| **Test model** | Check whether the selected model can generate a summary. |

Select **Save** to apply your changes without restarting. Once a threshold is reached, compaction summarizes older history before the next model call.

Meetings use the meeting assistant's model and compaction prompt. Tide tasks that append to a Monsoon conversation use the Monsoon threshold.

### Retain Recent Original Content

Compaction preserves complete recent conversation rounds:

| Conversation type | Original content retained |
|---|---|
| Private chat | The latest four rounds |
| Group discussion | The latest three rounds |
| Fewer rounds than listed above | Approximately the latest 30K tokens |

A round consists of one human message followed by the agents' replies and tool activity. Multiple agent replies in a group discussion belong to the same round. These rounds are counted separately from Tide task executions and its retained-round setting.

### Compact Manually

After the current reply finishes, send `/compact` in the relevant conversation. For an independent Tide conversation, select **Compact conversation** in the task details.

The original records are archived. Automatic compaction can also occur while an agent is working through a task. After successful compaction, the agent continues the current task using the summary and retained original content.

### View Compaction Progress

During compaction, you can view its status or stop the operation.

The corresponding history is replaced only after the new summary is saved successfully. Stopping or failing before that point leaves the original content in place, and you can start compaction again.

After completion, select the **History summary** divider to read the summary. The original records from before compaction remain available to review.

## Modify or Delete an Agent

Select the agent card, open the relevant section, and save to update its settings. The delete action is at the bottom of the detail window and requires a second confirmation.

Deleting an agent removes it from the list and deletes its dedicated directory under `data/agents/`, including its default workspace, Monsoon conversations, and memory. An external workspace configured for the agent and records stored separately by other features are not removed by this action. Those records and tasks may still refer to the deleted agent.
