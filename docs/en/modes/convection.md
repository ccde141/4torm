# Convection · Meeting Rooms

Convection lets you discuss or advance work with several Agents in one meeting room. After you introduce a topic, participants speak in the configured order. Later speakers can build on the public discussion so far. Each room also has a meeting assistant you can talk to privately, without putting every thought into the public discussion.

## Create a Meeting Room

First prepare at least two Agents in the console, then click the plus button in the meeting list. The new room automatically selects a meeting assistant and participants. Once inside, you can change the assistant, add or remove participants, and reorder speakers in the header. Membership and order changes take effect in the next discussion round.

Each room keeps its own public discussion, assistant chat, and workspace. Switching rooms does not mix those contents together.

## Public Discussion

Enter a topic or request in the bottom composer. Participants reply in the order shown in the header. A later speaker can see the previous public record and the final replies of members who spoke earlier in the current round. Reasoning and tool execution appear in the interface for you to inspect; they are not passed to later members as public statements.

![Public discussion with two participants in a meeting room](/images/convection/meeting-room.webp)

Participants can use their configured tools and collaborate in the room's shared workspace. Files written by an earlier speaker can be read and continued by later members. Each Agent's long-term memory remains its own and is not shared automatically just because they attend the same meeting.

You can enter another message while a discussion is running. If you send it, it waits for the current round to finish before starting. Use the stop button when you need to end the current round.

## Private Meeting Assistant

Click the meeting assistant tab on the right to open its private panel. The assistant answers using the public discussion and your existing private conversation. Private messages do not enter the public discussion, and other participants cannot see them. This chat gives text replies only and does not call tools.

The public discussion and private chat do not run at the same time. You can draft a message on one side while the other is responding, then send it after the current reply ends.

## Let an Agent Advance the Meeting

In Monsoon, you can ask an Agent to create a meeting room, choose its assistant and participants, arrange the speaking order, and start a discussion. It can also continue an existing meeting.

The Agent can read public discussion or assistant chat by round, inspect replies as they are being generated, wait for the current round to finish, then add questions or adjust the next round's participants to continue the discussion.

For example:

> Ask the Architecture Researcher and Experience Reviewer to discuss this project's first-use flow, with the Content Editor as meeting assistant. Gather both participants' suggestions, then ask the assistant to identify disagreements. Continue discussing unresolved questions and give me a revision checklist.

Meetings started by an Agent appear in the Convection meeting list. Open the room to see participants' streaming replies or join the discussion yourself.

## Organize Discussion Context

Send `/compact` in the public composer to summarize the public discussion while keeping the meeting assistant chat. Send `/reset` to archive and clear both the public discussion and assistant chat.

In the meeting assistant chat, `/compact` or `/reset` only updates that private conversation.
