# Cyclone · Workshops

Cyclone lets several agents collaborate in one long-lived workspace. A workshop contains permanent seats. Each seat points to a registered agent and keeps its own responsibility, role prompt, and private conversation history; its bound agent can be changed at any time.

Talk directly with a seat or create group rooms where selected seats discuss in order. Every seat and room shares workshop files, while their conversation contexts remain separate.

Each seat conversation has an independent taskboard, used like the [Monsoon conversation taskboard](./chat#conversation-taskboard). The workshop also has a bulletin board shared by all agents for durable information, common agreements, and goals.

Seats and room participants communicate in two ways:

- `contact` is synchronous: the current agent asks a target seat and waits for its reply before continuing.
- `dispatch` is asynchronous: the current agent delegates longer work to a target seat and continues without waiting.

A workshop may also have a meeting assistant. It occupies no seat and does not speak in rooms; it provides private advice in each room's right sidebar, like the [Convection meeting assistant](./convection#private-meeting-assistant).

## Create a Workshop

Use the plus button beside the workshop list and enter a name. Select a meeting assistant now, leave it empty, or configure it later from any room's assistant panel.

A new workshop has no seats or rooms. Add permanent seats first, then create rooms for specific topics. Its name, assistant, seats, rooms, and shared files are persisted independently.

## Create and Configure Seats

Use the plus button beside the seat list. Select a registered agent and give the seat a name unique within the workshop. The role prompt and responsibility card may be added later from seat settings.

The seat role prompt defines the agent's identity and working method here. By default, it is appended to the agent's base role prompt. With **Override Agent Base Role** enabled, only the seat prompt is used.

The responsibility card is a short description shown to other seats when choosing a `contact` or `dispatch` target. It can be generated from the agent and seat configuration.

The bound agent, name, prompt, and card can all be changed. A new binding takes effect next round without clearing seat settings or private history. If the old agent was deleted, bind another valid agent to continue.

### Seat Conversations

Each seat has one conversation. Its agent uses the currently bound model, tools, and skills under the seat role prompt. File operations use the shared workshop directory.

Built-in file tools apply the bound agent's execution permissions, with the workshop directory always included as the current workspace. Reasoning, tools, SubAgent delegation, and live execution state appear in the conversation.

Background-capable tools such as `run_command` return an execution ID and continue if they have not finished after roughly three seconds. The seat agent can continue working, inspect status, wait for a bounded time, or terminate the process. The human can watch output and terminate it from the seat taskboard.

These background controls currently apply only to ordinary seat conversations. Rooms, assistant chats, and unattended `contact` or `dispatch` turns still wait for their tools to finish.

Seat context never enters rooms or other seats. The agent can use `contact` for a synchronous question or `dispatch` for asynchronous work.

A seat conversation can also create and request registration of a global tool. Registration occurs only after human confirmation in that conversation. Rooms, assistant chats, and unattended communication turns cannot register tools; route such work to a permanent seat for review.

### Long-Term Memory

A seat uses the memory of its currently bound agent. Seat conversations, room turns, and target turns triggered by `contact` recall task-relevant entries and may use `memory_list`, `memory_read`, and `memory_write`.

Memory belongs to the agent, not the workshop or seat. Rebinding keeps prior conversations but moves subsequent recall and writes to the new agent.

A `dispatch` runs as the target seat and therefore uses its bound agent's memory. Temporary SubAgents created with `delegate` remain isolated and do not automatically use long-term memory. Meeting assistants have no tools and do not access agent memory.

## Create and Manage Group Rooms

Use the plus button beside the room list. Set a name, topic, run mode, and initial seats. A room may start empty and invite seats later.

Each joining seat can enter with:

- **Work summary**, generated from recent private progress;
- **Introduction**, generated from the responsibility card; or
- **Silent join**, which adds the seat without a message.

Join messages become public room history but never expose the full private seat context.

**Meeting Settings** changes the room name, topic, run mode, speaker order, invitations, and removals. If a seat joins successfully but its join message fails, the UI reports both facts instead of treating the entire operation as failed.

Removing a seat affects only this room. The seat, its private history, old public messages, and dispatch records remain. Joins and departures produce system entries on the public timeline, including initial seats in their configured order.

Rooms have two run modes:

- `build`: participants may use configured tools and modify shared workshop files.
- `plan`: participants cannot call write, delete, or command-execution tools, but may read information and use `contact` or `dispatch`.

After a human message, participating seats reply in current meeting order. Meeting settings lock while the public meeting, assistant chat, or a dispatch from this room is active; changes resume afterward and apply next round.

### Live Conversation and Tool Records

Seat conversations and rooms stream text, reasoning, and tool activity throughout execution. Ordinary tools are grouped into consecutive execution stages. System operations with distinct semantics—`ask`, `delegate`, `contact`, and `dispatch`—remain separate.

Text, tools, and seat communication retain their actual order. Intermediate text around tools remains visible; tools after an `ask` resume form a new stage, and asynchronous dispatch status and results stay at their original timeline positions.

After refresh, persisted text, tool records, and dispatch information return in order. Temporary live state that was never persisted is not presented as a completed record.

### Communication Between Seats

Room participants can turn public discussion into concrete work by contacting permanent seats.

`contact` sends a question or update to a target seat and waits. The exchange enters the target seat's private history. Its reply returns only as the current tool result and is not automatically posted publicly.

Use `contact` for progress checks, verification, or quick judgment. If the target is busy, waiting for a human, or would create a communication cycle, the system returns the reason instead of waiting forever.

`dispatch` delegates longer work and lets the current agent continue. The target executes independently in its private conversation; progress and outcome form a dispatch record. After completion, the human decides whether to bring the result back into the room.

Both forms share workshop files without merging private contexts.

## Private Meeting Assistant

Set, replace, or clear the workshop meeting assistant from any room's right sidebar. The choice belongs to the workshop and applies to all its rooms.

Each room keeps separate assistant-chat history. The assistant sees that room's recent public discussion, present seats, and workshop bulletin board, but not other rooms or private seat conversations. Its messages never enter public discussion.

The assistant provides text analysis only and calls no tools. Public discussion and assistant chat cannot run simultaneously in the same room. Replacing the assistant takes effect with the next private reply and does not clear history.

## Reset Conversations

Enter a reset command as a message in the input whose scope you want to reset.

### Public Room Input

- `/reset`: archive and clear public discussion only.
- `/reset summary`: summarize public discussion with the assistant model and use it as new public context.
- `/reset all`: archive and clear both public discussion and this room's assistant chat.
- `/reset all summary`: summarize and reset public discussion and assistant chat separately.

### Meeting Assistant Input

- `/reset`: archive and clear this room's assistant chat only.
- `/reset summary`: summarize and reset this room's assistant chat only.

### Seat Conversation Input

- `/reset`: archive and clear this seat's private context.
- `/reset summary`: summarize the seat history and use it as new context.

Resetting does not delete shared files, seat settings, room membership, or speaker order. Earlier dispatch records remain after a public reset but no longer enter new discussion. Archives are stored under the workshop's `bak/` directory.

Summary resets require an available model; public-room summaries also require a configured meeting assistant. If summarization fails, reset stops and the original record remains.

## Data and Recovery

Workshop settings, seat conversations, rooms, bulletin board, dispatches, and shared files are local and reload after refresh. Incomplete live output and tool progress are not replayed as completed records.

- Workshop index: `data/cyclone/_index.json`
- Workshop metadata: `data/cyclone/{workshopId}/meta.json`
- Shared workspace: `data/cyclone/{workshopId}/workspace/`
- Bulletin and history: `bulletin.json`, `bulletin-history.json`
- Seat conversations and taskboards: `data/cyclone/{workshopId}/seats/`
- Rooms and assistant chats: `data/cyclone/{workshopId}/rooms/`
- Dispatch records: `data/cyclone/{workshopId}/dispatches/`
- Conversation archives: `data/cyclone/{workshopId}/bak/`

After an application restart, dispatches that had not started remain queued. A dispatch that was running at shutdown is marked failed with an explicit shutdown reason and is not retried automatically.

The entire `data/cyclone/` directory is excluded from Git. Git exclusion is not a backup; preserve it separately when moving or retaining workshops.
