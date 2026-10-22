# Tide · Automated Tasks

Tide lets an Agent repeat a task at a set interval or a fixed daily time. For example, it can check project progress every 24 hours or write a brief report every morning at 08:00. The task triggers while the 4torm backend is running; you do not need to keep the Tide page open. Each run leaves a record you can review.

## Schedule a Task

On the Tide page, select an Agent and click **+** beside the task list. Enter a task name, instructions, schedule, run count, and push target. Tasks created on this page are enabled immediately but do not run immediately. You can also describe an automation in Monsoon and let the Agent create and enable it. If you want to review it first, ask the Agent to save a disabled draft.

- **Interval**: for example, every five minutes. The first interval starts when enabled; subsequent intervals start after the previous run ends.
- **Daily time**: for example, 08:00 each day. This follows the backend computer's current local time zone, independently of a remote client's zone. A time that has already passed is scheduled for the next day. Editing the time, enabling the task again, or starting the backend does not replay missed daily times.

Daily schedules are checked once a second during normal operation. A task already running does not start another overlapping run. Missed daily times after a long sleep are skipped. A local time missing because of daylight saving is skipped that day; a repeated local time uses only its first occurrence.

Each run uses that Agent's current model, tools, skills, and execution permissions from the Console. Use **Run Now** in the task details when you want an early check. Pause a task to prevent future scheduled triggers; pausing does not interrupt a run already in progress.

Once the task is paused and its current run has ended, open **Edit task** in its details to change the name, instructions, schedule, and run count. For a dedicated conversation, you can also change the retained rounds. Save and enable the task again to continue with the updated schedule.

To end a run already in progress, ask Monsoon to abort that specific Tide run and check its final state. Aborting leaves the schedule enabled, does not save an unfinished reply as a completed conversation, and does not undo file operations already performed. Once result saving begins, the run no longer accepts an abort request. To stop all work, pause the schedule first, then abort the current run. An intentional abort is recorded as **Aborted** and does not count toward consecutive failures.

You can also ask Monsoon to change an existing task's assigned Agent. Reassignment is unavailable while the task is executing or its conversation is compacting. A dedicated conversation starts with fresh context, while the original Agent's conversations, files, and run history remain available. A task targeting a Monsoon conversation must explicitly select a target conversation owned by the new Agent.

![Daily task schedule, instructions, and push target, shown in Chinese](/images/tide/task-schedule.png)

*Chinese UI example: a daily 08:00 project brief in its own Tide conversation.*

## Choose Where Results Go

A **Dedicated Tide conversation** suits recurring checks or research. The task has its own conversation and may continue from earlier runs. Set the number of retained rounds to limit how much history is sent to the model. With `1`, each run is independent and archived afterward, leaving the active conversation empty. With a larger even number, the older half is archived when that many rounds have accumulated, and recent rounds remain available. Each result remains available in the task's run history.

The same pooled Agent can work in Monsoon, Cyclone, Tradewind, and other areas concurrently. Its activity elsewhere does not block an independent Tide task. Different independent Tide tasks keep separate conversations and run records; one task does not start an overlapping round before its previous round ends.

These tasks still share the pooled Agent's configuration, memory, workspace, and tool resources. Model service concurrency limits can also delay inference. Separate conversations and run records do not isolate changes to the same files or model quotas.

**Continue a Monsoon conversation** suits periodic results that belong in an existing discussion. The Agent reads that conversation's context and appends the current task instructions and final reply. Tool activity does not appear in the Monsoon conversation, but is saved in the corresponding Tide run record. If the target conversation is already responding, this Tide run fails rather than writing over it or immediately retrying. This busy conflict does not count toward consecutive failures.

Retained rounds control whole-round archiving, which is separate from compaction. When viewing a dedicated Tide conversation, click **Compact conversation** to summarize the active context while preserving the original records. Manual compaction does not promise to retain the latest rounds verbatim.

The page shows execution or compaction status; you can stop compaction before it is committed, and a failed or stopped request continues to use the saved content. After compaction completes, click the **History summary** divider to expand its summary; subsequent messages remain visible normally. Content appended to Monsoon is summarized in the corresponding Monsoon conversation.

![Tide conversation with a history summary divider, tool records, and a later reply, shown in Chinese](/images/tide/task-conversation.png)

*Chinese UI example: the summary is collapsed while the current task, tools, and reply remain available.*

## Let an Agent Manage Scheduled Tasks

In Monsoon, describe the recurring work, its interval or daily time, the Agent responsible, and where results should go, and ask an Agent to create and enable a Tide task. It can schedule tasks for itself or other Agents configured in the Console, inspect existing tasks and run records, and continue existing arrangements.

You can ask it to change task instructions and schedules, pause or enable tasks, run a task immediately and inspect its result, or delete tasks you no longer need along with their Tide records.

For example:

> Check this project's documentation changes every 24 hours, write a brief report, and save it in an independent Tide conversation. Run it once now and read the report so I can see the result.

For a fixed daily time:

> Check project progress and prepare a brief report every morning at 08:00 in the backend computer's current local time zone. Use a daily schedule and skip times missed while the backend is closed. Tell me the next trigger time after creating it.

The Agent tool's `schedule` accepts `every 5m` or `daily 08:00`. Daily schedules use the 24-hour clock.

To bring periodic results into an existing discussion, you can designate a Monsoon conversation belonging to the Agent that executes the task.

Click the task on the Tide page to inspect its settings, enabled state, and run records.

## Let the Task Continue Itself

An ordinary task uses the same instructions each time. With **Agent-led continuation** enabled, the Agent proposes what to do on the next run while continuing toward your original goal. This mode uses an independent Tide conversation, a two-round context window, and ongoing execution. Pause the task when you want it to stop.

## Review and Manage Runs

Task cards show the schedule or execution status, remaining runs, and previous and next trigger times. Open a task to inspect its assigned Agent, schedule, push mode, input usage, and recent run history. Input usage comes from the latest model request. When available, the previous measurement remains visible during execution or compaction and refreshes when new data arrives. New conversations or conversations without recorded usage may show **Unknown**.

Each run record shows its result, time, duration, and turn count. Click **Expand full result** for a long reply and expand tool calls to inspect arguments and results. A conversation link is available when its conversation can be viewed. Independent tasks with one retained round archive every run; use run history to review their results. Failures retain their reasons. After three consecutive failures, the task pauses automatically and can be enabled again after you fix the cause.

New run records save the Agent and archive state at execution time. Conversation links use that record rather than the task's later push mode or retention settings. Older records without this information keep a lookup link; if the original Agent was not recorded, the lookup uses the task's current Agent.

![Tide task overview, input usage, and expandable run history, shown in Chinese](/images/tide/task-overview.png)

*Chinese UI example: the daily brief's schedule, result, and tool-call section.*

Tide does not run while the 4torm backend is closed. Closing only the client of an independent backend does not stop scheduling. After a restart, daily schedules move to a future time. Interval tasks keep their saved schedule and run once if overdue, without replaying every missed interval.
