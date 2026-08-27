# Skills · Usage and Development

Skills are reusable domain knowledge and working methods assignable to different agents. A skill is primarily a `SKILL.md` prompt and may include dedicated script tools.

## Using Skills

Enable skills in an agent's Console configuration. Installed skills are selected by default for new agents; existing agents retain their saved selection.

Instructions do not permanently consume context. An agent loads an enabled skill with `use_skill` when relevant. Bundled tools are added automatically, while their write, delete, and command capabilities still apply normally and remain visible in skill preview.

## SkillMeta

```typescript
export interface SkillMeta {
  id: string
  name: string
  description: string
  category: string
  version: string
  author: string
  hasTools: boolean
}
```

`id` is the unique directory name. `hasTools` is detected dynamically by the server.

## Storage Layout

```text
data/skills/{skillId}/
├── config.json
├── SKILL.md
├── tools.json          # optional
└── executors/          # optional
    └── {toolName}.js
```

## Writing SKILL.md

`SKILL.md` tells an agent how to use the skill. `use_skill` returns it as a tool result only when needed. It is ordinary Markdown with no required structure; role, workflow, output format, and constraints are useful sections.

```markdown
# Code Review

Review submitted code for correctness, security, and maintainability.

## Output

For each issue: `[severity] file:line — problem and suggested fix`
```

## Create and Manage Skills

Use **New Skill** to set a stable folder name, display name, category, description, and `SKILL.md`. Folder names allow lowercase letters, digits, hyphens, and underscores.

Agents may also create complete directories under `data/skills/`, containing at least `config.json` and `SKILL.md`. Automatic scanning hot-loads them without a separate registration confirmation. Skills with tools also provide `tools.json` and `executors/`.

New skills appear in agent settings but are not added to existing agents automatically; future agents select currently installed skills by default.

Removal requires confirmation. If an agent still references the skill, deletion is rejected with the relevant agents listed. Remove those assignments first.

## Skill Tools

Skills may bundle dedicated tools through `tools.json` and an `executors/` directory.

### tools.json Format

`tools.json` uses the same `ToolDef` structure as the global registry:

```json
[
  {
    "name": "my_skill_tool",
    "description": "A tool dedicated to this skill",
    "category": "custom",
    "dangerous": false,
    "executorType": "builtin",
    "executorFile": "my_skill_tool",
    "parameters": {
      "type": "object",
      "properties": { "param1": { "type": "string" } },
      "required": ["param1"]
    }
  }
]
```

### Executor Lookup and Skill Tool Shadowing

Definitions are resolved in this order:

```text
1. server/src/tools/framework/catalog.json
2. data/tools/registry.json
3. data/skills/*/tools.json
```

Framework and global custom tools therefore cannot be overridden by a skill. When a definition comes from a skill, its executor lookup is:

```text
1. data/skills/{skillId}/executors/{fileName}.js
2. data/tools/executors/{fileName}.js
```

### Differences from Global Tools

| Property | Global tool | Skill tool |
|----------|-------------|------------|
| Location | `data/tools/` | `data/skills/{id}/` |
| Independent | Yes | No, belongs to a skill |
| UI | Tools page | Skills page with tool badge |
| Definition merge | Direct registration | Indirect through skill |
| Executor priority | Global | Skill-local first |

## Assign Skills to Agents

`AgentConfig.skills?: string[]` stores skill IDs. The Console displays installed skills as toggles and saves selections under `data/agents/{agentId}/.workspace/config.json`. `/api/skills/list` sets `hasTools: true` when `tools.json` exists.

## Runtime Loading

### On-Demand Instructions

Assigning a skill does not inject `SKILL.md` into the system prompt. The built-in `use_skill` tool loads it when the agent decides it is needed. This avoids permanent token use and allows instructions to be compacted with the conversation.

The loader rejects `/`, `\`, and `..` in names to prevent traversal while permitting normal hyphenated IDs. Its tool description dynamically lists skills available to the current agent.

### Tool Assembly

Before execution, `loadAgentToolDefs()` collects tools from every enabled skill, deduplicates by name, and merges them into the same tool assembly used by every collaboration workspace.

## API Reference

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/skills/list` | Scan `data/skills/` and return `SkillMeta[]` |
| `GET` | `/api/storage/read?path=skills/{id}/SKILL.md` | Read a skill file |
| `DELETE` | `/api/skills/{id}` | Delete after checking agent references |

The frontend store exposes `listSkills()`, `getSkillMeta(id)`, `readSkillFile(id, file)`, and `readSkillToolDefs(id)`.

## Quick Example

### Example: Git Skill with Tools

Directory structure:

```text
data/skills/git-ops/
├── config.json
├── SKILL.md
├── tools.json          # defines git_status and git_diff
└── executors/
    ├── git_status.js
    └── git_diff.js
```

`executors/git_status.js`:

```javascript
import { execSync } from 'child_process'

export default async function (args, ctx) {
  const output = execSync('git status --short', {
    encoding: 'utf-8',
    cwd: ctx.workspaceDir,
    timeout: 10000,
  })
  return output || '(working tree clean)'
}
```

`SKILL.md`:

```markdown
# Git Ops

You are a Git operations specialist. Use git_status and git_diff to inspect the repository.

## Workflow
1. Run git_status to inspect the overall state
2. Read file diffs as needed
3. Summarize the changes
```

After assignment, the agent receives its selected global tools plus `git_status` and `git_diff`, deduplicated automatically. At execution time, a tool definition originating from this skill uses the skill-local executor first and the global executor directory as a fallback.

See [Tools](./tools) for every tool-definition field.
