# Convection · Meeting Rooms

Convection brings a human and several agents into one discussion. After the human speaks, participants reply in the configured order. Later speakers see the public history and earlier replies from the current round, allowing distinct roles to continue in one shared context.

Each room also has a meeting assistant. It does not speak publicly; it responds privately in the right sidebar. It can reference the public record, but private messages never enter the public discussion.

Participants use their configured tools in a shared room workspace. The record, membership, and workspace are persisted separately for each room.

Convection does not support global tool registration. Participants can use existing tools but cannot create new ones during public discussion, assistant chat, or meeting rounds. Use Monsoon or a Cyclone seat conversation for that work.

## Long-Term Memory

Each participant uses the independent memory of its bound agent. Before speaking, the system recalls entries relevant to the meeting topic and latest human message; participants may also inspect, write, or update their own memory.

Memory is never shared between participants, and the public record is not written automatically to any agent's memory. The meeting assistant neither reads nor writes agent memory and calls no tools; it sees only the public record and this room's assistant-chat history.

![Convection room and private meeting assistant](/images/convection/meeting-room.webp)

## Create a Meeting Room

A room requires at least two agents. When you use the plus button, the first agent becomes the meeting assistant by default and up to two others become participants.

After creation, change the assistant, add or remove participants, and reorder speakers from the meeting header. These settings determine who replies, and in what order, after the next human message. Double-click the title to rename it. Deleting the room also deletes its public record, assistant chat, and workspace.

## Hold a Public Discussion

Sending a message starts a round. Participants run in header order. Each sees earlier public history and the final replies of participants ahead of it in the current round.

Reasoning and tool calls stream to the human but are not added to the public record seen by other agents; only final replies become later context. Messages sent during a round queue for the next round. The stop button ends the current round.

## Private Meeting Assistant

The right sidebar provides a private conversation with the meeting assistant. It answers from a snapshot of the public record and existing private history. Neither participants nor the public discussion receive these messages.

Public rounds and assistant replies run sequentially. You can edit a draft on the other side while one is active, but must wait before sending. The meeting assistant returns text only and calls no tools.

## Change Participants

Add, remove, or reorder participants at any time. A change does not disturb the running round and takes effect with the next public discussion.

To hear from only one agent next round, temporarily leave that participant alone; add the others back later. Changing the meeting assistant takes effect with the next private reply.

## Tools and Workspace

Participants use the built-in, custom, skill, and MCP tools configured for their agents. Everyone works in the room's shared workspace, so later speakers can read and continue files created or changed earlier.

Built-in file tools apply each agent's permissions, with the room workspace always added to the allowed scope.

Reasoning and tool execution remain visible inside the corresponding reply but outside the shared public record. Participants cannot create SubAgents, and the meeting assistant cannot call tools.

## Reset a Meeting

Two commands clear current context:

- `/reset` archives and clears both the public and assistant conversations without changing participants or workspace files.
- `/reset summary` also archives and clears both sides, then uses the assistant's model to generate a structured summary as the new starting context. If summarization fails, the UI reports it and the original record remains archived.

Archives are stored in order under the room workspace's `bak/` directory.

## Automatic Compaction

When the public context reaches `200K prompt tokens` and contains enough discussion rounds, compaction begins after every participant has finished the current round.

Older discussion is archived to `bak/`, then summarized with the meeting assistant's model. Several recent rounds remain verbatim; their content and the summary form the next context. The UI reports progress and outcome.

If summarization fails, the public record is not replaced and the UI shows the error. That room will not retry automatic compaction on every later round.

## Data and Recovery

Records, membership, and workspace files are stored locally. A refresh reopens the last room. If a round is still running, the page synchronizes its status and reloads the final record when it finishes. Tokens and tool progress emitted during the refresh are not replayed.

- Session index: `data/convection/sessions/_index.json`
- Session record: `data/convection/sessions/{sessionId}.json`
- Room workspace: `data/convection/sessions/{sessionId}/workspace/`
- Archives: `data/convection/sessions/{sessionId}/workspace/bak/`

`data/convection/sessions/` is excluded from Git. Git exclusion is not a backup; back up the directory separately when moving or preserving meetings.
