# Tradewind · Workflows

Tradewind arranges agents, meetings, and human actions into visual workflows that can be saved and run repeatedly. Place different node types on a canvas, then connect them to control how tasks, context, and results move forward.

Each workflow has a separate shared workspace. Agent nodes retain their own execution histories while continuing work from upstream envelopes and reading or writing the same directory.

Built-in file tools apply the bound agent's execution permissions, with the workflow directory always included as the current workspace.

The same workflow can run manually or automatically. Manual runs allow human conversation, meetings, and decisions at pause nodes. Automatic runs are unattended and may repeat through loop profiles.

![Envelopes and node status in a running Tradewind workflow](/images/tradewind/runtime-envelope-flow.webp)

## Build a Workflow

Build directly on the canvas, or describe the goal, roles, and human intervention points to a Monsoon agent. The resulting workflow is saved in Tradewind and remains editable on the canvas or through Monsoon.

Discussing or modifying a workflow in Monsoon does not run it. The agent hands work to the saved workflow only after an explicit request or confirmation.

### Node Types

Tradewind provides six node types. Nodes perform stages of work; ordinary edges determine how envelopes move between them.

| Node | Purpose | Run modes |
|------|---------|-----------|
| **Entry** | Supplies the initial task or background to downstream nodes. At least one is required. | Manual, automatic |
| **Agent** | Binds a persistent Console agent and uses its model, tools, and skills on incoming envelopes. | Manual, automatic |
| **Meeting Room** | Lets selected agent nodes discuss, then uses a meeting assistant to produce downstream minutes. | Manual only |
| **Pause** | Waits for human inspection or editing before forwarding an envelope. | Manual only |
| **Note** | Injects durable guidance into connected agent nodes without running or forwarding results. | Manual, automatic |
| **Exit** | Collects final envelopes, ends the run, and creates output and conversation archives. Only one is allowed. | Manual, automatic |

An agent node references a persistent Console agent rather than copying it. It can add a responsibility and delivery delay. Notes connect only to agents; an unconnected Note remains a visual annotation with no runtime effect.

### Canvas Operations

Drag nodes from the left panel or right-click empty canvas space. Nodes can move and resize; use the minimap and zoom controls for larger graphs.

Selecting a node opens its configuration. Every node supports a display name and human note, with additional settings by type. Human notes are canvas metadata and never enter agent prompts.

Drag from a node's right connector to another node's left connector. Right-click nodes to edit, clone, or delete them and edges to delete them. Deleting a node also removes its edges.

### Envelope Flow

Tradewind has two edge types:

- **Ordinary edges** forward a work envelope to every directly connected downstream node after the current task completes.
- **Note edges** are dashed prompt-injection links from Notes to agents. They neither carry results nor trigger execution.

A node with several ordinary incoming edges waits for every upstream envelope in the current round. Ordinary edges cannot form cycles; Entry has no upstream edge and Exit has no downstream edge.

An envelope is a handoff containing organized results, necessary background, and next-step instructions—not the upstream agent's full conversation. Full history remains in the originating node; downstream nodes receive only the prepared handoff.

Several downstream nodes may receive the same envelope. Each keeps separate conversation context while sharing files through the workflow workspace.

## Save and Manage Workflows

Use the top save button. The page also autosaves every five minutes, and always saves immediately before a run so execution uses the latest canvas.

Double-click the display name to rename it. The ID beneath it is stable and continues to own the same directory, workspace, loop profiles, and run history after a rename.

The left list creates, loads, and deletes workflows. Deletion removes the graph, shared workspace, loop profiles, and run history. A running workflow must be stopped first.

Global tool registration is unavailable during Tradewind execution. Nodes use only the tools and skills configured at startup. Create and confirm required tools beforehand in Monsoon or a Cyclone seat conversation.

## Run Modes

Manual and automatic runs share the graph but differ in human intervention, supported node types, and model requirements. Only one Tradewind workflow can run at a time.

### Manual Run

**Manual Run** executes once from Entry. Open any agent node to watch its conversation and, while idle, send messages without waiting for an envelope.

Agent nodes process incoming envelopes in sequence. Humans can enter meeting and pause panels to participate, add information, or choose when to continue.

After Exit receives its first result, it waits for the complete envelope handoff. The run ends and produces final output only after every envelope expected in the current round arrives.

### Automatic Run

**Automatic Run** opens the loop-profile panel. **No Loop · Single Automatic Run** executes once unattended; a loop profile can run the same workflow through multiple cycles.

A profile sets delay between cycles, cycle count, notes, and how one cycle feeds the next:

- **Accumulate** passes the complete previous output forward.
- **Reset** restarts from the initial task and loop notes.
- **Summarize** compresses the previous output and passes its summary.

Every cycle creates a distinct execution record and node conversations while reusing the same shared workspace. Delay begins after the prior cycle completes. An infinite loop continues until manually stopped or a cycle fails.

Meeting Room and Pause nodes are not supported in automatic runs.

### Startup Validation

Before running, Tradewind saves the canvas and validates node settings and connections. Invalid workflows do not start; the page lists required corrections. Automatic runs also verify that agent models support native tool calling.

## Observe and Intervene

The canvas reflects live state. Blue pulses mean a node is processing; an amber outer halo means it is handling an upstream envelope. Successful agent completion shows green for about 15 seconds. Stops and errors remain red instead, and Pause nodes have their own waiting pulse.

The **Workflow · Progress** sidebar summarizes every agent node's state, current envelope, and handoff. Completed, stopped, and failed results remain distinct. After the workflow ends it becomes a read-only run record; loops also show the current cycle.

### Agent Nodes

Select **Chat** on an agent node to open a floating conversation card with generated text, reasoning, tools, SubAgent delegation, and execution state.

Send messages while the node is idle. While it processes an envelope or message, execution remains visible but further messages wait.

A human-initiated reply may be stopped directly. Work on an envelope or `contact` has a downstream delivery obligation and cannot simply be discarded. Use **Pause** to preserve undelivered envelopes for later continuation, or **Stop Workflow** to end the run.

### Meeting Room Nodes

A meeting starts when its node receives an envelope. Its floating card opens on the public meeting and switches independently to assistant chat without mixing either history or stream state.

The public view shows ordered speakers, reasoning, tools, and current state and accepts human additions. Assistant chat reviews the current meeting snapshot privately.

After **End Meeting**, public discussion locks while the assistant produces minutes. Only completed minutes become the downstream envelope.

### Pause Nodes

An arrived envelope puts the node in an amber human-waiting state. **Edit** inspects or changes it; **Continue** forwards the confirmed content.

A Pause blocks only its dependency chain. Other branches keep running, and unconfirmed content is never delivered early.

## Stop a Workflow

The top button becomes **■ Stop** during a run. Stopping:

- cancels active LLM and tool execution;
- prevents incomplete envelopes from moving downstream while retaining completed handoffs;
- leaves interrupted and failed nodes red and preserves successful output; and
- retains the progress sidebar as a read-only terminal record.

A stopped run cannot resume in the middle; start a new run instead.

Stopping one agent reply differs from stopping the workflow. A human-started reply can be stopped alone. Envelope or `contact` work must be paused to preserve its handoff, or ended through **Stop Workflow**.

## Data Layout

Definitions, the persistent shared workspace, and per-run archives are separate. The workflow ID is the directory name and does not change when the display name changes.

```text
data/tradewind/
├── workflows/
│   └── {id}/
│       ├── graph.json
│       ├── meta.json
│       ├── profiles.json
│       └── workspace/
└── runs/
    └── {wfId}/{execId}/
        ├── meta.json
        ├── graph-snapshot.json
        ├── events.jsonl
        ├── output.json
        ├── meetings/
        └── nodes/{nodeId}/messages.json
```

`workflows/{id}/workspace/` persists across runs. Deleting the workflow removes its definition, workspace, loop profiles, and associated run history.

`runs/{wfId}/{execId}/` represents one execution. `meta.json` may be `running`, `done`, `error`, `stopped`, or `crashed`. On restart, leftover `running` records become `crashed`. Some files appear only after their corresponding features execute.

These local runtime directories are excluded from Git. Git exclusion is not a backup; preserve `data/tradewind/` separately when moving workflows, shared files, or history.
