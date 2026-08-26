# Tide · Automated Tasks

Tide makes an agent repeat work at fixed intervals. Each task binds a registered agent and defines its instructions, interval, and run count. At trigger time, the server wakes the agent and stores its reply, tool calls, and run result.

Every run reads the agent's current model, tools, skills, and execution permissions from the Console. Built-in file tools use that agent's workspace. A task can maintain an independent Tide conversation or append results to a designated Monsoon conversation. The former suits standalone recurring work; the latter feeds periodic results into an existing discussion.

Scheduling runs on the server, so the Tide page need not remain open. Tasks do not run while 4torm is closed. After restart, scheduling continues from persisted task configuration and next-trigger times.

Global tool registration is unavailable during Tide runs. A task uses only tools and skills enabled on its agent at trigger time. Create and confirm new tools beforehand in Monsoon or a Cyclone seat conversation.

![Tide task details and run history](/images/tide/task-history.webp)

## Create a Task

Create tasks manually on the Tide page or ask the current agent in Monsoon to create one for itself. A Monsoon agent can configure the interval, instructions, repeat count, rolling window, and self-loop, and inspect or edit existing tasks, but cannot enable or pause them.

Tasks created through Monsoon start disabled and require review and manual activation in Tide. An unattended Tide run cannot create or modify automation tasks, preventing autonomous task proliferation.

Select an agent on the left and use the plus button beside the task list. The task binds that agent permanently. Its name, interval, instructions, and remaining count can be edited later, but the agent cannot be replaced. A dedicated agent is useful for long-running automation because it isolates conversations, status, and workspace files.

Configure:

- **Task name** for lists and run records.
- **Interval** in hours, minutes, and seconds; all three cannot be zero.
- **Instructions** sent to the agent at each trigger.
- **Repeat count** as a positive planned count, or `-1` for perpetual execution. After creation, the UI shows remaining runs.
- **Push target** as an independent Tide conversation or an existing Monsoon conversation.
- **Retained rounds** for independent Tide context. `1` gives every run a fresh context and archives it immediately afterward. An even number at least `2` archives the older half once the limit is reached and keeps the newer half.
- **Self-loop mode**, which lets the agent determine the next round's instructions. It forces an independent Tide conversation, a two-round window, and perpetual execution.

A task created manually is enabled immediately and schedules its first trigger from the current time; creation itself does not execute it. Its card shows status, remaining count, and previous and next run times.

## Push Targets and Conversations

The push target determines where a run reads context and saves its reply. Choose **Accumulated Tide Conversation** or **Designated Monsoon Conversation**.

### Independent Tide Conversation

The default accumulated mode gives each task its own Tide conversation. Instructions, replies, and tool calls stay there and do not enter the agent's Monsoon conversations.

Later runs can read previous rounds according to the retention window. Older content is archived at the configured threshold so active context does not grow indefinitely.

This mode suits recurring checks, organization, content generation, and other long-term work that should remain outside everyday conversations.

### Designated Monsoon Conversation

Designated mode attaches the task to an existing Monsoon conversation owned by the same agent. At each trigger, the agent reads that conversation and appends this run's instructions and final reply.

Only the instructions and final reply are appended. Tool execution remains in the Tide run record. Rolling-window retention and automatic Tide archiving do not apply, so the Monsoon context continues to grow.

If the target conversation is replying, the run fails without modifying it or retrying immediately. Several tasks may target one conversation, but cannot write simultaneously; a later conflicting run also fails and waits for its next scheduled time.

## Rolling Window and Automatic Archiving

Rolling windows apply only to independent Tide conversations. **Retained rounds N** limits recent active context. Archived content remains local but is no longer sent to the model.

- **N = 1**: every run is independent and reads no previous round; the complete record is archived immediately after completion.
- **N ≥ 2**: N must be even. At N rounds, the older N/2 are archived and the latest N/2 remain as context.

With `N = 8`, completing round 8 archives rounds 1–4 and retains 5–8. After four more rounds, the window advances again. This limits long-running context without suddenly clearing all continuity.

## Self-Loop Mode

A normal Tide task repeats the same instructions. In self-loop mode, the agent provides the concrete next task when finishing each round. The original instructions remain the highest-level goal; subsequent tasks can evolve only within it.

The system extracts this handoff and updates the current task instructions without displaying the handoff in the final reply. The next trigger receives both the original goal and latest task.

Self-loop mode fixes the task to an independent Tide conversation, a two-round rolling window, and perpetual execution. It does not end when the agent decides the work is complete; pause it manually. If no valid next task is produced, the current instructions remain for the next trigger.

## Manage Tasks

Task cards show status, remaining runs, and previous and next run times. Select one to inspect its configuration and five most recent records.

### Pause and Edit

Pausing prevents future automatic triggers but does not abort a run already underway. While paused, edit the name, interval, instructions, retained rounds, and remaining count.

Re-enabling calculates the next trigger from that moment and does not backfill runs missed while paused.

### Run Now

**Run Now** triggers early and never starts a duplicate while the same task is active.

For an enabled task, it counts as a normal trigger: it reduces remaining runs and recalculates the next time. For a paused task, it is a one-off manual run that neither reduces the count nor changes the existing schedule.

### Conversations and Run Records

Task details show success or failure, duration, tool-call rounds, and a reply summary for the five latest runs. **View Conversation** opens the complete conversation for that run.

After selecting an agent, the left list shows its independent Tide conversations. Designated Monsoon conversations are not duplicated there but remain accessible from run history.

### Delete Tasks and Conversations

Deleting a task removes its configuration, run records, and its own Tide conversation and archives. A running task cannot be deleted until the current run ends.

Deleting a task that targets Monsoon never deletes that Monsoon conversation.

After pausing an independent task, you may delete only its active conversation while retaining archives. The next run creates a new active conversation.

## HTTP API

Every endpoint is prefixed with `/api/tide`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/tasks` | List tasks |
| `POST` | `/task` | Create a task |
| `GET` | `/task/:taskId` | Task details and five latest runs |
| `PATCH` | `/task/:taskId` | Update a task |
| `DELETE` | `/task/:taskId` | Delete a task and its archives |
| `POST` | `/task/:taskId/toggle` | Enable or pause |
| `POST` | `/task/:taskId/run-now` | Run once immediately |
| `GET` | `/task/:taskId/runs?limit=20` | Run history |
| `GET` | `/sessions/:agentId` | Tide conversation summaries for an agent |
| `GET` | `/session/:agentId/:sessionId` | Complete conversation messages |
| `DELETE` | `/session/:taskId` | Delete the active conversation and retain `bak` archives |

## Failures and Automatic Pausing

Every success and failure is stored in run history. Failures retain the concrete cause so agent, model, tool, and target-conversation problems can be distinguished.

One failure does not disable a task; it waits for the next schedule. After three consecutive failures, Tide pauses it and reports that state in task details. Fix the cause, then re-enable it manually.

A run blocked because its designated Monsoon conversation is already occupied is recorded as failed but does not modify the conversation and does not count toward consecutive failures.

## Data Layout

```text
data/tide/
├── tasks.json
├── tasks.template.json
└── runs/
    └── {taskId}/
        └── 2026-06-04T03-09-27.573Z.json
```

### Task Configuration Type

```typescript
interface TideTask {
  id: string
  name: string
  schedule: string          // "every 5m" / "every 2h30m" / "every 30s"
  prompt: string
  agentId: string
  repeatCount: number       // -1 = perpetual, N = remaining, 0 = finished
  pushMode: 'accumulate' | 'designated'
  targetSessionId?: string
  windowN: number           // 1 or an even number >= 2
  selfLoop: boolean
  consecutiveErrors: number
  enabled: boolean
  createdAt: string         // ISO format
  lastRun?: string
  nextRun?: string
}
```
