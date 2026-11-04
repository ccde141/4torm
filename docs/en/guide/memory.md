# Memory and Recall

Memory preserves information worth using again. Recall helps an Agent find relevant information for its current task.

You can save preferences, project agreements, confirmed facts, and experience for an Agent, or ask it to search earlier work records. The two levels of automatic recall currently apply to Monsoon conversations.

## Memory and Conversation Records

| Content | What it contains | When to use it |
|---|---|---|
| **Agent long-term memory** | Preferences, agreements, experience, and reference pointers | When the same Agent should refer to this information across conversations |
| **Conversation history** | Human messages, Agent replies, and tool execution records | To review the original exchanges and actions |
| **Compaction work records** | Background, progress, decisions, and remaining work organized during conversation compaction | To find out what was done and where the work stopped |
| **Cyclone seat memory** | Role experience, facts, and material references for the current project | When a seat should accumulate knowledge about its project |

Long-term memory belongs to its Agent, and each Agent keeps its own entries. Cyclone seat memory belongs to the seat and remains when its bound Agent changes.

## Save and Manage Memory

Open an Agent card in the **Console**, then select **Memory** to add, edit, or delete entries.

There are four categories:

- **Preference / correction**: Wording preferences, working methods, or corrections you want the Agent to follow.
- **Fact**: Confirmed information that may be useful again.
- **Pitfall**: A problem, the conditions in which it occurred, and an effective way to handle it.
- **Reference**: Documents, file locations, and other information worth finding again.

You can also ask directly in a conversation:

> Remember that this project's interface copy uses Chinese, with English technical terms where needed. This agreement applies only to this project.

The Agent can save this information with its memory tools. Afterward, you can inspect and adjust it on the Agent's **Memory** page.

Keep each entry focused on one topic, with a clear project, conditions, and conclusion. For example, “The orders page displays 24 items per page” is easier to apply correctly than “Always use 24 items.”

## Three Ways to Recall Information

### Level 1: Indexed Recall

Level 1 searches for memories and work records relevant to the current message.

You can use keyword search without an embedding model. With an embedding model configured, recall can also match similar meanings: for example, “Which language should the interface use?” can match a saved entry saying “Project copy uses Chinese.”

This level does not need an additional conversation model to select entries.

### Level 2: Model-Assisted Recall

Level 2 uses a separately selected language model to search, read, and select relevant sources based on the current message and recent conversation.

It can search beyond the initial candidates, or select no entries when none are useful. Selected information goes to the main Agent as historical reference; the main Agent still produces the reply.

You can enable Level 2 independently, without first configuring an embedding model.

### Explicit Queries

An Agent can also use tools to search memories, read entries, or inspect the original material behind a work record when the task calls for it.

You can ask:

> Check our earlier agreements for this project before continuing the changes.

Turning off Level 1 or Level 2 automatic recall does not disable explicit Agent memory queries.

## Configure Memory Recall

Open **Settings → Memory recall** to configure indexed and model-assisted recall separately.

### Indexed Recall

Enable **Level 1 · Indexed recall**, then choose:

- **Keyword search**: No embedding model is needed.
- **Embedding model**: Select a model that supports an embeddings endpoint, then select **Verify embeddings**.

An embedding model converts text into vectors for comparing relevance. It does not generate conversation replies. Use a conversation model for Level 2 selection; vector retrieval requires a model service that actually provides an embeddings endpoint.

You can run an embedding model locally or use a cloud service. Configure the connection and model under Model Providers first, then select it here.

Indexing, updates, and queries use the embedding model; existing record vectors are reused. Local deployment uses your computer's resources, while cloud calls are billed according to the provider's rules.

### Model-Assisted Recall

Enable **Level 2 · Model-assisted recall**, choose an **Intermediate recall model**, and select **Verify model** to check its connection and sample selection.

The recall model can differ from the main conversation model. To reduce waiting, choose a responsive cloud model or a lightweight Instruct model. For a local model, choose according to your hardware and observed response speed.

Model selection makes additional model calls. Selected references also take up context when they enter the main conversation.

You can enable or disable each level separately. Select **Save** to apply changes. Turning a level off preserves its selected model.

## Choose Recall Timing

**Recall timing** controls when Level 2 model selection runs.

| Mode | What happens | When to choose it |
|---|---|---|
| **Recall before sending** | Memory selection finishes before the main Agent handles this message | When you want the current reply to use recalled information |
| **Recall after sending** | Related sources are prepared in the background while the main Agent handles this message; relevant sources can accompany a later message | When you want the current reply to begin promptly, or the recall model responds more slowly |

With recall before sending, the interface shows **Agent is recalling memories** before the normal reply process begins.

Level 1 still matches sources against the current message without waiting for background Level 2 selection to finish.

## Inspect References Used in a Conversation

Automatically recalled sources appear above the corresponding human message under **This recall** or **Related memories**. Both labels describe the same kind of record.

Expand the entry to inspect:

- The referenced memory or work record;
- The content included in this conversation;
- Whether it came from indexed recall or model selection;
- Available source details, such as the project, date, and compaction number for the day.

This view shows references already included in the conversation. Background search candidates appear here only after selection and inclusion.

The same reference is not repeatedly appended while it remains in the current context. A new message therefore does not always produce a new memory entry.

## Continue Work After Compaction

Conversation compaction organizes background, agreements, progress, and remaining steps so the current task can continue. Successfully saved compaction summaries can also be searched as work records, retaining their date, compaction number for the day, and source conversation.

For example, in another Monsoon conversation with the same Agent, you can say:

> Continue last week's material organization work. Find the earlier work records first and check what is finished and what remains.

The Agent can read the relevant summary, then consult the corresponding original records when details need checking.

Compaction work records and long-term memory are stored separately. Project experience can remain in work records; methods, preferences, and agreements worth reusing can be saved as long-term memory entries.

## Update and Delete Sources

When information changes, edit it on the Agent's **Memory** page. New recall checks its sources and uses currently valid content.

After you edit a conversation or compaction summary, related work records are updated from the revised content. When you delete a source conversation, its work records stop participating in subsequent recall.

These actions affect future retrieval and references. Replies already generated remain in their original conversations. State new requirements directly in the current conversation, for example:

> The earlier agreement of 24 items per page has changed. Use 30 this time and update the corresponding memory.
