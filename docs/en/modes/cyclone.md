# Cyclone · Workshops

Cyclone is a place for several Agents to work together over time. You can create a workshop for a project and give different Agents their own seats. When they need to discuss something together, invite the relevant seats into a room. Everyone shares the workshop files, while each seat's private chat and each room's discussion remain separate.

For example, to prepare a product launch, you could create a “Writer” seat and a “Reviewer” seat. Give each a task, then bring them into a room to discuss the launch. The Reviewer can inspect a file written by the Writer in the same workshop; their earlier private chats with you are not automatically made public in the room.

## Get an Overview from the Workshop Console

When you open a workshop, its **Console** brings together seat states, execution records, seat memories, and recent activity. Filter by status or search for a seat name, duty, or bound Agent. Statistics cover work in this workshop and do not combine that Agent's activity elsewhere.

Select a seat card to browse **Overview**, **History**, **Seat statistics**, **Configuration & prompt**, **Seat memory**, **Inherited capabilities**, and **Workshop collaboration**. Filter history by **Work activity** or **Seat changes**, load earlier records, and open the related conversation, configuration, or memory.

![Workshop console with project statistics, seat cards, and recent activity](/images/cyclone/workshop-console.png)

*Example project: three seats handle research, content design, and quality review. Statistics and activity belong to this workshop.*

## Start Work at a Seat

Use the plus button in the workshop list to create a workshop, then add seats. Choose an existing Agent and a name for each seat. A seat role prompt describes its responsibility here. You can also give it a short responsibility card to help other seats decide whom to ask or assign work to.

Open the Writer's private chat to give it work and inspect tool activity and its taskboard. The Reviewer has a separate private conversation. Both can use the shared workshop files. You can change the Agent bound to a seat later while keeping its existing private chat and seat memory.

In **Configuration & prompt**, change the seat name, bound Agent, duty, and seat prompt. By default, the seat prompt is combined with the Agent's default role; you can choose to replace that role instead. **Inherited capabilities** shows the model, tools, and skills supplied by the bound Agent. Configure those base capabilities in the main Agent Console.

Seat memory holds this project's role experience, confirmed facts, and material references. You and the seat Agent can add to it. The seat shares this memory across its private chat, contacts, and appearances in rooms; full entries are read when needed. Experience useful across projects belongs to the pooled Agent's long-term memory instead. For example, the Writer seat remembers this project's wording conventions, while the bound Agent's general writing methods remain useful in other workspaces.

The workshop bulletin board is a place for goals and agreements that all seats should know, such as launch scope or shared delivery criteria. It belongs to the workshop rather than to one seat's private chat.

![History in seat details, with filters for work activity and seat changes](/images/cyclone/seat-detail.png)

*Example records: assignments, contacts, memory updates, and configuration changes are separate entries for the same seat.*

## Let Seats Collaborate

On the Collaboration Structure canvas, put seats that may work directly together in the same group, or draw connections between seats in different groups. Save the canvas to make those relationships effective. The structure determines **who may contact whom**; it does not start tasks or merge conversations by itself.

Each seat's **Workshop collaboration** section also lets you enable seat contact, task dispatch, and workshop bulletin tools separately. These settings apply to that seat's collaboration in this workshop; the collaboration structure still determines which seats it can contact.

![Current collaboration structure with seats, groups, and a connection between groups](/images/cyclone/collaboration-structure-current.png)

*Example structure: two seats share the content group. A two-way connection links the content designer to the quality reviewer in another group.*

If the Writer only needs to confirm one requirement with the Reviewer, it can use `contact` and wait for an answer before continuing. If an entire draft needs separate review, it can use `dispatch`, carry on with its own work, and check the assigned task's status and result later. The review happens in the Reviewer's own conversation; the two private chats are not combined into one record.

Contact waits up to 30 seconds for the recipient to accept. If the recipient stays busy, the request is withdrawn and returns a busy status. It will not arrive later or enter the recipient's conversation; the sender can work on something else and try again later. After acceptance, a further 30-second reply window may return a running status and contact ID while the recipient continues. Use `contact_read` to check that original request. Dispatch immediately returns a registration receipt; it is also withdrawn if the recipient does not accept within the 30-second admission window. **Registered, accepted, and completed are distinct states. Check the original record instead of assigning delivered work again.**

Seats can also check their own recent activity and assignment status. After assigning work, a seat can finish its own tasks, check for results before wrapping up, and note outstanding work at the end of its reply. It can contact the other seat when clarification is needed. Results enter the source seat's context when its private chat next runs or resumes; their arrival alone does not start a new turn.

Seat memory, history, and assignment queries automatically use the current workshop and seat identity. Contact and dispatch are limited to destinations allowed by the collaboration structure. A seat does not supply its own project or source identity.

For example, ask in the Writer seat's private chat:

> Send the launch draft in the workshop to the Reviewer to check product names, data sources, and any missing usage limitations. Continue preparing the image captions, then revise the draft once the review comes back.

First, connect the two seats in the collaboration structure and enable task dispatch for the Writer seat.

## Discuss Work in a Room

Create a room and invite the relevant seats when they need to discuss something together. After you speak, they reply in the order set for that room. On joining, a seat may introduce itself, share a work summary, or join silently. None of these choices publishes its full private chat to the room.

Use **Meeting Settings** in the room's upper-right corner to change its topic, speaking order, or participants. Removing a seat from the meeting only removes it from that room; its seat, private chat, and earlier messages remain.

The `build` mode suits discussions where participants also use tools to work with workshop files. The `plan` mode suits planning first: it restricts direct file writes, deletion, and command execution. Participants can contact other seats according to the collaboration structure in either mode.

You may also assign a meeting assistant to the workshop and talk to it privately from the panel on the right of a room. It can refer to that room's public discussion and the bulletin board to provide analysis, advice, and summaries. It does not use execution tools or assign work to seats. Its private replies do not enter the public discussion. Each room keeps its own meeting assistant chat.

## Set Up a Workshop Supervisor

A workshop supervisor coordinates the whole project and is configured separately from the room meeting assistant. It sits outside seats and collaboration groups, keeps one continuing conversation, and can inspect progress, manage seats and collaboration structure, assign work, and follow up on seat replies. It uses the shared workshop workspace and keeps its own taskboard and project memory. Its project management and collaboration tools are bound to this workshop automatically.

Choose an existing Agent when creating the workshop, or open **Workshop supervisor** in the sidebar and select **Configure** later. One pooled Agent may serve as both supervisor and meeting assistant, with separate conversations and responsibilities. Each workshop has one supervisor conversation; switching workshops opens the corresponding supervisor's records.

![Workshop supervisor Agent binding, role prompt, and continuing conversation](/images/cyclone/workshop-supervisor.png)

*Example configuration and conversation: the supervisor sits outside the seats and brings together deliverables and unresolved questions. All displayed project content is sample data.*

The supervisor can create, update, and retire seats, change collaboration relationships, the bulletin board and room settings, read seat memory and history, and manage project conversations. Retiring a seat preserves snapshots of its conversation, taskboard, memory, and attachments. A busy seat cannot be retired.

Binding a supervisor does not start work. Give it a project goal first. Seats can then use `supervisor_message` to report progress, blockers, or coordination requests, and the supervisor can follow up on receipts from its own assignments. Seats can send information to the supervisor but cannot assign it tasks. Delivery does not mean the supervisor has read or handled a report. A supervisor waiting for your answer or paused by you needs your attention before continuing.

## Let an Agent Coordinate the Workshop

In Monsoon, you can ask an Agent to create a Cyclone workshop, add seats and rooms, assign tasks to each seat, and arrange further work based on their replies. It can also continue work in an existing workshop.

Independent research, file writing, and work involving several steps are best assigned to each seat's private chat. Rooms are for sharing background, discussing disagreements, and bringing brief reports together. The bulletin board holds common goals, agreements, and conclusions. Simple questions or joint discussions can happen directly in a room.

The coordinating Agent can first check the workshop or an individual seat's overview and recent activity, read seat memory when needed, and use seat replies and assignment results to continue the work. It can also adjust room membership and talk privately with the meeting assistant.

With the corresponding Cyclone actions enabled, a Monsoon Agent can explicitly choose a supervisor during group creation (`supervisorAgentId`) or use `configure_collaboration_supervisor` for the first binding in an existing workshop. The meeting assistant uses the separate `chairAgentId` field; selecting one does not configure a supervisor. The Agent can relay your project goal through `start_collaboration_supervisor_chat`, inspect status and inbox through `read_collaboration_supervisor`, then read the supervisor conversation and actual seat deliverables. The assignment retains the delegating Agent's origin. You can replace an existing supervisor through **Configure** on the **Workshop supervisor** page.

An external coordinating Agent must specify the workshop on each call and the seat when reading seat resources. It can read seat configuration, inherited capabilities, memory, and history; those read operations do not modify a seat or write another seat's memory. A new delegated goal is rejected while the supervisor is busy or waiting for your answer, rather than opening a parallel supervisor conversation.

For example:

> Create a review workshop for this project. Have one seat check the installation flow and another verify the feature descriptions, each in its own private chat. Put shared requirements on the bulletin board. Once both have delivered their findings, hold a room discussion to resolve disagreements and collect revision suggestions.

To continue an existing project, you could ask:

> Continue yesterday's review workshop. Check each seat's recent activity and existing deliverables first. Read seat memory when needed to confirm wording conventions and questions still needing verification. Keep completed checks, assign the remaining questions to the appropriate seats, and give me a progress brief.

Open Cyclone to inspect the seats' actual conversations, room discussions, and bulletin board, or take over part of the work yourself.

## Review Progress

Seat chats and rooms show replies, tool activity, and communication between seats. Asynchronous assignments have their own status and result records. Once an assignment finishes, you can inspect its result and decide whether to bring it back into the room discussion.

Recent activity in the workshop console and a seat's **History** also record changes to seat configuration, the bound Agent, and seat memory. Expand a record to see its time, source, and related entry, then open the corresponding configuration or memory page. These changes do not count as executions. Full prompts and memory contents remain in their original views. Changes that were not recorded in older data are not reconstructed as history.

A coordinating Agent can page through a seat's history to inspect activity beyond the overview. Information delivered, information read, a seat execution completed, and the whole project delivered are separate facts; check the relevant conversations, assignment results, and records.

Seat chats, rooms, meeting assistant chats, and the supervisor conversation all support `/compact` in their own composer to summarize the conversation and continue. Send `/reset` to archive and clear the current conversation. Clearing the supervisor conversation also stops automatic follow-up on its earlier goal; give it a new goal to resume coordination.

In a room, `/reset all` archives and clears both the public discussion and meeting assistant chat. Room compaction requires a meeting assistant to be set for the workshop.
