# Cyclone · Workshops

Cyclone is a place for several Agents to work together over time. You can create a workshop for a project and give different Agents their own seats. When they need to discuss something together, invite the relevant seats into a room. Everyone shares the workshop files, while each seat's private chat and each room's discussion remain separate.

For example, to prepare a product launch, you could create a “Writer” seat and a “Reviewer” seat. Give each a task, then bring them into a room to discuss the launch. The Reviewer can inspect a file written by the Writer in the same workshop; their earlier private chats with you are not automatically made public in the room.

## Start Work at a Seat

Use the plus button in the workshop list to create a workshop, then add seats. Choose an existing Agent and a name for each seat. A seat role prompt describes its responsibility here. You can also give it a short responsibility card to help other seats decide whom to ask or assign work to.

Click the Writer seat to chat with it, give it work, and inspect tool activity and its taskboard. Click the Reviewer seat to open a separate private conversation. Both can use the shared workshop files. You can change the Agent bound to a seat later without clearing that seat's existing private chat.

The workshop bulletin board is a place for goals and agreements that all seats should know, such as launch scope or shared delivery criteria. It belongs to the workshop rather than to one seat's private chat.

## Let Seats Collaborate

On the Collaboration Structure canvas, put seats that may work directly together in the same group, or draw connections between seats in different groups. Save the canvas to make those relationships effective. The structure determines **who may contact whom**; it does not start tasks or merge conversations by itself.

![Seats, collaboration groups, and connections in a workshop](/images/cyclone/collaboration-structure.webp)

If the Writer only needs to confirm one requirement with the Reviewer, it can use `contact` and wait for an answer before continuing. If an entire draft needs separate review, it can use `dispatch`, carry on with its own work, and check the assigned task's status and result later. The review happens in the Reviewer's own conversation; the two private chats are not combined into one record.

## Discuss Work in a Room

Create a room and invite the relevant seats when they need to discuss something together. After you speak, they reply in the order set for that room. On joining, a seat may introduce itself, share a work summary, or join silently. None of these choices publishes its full private chat to the room.

Use **Meeting Settings** in the room's upper-right corner to change its topic, speaking order, or participants. Removing a seat from the meeting only removes it from that room; its seat, private chat, and earlier messages remain.

The `build` mode suits discussions where participants also use tools to work with workshop files. The `plan` mode suits planning first: it restricts direct file writes, deletion, and command execution. Participants can contact other seats according to the collaboration structure in either mode.

You may also assign a meeting assistant to the workshop and talk to it privately from the panel on the right of a room. It can refer to that room's public discussion and the bulletin board, but its private replies do not enter the public discussion. Each room keeps its own meeting assistant chat.

## Let an Agent Coordinate the Workshop

In Monsoon, you can ask an Agent to create a Cyclone workshop, add seats and rooms, assign tasks to each seat, and arrange further work based on their replies. It can also continue work in an existing workshop.

Independent research, file writing, and work involving several steps are best assigned to each seat's private chat. Rooms are for sharing background, discussing disagreements, and bringing brief reports together. The bulletin board holds common goals, agreements, and conclusions. Simple questions or joint discussions can happen directly in a room.

The coordinating Agent can read seat replies and assignment results, continue seat tasks, adjust room membership, and talk privately with the meeting assistant.

For example:

> Create a review workshop for this project. Have one seat check the installation flow and another verify the feature descriptions, each in its own private chat. Put shared requirements on the bulletin board. Once both have delivered their findings, hold a room discussion to resolve disagreements and collect revision suggestions.

Open Cyclone to inspect the seats' actual conversations, room discussions, and bulletin board, or take over part of the work yourself.

## Review Progress

Seat chats and rooms show replies, tool activity, and communication between seats. Asynchronous assignments have their own status and result records. Once an assignment finishes, you can inspect its result and decide whether to bring it back into the room discussion.

Seat chats, rooms, and meeting assistant chats all support `/compact` in their own composer to summarize the conversation and continue. Send `/reset` to archive and clear the current conversation.

In a room, `/reset all` archives and clears both the public discussion and meeting assistant chat. Room compaction requires a meeting assistant to be set for the workshop.
