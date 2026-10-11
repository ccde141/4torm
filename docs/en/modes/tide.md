# Tide · Automated Tasks

Tide lets an Agent repeat a task at a set interval. For example, you can ask it to check project progress and write a brief report every day. The task triggers while 4torm is running; you do not need to keep the Tide page open. Each run leaves a record you can review.

## Schedule a Task

On the Tide page, select an Agent and set the task instructions, interval, and number of runs. You can also describe an automation in Monsoon and let the Agent create and enable it. If you want to review it first, ask the Agent to save a disabled draft. Once enabled, the first trigger time is calculated from creation. Creating a task does not run it immediately.

Each run uses that Agent's current model, tools, skills, and execution permissions from the Console. Use **Run Now** in the task details when you want an early check. Pause a task to prevent future scheduled triggers; pausing does not interrupt a run already in progress.

## Choose Where Results Go

An **independent Tide conversation** suits recurring checks or research. The task has its own conversation and may continue from earlier runs. Set the number of retained rounds to limit how much history is sent to the model. With `1`, each run is independent and archived afterward. With a larger even number, the older half is archived when that many rounds have accumulated, and recent rounds remain available.

A **designated Monsoon conversation** suits periodic results that belong in an existing discussion. The Agent reads that conversation's context and appends the current task instructions and final reply. Tool activity does not appear in the Monsoon conversation, but is saved in the corresponding Tide run record. If the target conversation is already responding, this Tide run fails rather than writing over it or immediately retrying.

When viewing an independent Tide conversation, click **Compact session** to summarize it. Content appended to Monsoon is summarized in the corresponding Monsoon conversation.

## Let an Agent Manage Scheduled Tasks

In Monsoon, describe the recurring work, its interval, the Agent responsible, and where results should go, and ask an Agent to create and enable a Tide task. It can schedule tasks for itself or other Agents configured in the Console, inspect existing tasks and run records, and continue existing arrangements.

You can ask it to change task instructions and schedules, pause or enable tasks, run a task immediately and inspect its result, or delete tasks you no longer need along with their Tide records.

For example:

> Check this project's documentation changes every 24 hours, write a brief report, and save it in an independent Tide conversation. Run it once now and read the report so I can see the result.

To bring periodic results into an existing discussion, you can designate a Monsoon conversation belonging to the Agent that executes the task.

Click the task on the Tide page to inspect its settings, enabled state, and run records.

## Let the Task Continue Itself

An ordinary task uses the same instructions each time. With **Self-Loop** enabled, the Agent proposes what to do on the next run while continuing toward your original goal. This mode uses an independent Tide conversation, a two-round context window, and ongoing execution. Pause the task when you want it to stop.

## Review and Manage Runs

Task cards show whether a task is enabled, its remaining runs, and its previous and next trigger times. Open a task to inspect recent run outcomes, the Agent's replies, and related conversations. Failures retain their reasons. After three consecutive failures, the task pauses automatically and can be enabled again after you fix the cause.

![Tide task status, instructions, and run history](/images/tide/task-history.webp)

Tide does not run while 4torm is closed. After restart, scheduling continues from saved task states and next trigger times; it does not replay every trigger missed while the app was closed.
