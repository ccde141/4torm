# Tradewind · Workflows

Tradewind divides work into ordered nodes and passes each step's result to the next. It suits work that needs several Agents to take turns, a fixed review point, or a structure you want to run again later.

For example, to prepare a launch proposal: the Entry supplies the goal; a Research Agent gathers facts; a Writer Agent drafts the proposal from that research; a Pause node lets you review it; and the Exit collects the final result. During the run, you can see which node is active and open its content when you need to step in.

## Build a Workflow

Drag nodes from the left palette onto the canvas, then connect them in handoff order. Click a node to configure its role and content on the right. You can also describe the goal, responsibilities, and human review points in Monsoon and ask an Agent to create or edit a Tradewind workflow. You can still return to the canvas to adjust it afterward.

![Parallel branches and merged output on a code audit workflow canvas](/images/tradewind/workflow-canvas.webp)

The common nodes have distinct jobs: **Entry** supplies the initial task; **Agent** binds an existing Agent to do work; **Pause** waits for your review before passing content on; and **Exit** collects results. Add a **Meeting Room** when several Agents should discuss a topic. Use a **Note** to give an Agent continuing guidance. A Note only supplies instructions; it does not run as a work step.

When a node finishes, it sends a prepared handoff along its ordinary connections. This handoff is called an “envelope”: it tells the next node what has been done and what to do next, rather than copying the previous node's entire conversation. If a node depends on several upstream branches, it waits for all their envelopes before starting. Nodes can also use the same workflow workspace files.

## Choose How to Run It

**Manual run** suits work you want to join as it proceeds. The workflow starts at the Entry. You can inspect Agent nodes, join a Meeting Room, or review and edit an envelope at a Pause node. When a meeting ends, its assistant prepares minutes before handing those minutes to the next node.

**Automatic run** suits a workflow that needs no intervention during execution. Run it once, or create a loop profile with a number of rounds, a wait between rounds, and a rule for passing one round's result into the next. Automatic runs cannot contain Meeting Room or Pause nodes.

Before either run starts, the current canvas is saved and checked. If its configuration or connections are invalid, the interface shows what needs fixing and the workflow does not start.

## Let an Agent Advance the Workflow

In Monsoon, describe the task goal, node responsibilities, and handoff requirements, and ask an Agent to create or adjust a Tradewind workflow and start it. It can also read and use an existing workflow.

After starting the run, the Agent can check progress, read node conversations and meeting records, and send additional requirements to Agent nodes. At a meeting node, it can join the discussion, chat privately with the meeting assistant, adjust attendance and speaking order among configured members, and end the meeting so its minutes pass downstream. You review and release Pause nodes on the Tradewind page.

For example:

> Build a workflow to review the usage guide: check facts and wording in two parallel branches, then have a consolidation node collect revision suggestions and output a checklist. Once it is ready, start an automatic run, follow each node's results, and give me the checklist when it finishes.

Open the corresponding Tradewind workflow to see the run on the canvas and progress panel, or open a node to inspect its work.

## Follow Execution and Results

During a run, the canvas and **Workflow Progress** panel show node states and envelope handoffs. Click an Agent node to inspect its conversation, tool activity, and current work. Click a Pause node to confirm or edit its envelope before letting that branch continue. The Exit does not finish the run when the first result arrives; it waits for every envelope expected in that run.

Use **Stop Workflow** at the top to end the entire run. Unfinished content will not be passed downstream. Completed node output and the run record remain available for review. The workflow definition and shared files remain in place so you can run it again later.

## Organize Conversation Records

Agent nodes, meeting public composers, and meeting assistant chats support `/compact` to summarize the current conversation. A meeting's public composer also supports `/reset` to archive and clear both that meeting's public discussion and assistant chat.
