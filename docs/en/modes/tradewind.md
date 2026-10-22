# Tradewind · Workflows

Tradewind divides work into nodes and lets Agents hand it along the connections you define. Nodes can follow fixed dependencies or choose their next step based on the result, including returning work for revisions. It suits Agent handoffs, review points, and work you want to run again using the same structure.

For example, to prepare a launch proposal: the Entry supplies the goal; a Research Agent gathers facts; a Writer Agent drafts the proposal from that research; a Pause node lets you review it; and the Exit collects the final result. During the run, you can see which node is active and open its content when you need to step in.

## Build a Workflow

The workflow list on the left separates **Strict dependencies** from **Conditional handoff**. Choose a flow type before creating a workflow. After selecting one, switch between **Design**, **Run**, and **Run history**. The question mark beside the list explains the two flow types.

In **Design**, drag nodes from the palette onto the canvas and connect them to define handoffs. Click a node to configure its role and content on the right. You can also describe the goal, responsibilities, and human review points in Monsoon and ask an Agent to create or edit a Tradewind workflow. You can still return to the canvas to adjust it afterward.

A new workflow appears as a **Local draft** until it is saved. An empty canvas can also be saved; the check before starting determines whether it can run. **Open workspace** first saves the current draft, then creates and opens that workflow's shared file directory.

![The two flow types and a conditional handoff graph, with a return connection from Review to Creation](/images/tradewind/workflow-editor.png)

Screenshots use sample product-page and usage-guide data, shown in the Chinese interface.

The common nodes have distinct jobs: **Entry** supplies the initial task; **Agent** binds an existing Agent to do work; **Pause** waits for your review before passing content on; and **Exit** collects results. Strict dependency workflows can also include a **Meeting Room**. Use a **Note** to give an Agent continuing guidance; it supplies instructions without running as a work step.

The handoff between nodes is called an “envelope”: it tells the next node what has been done and what to do next, rather than copying the previous node's entire conversation. Nodes can also use the same workflow workspace files.

## Choose a Flow Type

Each workflow graph uses one flow type, with at least one Entry and exactly one Exit. Workflows of either type are saved and designed separately and can run at the same time.

**Strict dependencies** follow the predefined division of work, and handoff connections cannot form a cycle. A node that depends on several upstream branches waits for all their envelopes before starting. This suits fixed processes such as separate fact and wording checks followed by consolidation and delivery.

**Conditional handoff** lets a node choose one of its connected targets based on the result. For example, creation passes to review; an approved result goes to the Exit, while a rejected result returns for revisions. Each Entry produces an envelope with its own ID. A node handles one envelope at a time, while others queue in arrival order. Each handoff continues with the original envelope without splitting it. A successful handoff ends that node's current processing of the envelope; it cannot then send the same envelope to another target. Conditional handoff does not support Meeting Room nodes.

Return connections are allowed, but every execution node must be reachable from an Entry and have a route to the Exit. Each Entry and Pause node must have exactly one handoff target. A closed cycle with no route to the Exit fails graph validation.

Agents in both flow types can contact one another to ask questions or provide information. Contact does not replace the formal envelope handoff. Human messages and Agent contact do not themselves create new formal envelopes.

## Choose How to Run It

The flow type determines how work is handed over; the run option determines whether you need to participate along the way. Both flow types support these run options:

**Interactive run** suits work you want to join as it proceeds. Work advances automatically from the Entry. You can chat with Agent nodes or review and edit an envelope at a Pause node. When a Meeting Room in a strict dependency workflow ends, its assistant prepares minutes before handing them to the next node.

**Unattended run** suits work that needs no intervention and cannot contain Meeting Room or Pause nodes. Run it once, or create a loop profile with a number of rounds, a wait between rounds, and a rule for passing one round's result into the next. Revisions in a conditional handoff stay within the same run; a repeated run starts again from the Entry after the previous run finishes.

Before either run starts, the current canvas is checked, then saved and started if valid. If its configuration or connections are invalid, the interface shows what needs fixing and the workflow does not start. An unattended strict dependency run also requires each Agent node to use a model that supports native tool calling.

Starting switches to **Run**, which shows the graph as it was when that execution began. Viewing or editing the draft in **Design** does not replace the running graph.

## Let an Agent Advance the Workflow

In Monsoon, describe the task goal, node responsibilities, and handoff requirements, and ask an Agent to create or adjust a Tradewind workflow and start it. It can also read and use an existing workflow.

Before changing a workflow, the Agent reads its full specification. Large graphs can be read in further pages of the same revision, avoiding edits based only on a truncated list summary. Saving still checks the revision; changed content must be read again. Unchanged node positions, sizes, notes, and connection details are preserved.

After starting the run, the Agent can check progress, read node conversations and run records, and send additional requirements to Agent nodes. An accepted message has entered the queue; the Agent must still inspect the reply or execution state to confirm the result. At a Meeting Room in a strict dependency workflow, it can join the discussion, chat privately with the meeting assistant, adjust attendance and speaking order among configured members, and end the meeting so its minutes pass downstream. You review and release Pause nodes on the Tradewind page.

When requested, Monsoon can also stop a specific workflow execution or pause and resume a node's processing round. Resuming reruns the paused round; completed tool side effects are not undone. A separate conversational round can be aborted on its own, while a round holding a formal envelope must be paused or its workflow execution stopped. Control requests check execution, node, and round identities, and accepted requests still require confirmation of the final state. Human Pause nodes remain yours to review and release.

With the corresponding Tradewind actions enabled, the Agent can also read loop profiles, add or update one profile, and start it when requested. Updating a workflow or an individual loop profile requires the revision that was read. After a conflict, the Agent should read it again before editing to avoid overwriting concurrent changes. Saving configuration does not start work. Loops currently use a relative wait after each round finishes.

To inspect past work, ask the Agent to find a run within a workflow and read its results, handoff events, and archived conversations. Long event lists and bodies can be read in further pages. Continuing a body checks its content revision; if the content changes, it must be read again. This does not rely on a node conversation that is still open.

For example:

> Build a strict dependency workflow to review the usage guide: check facts and wording in two parallel branches, then have a consolidation node collect revision suggestions and output a checklist. Once it is ready, start an unattended run, follow each node's results, and give me the checklist when it finishes.

For work that may need revisions after review, you could ask:

> Build a conditional handoff workflow: a Creation node writes a product introduction page, and a Review node checks its content and narrow-screen layout. Approved work goes to the Exit. Rejected work may only return to Creation along the predefined connection, with specific issues attached. Configure the node responsibilities and connections, start an unattended run, and deliver the page file and review conclusion.

To review an intermediate result yourself, you could ask:

> Build a strict dependency workflow: a Research node organizes three product descriptions, and a Writer node uses them to draft an introduction. Add a Pause node before the Exit. Start an interactive run so I can review and release the result at the Pause node before receiving the final draft.

For repeated execution and a later review:

> Read the existing review workflow and keep its other loop profiles. Add a profile for two rounds with a one-minute wait after each round, then start it. List each round's deliverables and use the run records to check envelope handoffs and the Review node's tool results.

## Follow Execution and Results

Workflow cards on the left use color to show their latest run: **blue** means running or waiting, **yellow** means intervention is needed, **red** means failure or interruption, and **green** means completed and not yet viewed. Selecting a completed card clears that run's green indicator while retaining its records. Starting another run updates the card to the new state.

In **Run**, inspect node states, the envelope being handled, waiting queues, and recent handoffs. Use the conversation button on an Agent node to open its conversation, tool activity, and current work directly. Open a Pause node awaiting review to confirm or edit its envelope before letting that branch continue. For a finished execution, conversation buttons open the corresponding archive. Different workflows can run at the same time, including different flow types. Switch between them through **Active workflows** without stopping the others.

![The run graph shows completed and active nodes, envelope progress, and direct conversation buttons](/images/tradewind/workflow-running.png)

**Run history** keeps each run's graph, start and end times, and status. Browse **Results**, **Node context**, **Meetings**, **Envelopes**, and **All events**. Filter events by time and type to inspect who sent an envelope, when it was sent and received, and the related execution activity. You can also open that execution's graph from its record.

Node and meeting archives show input messages, Agent replies, and tool content, without system prompts or internal reasoning. Long bodies and event lists have further pages. Some archives may not have been saved while a run is in progress. Missing older records are identified rather than replaced with the current conversation.

![Run history with archived node input, tool calls, and the Agent's delivery reply](/images/tradewind/run-history.png)

Strict dependencies wait for the expected branches to finish their handoffs; conditional handoff waits for each Entry's envelope to be delivered. One envelope reaching the Exit does not necessarily mean the entire run has finished.

**Stop Workflow** ends the current workflow's run. Unfinished content will not be passed downstream. Completed node output and run records remain available for review. The workflow definition and shared files remain in place so you can run it again later.

Deleting a workflow removes its definition, shared workspace, and run records; it cannot be restored from the list. Back up files separately if you need to keep them.

## Organize Conversation Records

Agent nodes, meeting public composers, and meeting assistant chats support `/compact` to summarize the current conversation. A meeting's public composer also supports `/reset` to archive and clear both that meeting's public discussion and assistant chat.
