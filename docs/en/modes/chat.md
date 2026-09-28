# Monsoon · Chat

## What Is Monsoon?

Monsoon is the persistent conversation interface for a single agent. Talk with an agent, ask it to read information, edit files, run commands, use skills, or organize a session team when useful.

One agent can have several independent conversations. Each stores its own messages, tool execution, reasoning, taskboard, and model selection, while all conversations share the agent's identity, capabilities, and workspace.

Built-in file tools use the agent's workspace and automatically apply the execution permissions saved in the Console.

## Start a Conversation

Open Monsoon and select an agent on the left. Existing conversations appear below it; use the plus button to create another.

A new conversation uses the agent's default model. The model selector at the top changes this conversation only—it does not change the agent's default or its configuration elsewhere.

After the first message, a title is generated from its content. Double-click to rename it. Deleting a conversation requires confirmation and permanently removes its messages and execution records.

![Runtime status in a Monsoon conversation](/images/chat/runtime-status.webp)

## Send Images

Send images with text by selecting files, pasting, or dragging them into the composer. Preview and remove individual images before sending.

A message accepts up to four PNG, JPEG, WebP, or GIF images, at most 8 MB each. Attachments are saved with the Monsoon conversation and remain viewable without the original files.

4torm formats image content for the current protocol: image messages for OpenAI Compatible APIs and the corresponding image blocks for Anthropic Messages.

Only a model with actual vision support can read images. Unsupported models, rejected input, and provider format limits produce real request errors; 4torm does not substitute a filename for image content.

Complete conversational image input is currently available only in Monsoon. File paths, web screenshots, and MCP image results from other workspaces are not automatically converted into model-readable images.

## Watch Execution

During a response, the message and composer status show whether the agent is awaiting the model, generating text, preparing arguments, or running a tool, along with elapsed time. When identifiable, the status also names the tool, file, or command involved.

Reasoning appears separately and collapses after completion. Tool calls form ordered cards with expandable arguments and results. File edits show their diffs, and failures retain their actual error messages.

Tools such as `run_command` move to the background if they run for roughly three seconds and return an execution ID. The agent can continue other work, inspect the execution, wait for a bounded period, or terminate it without starting it again.

Background commands appear on the taskboard with live output and a manual stop action. They continue updating until completion, failure, or cancellation even after the agent's current reply ends.

## Act While a Reply Is Running

Messages sent during a reply enter an ordered queue and can be withdrawn above the composer. Switching conversations or agents does not interrupt the task. Return later to continue watching, or use the stop button to end the current run.

## Work with a Session Team

When a task contains responsibility units that can be advanced and reviewed independently, the main agent can create session-team members and dispatch work to them. Members are persistent collaborators within the current conversation. Each keeps an independent message context and can receive follow-up questions or later assignments. They share the workspace with the main agent but do not automatically inherit the complete main-conversation history.

The main agent supplies the necessary background, limits the operating scope, reviews member reports, and decides whether the overall goal is complete. A report remains available in the team after a member finishes a run so the main agent can read and integrate it later.

Use the team entry beside the workspace control to inspect the collaboration graph, member state, assignments, and reports. This panel is read-only; the main agent creates members, supplies context, and dispatches work.

## Build Workflows and Automation

A Monsoon agent can create Tradewind workflows from natural language and inspect or modify saved workflows. It first reads available agents and may ask you to confirm roles and nodes when several designs are possible. A created workflow remains editable in Tradewind. Discussion and editing never start it automatically; the agent runs it only after an explicit request or confirmation.

The current agent can also create a recurring Tide task for itself and inspect or edit existing tasks, but cannot enable or pause them. Agent-created tasks start disabled and must be reviewed and enabled on the Tide page. An unattended Tide run cannot create or modify automation tasks.

## Create Standalone Tools

A Monsoon agent may create and request registration of a global tool. It first completes the executor and definition, then asks for confirmation in the conversation. The tool enters the global registry only after you choose **Register**.

Registration does not add the tool to any agent's explicit tool list. Enable it for the relevant agents in the Console.

## Compact Long Conversations

After context reaches roughly 8,000 tokens, send `/compact` to create a structured summary. Older messages are compacted while the latest four remain verbatim.

Compaction never deletes the original record: old messages remain visible through the compaction marker, while future model context starts from the newest summary. A failed compaction changes nothing. Token counts update after the next model response.

## Conversation Taskboard

The right sidebar contains the current conversation's taskboard. For multi-step work, the agent records goals and progress as pending, in progress, completed, or blocked.

The taskboard belongs only to this conversation. Expand it to add, edit, delete, or change the state and notes of tasks manually.
