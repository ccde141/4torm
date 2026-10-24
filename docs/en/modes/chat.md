# Monsoon · Chat

## What Monsoon Is

Monsoon is where you have an ongoing conversation with one agent. You can talk with it, ask it to read information, modify files, use tools, or organize a team for the current conversation when useful.

The same agent can have multiple independent conversations. Messages, execution details, the taskboard, and the selected model belong to each conversation. Those conversations share the agent's long-term configuration and default workspace from the console.

## Start a Conversation

Open Monsoon and select an agent on the left. Open an existing conversation from the list, or use the plus button to create a new one. You can change the model for this conversation at the top without changing the agent's default model in the console.

## Send Images

Select images with the attachment button, paste them, or drag them into the composer. You can preview and remove individual images before sending. A message sent while the agent is replying cannot include images; send them as a new message after the current run ends.

A message can include up to four PNG, JPEG, WebP, or GIF images, each no larger than 8 MB. Images are saved with the conversation and remain viewable when you reopen it. The selected model must also support image input for the agent to understand them.

## Watch Execution

While the agent replies, the interface shows its current activity. If the model provides reasoning, it appears separately from the final reply. Tool calls create expandable records where you can inspect arguments, results, and errors. File changes also show diffs.

Reasoning and execution details start in a height-limited preview. The left arrow collapses or opens the section; the separate Full height / Limit height button changes its height. The final reply stays outside the process area.

Long-running commands that support background execution return an execution ID. The agent can continue other work, then inspect output, wait for a result, or terminate the command. You can also inspect and stop it from the taskboard's execution records.

## Add Information During a Reply

You can send additional text while the agent is replying. The message will be offered to the current run; if that run has just ended, it becomes the next turn. Input whose delivery has not been confirmed remains visible so you can check or handle it. Images and conversation commands such as `/compact` must wait until the current run ends.

## Work with a Team

For work that benefits from division of responsibility, the main agent can create a team in the current conversation and assign work. Members handle their assigned parts; the main agent coordinates them, checks their reports, and delivers the final result.

The team entry at the top of the conversation shows members, assignments, member conversations, and reports.

## Let an Agent Coordinate Across Workspaces

Describe your goal in Monsoon and let the agent choose a collaboration mode, divide the work, and follow execution. You can also specify the workspace you want it to use.

In the Console, select the agent card, open **Tools**, enable the Convection, Cyclone, Tradewind, or Tide capabilities you need, and save.

| Workspace | What the agent can do |
|---|---|
| **Convection** | Create meetings, arrange members and speaking order, start discussions, chat privately with the meeting assistant, and read selected discussion rounds. |
| **Cyclone** | Set up workshops, seats, and rooms; configure a supervisor and delegate coordination or assign seats directly; inspect project activity, bulletins, and deliveries. |
| **Tradewind** | Create, adjust, and start either workflow mode; manage loop profiles; read runs, envelopes, and archived conversations; add information to nodes or meetings. You release pause points. |
| **Tide** | Create interval or daily tasks, adjust, pause, enable, or run them immediately, and inspect records. Results stay in an independent Tide conversation or append to a designated Monsoon conversation. |

For example:

> Check this project's code structure and test coverage. Set up a Cyclone workshop and have two seats handle the checks separately, then compare their findings in a group discussion. Follow their progress and bring me the final report and any questions that need my decision.

Research, file writing, and command execution suit individual seats. Group discussions are for sharing goals, resolving disagreements, and bringing findings together.

To have a workshop supervisor coordinate the project, you can add:

> Configure a supervisor for this workshop to arrange seat assignments and follow deliveries. Confirm its binding and available seats, then give it the project goal. Read its replies and dispatch records to report progress.

Enable the corresponding Cyclone capabilities first. The supervisor coordinates, seats execute work, and rooms host discussion; see [Cyclone](./cyclone).

The agent can inspect status, wait for tasks to finish, read results, and arrange the next step. You can also open the corresponding workspace to inspect seat conversations, meeting discussions, node results, or task run records.

## Create Custom Tools

A Monsoon agent can write a custom tool and request its registration. Once you confirm registration in the conversation, the tool enters the global list. You can then enable it for the relevant agents in the console.

## Manage Long Conversations

When a conversation grows long, send `/compact` after the current reply finishes to summarize its history and continue. Find the automatic compaction switch, thresholds, history retention fraction, and compaction model under **Configuration → Settings → Conversation compaction** in the sidebar.

During compaction, you can view progress or stop the operation. When it finishes, select **History summary** to view the summary. The conversation list shows the current context's token usage; hover over the count for measurement details.

The taskboard on the right belongs to the current conversation and records goals and progress for multi-step work. You can inspect items the agent added or add, edit, and delete them yourself. Different conversations with the same agent do not share a taskboard.
