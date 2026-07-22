# 技能 · 使用与制作

技能是可以反复分配给不同 Agent 的领域知识与工作方法。它主要由一份 `SKILL.md` 提示词组成，也可以附带完成该类任务所需的专用脚本工具。

## 使用技能

在控制台的 Agent 配置页面中选择技能即可启用。新建 Agent 时，当前已安装的技能默认处于选中状态，也可以在保存前手动取消；编辑已有 Agent 时，系统会保留原来的选择。

技能说明不会一直占用 Agent 的上下文。Agent 会在判断任务需要时主动加载对应技能，因此启用技能代表允许它使用这份知识，并不意味着每次对话都会完整注入。

技能可以附带专用工具。启用技能后，这些工具会自动加入 Agent 的可用工具列表，不需要再从全局工具中重复选择。工具本身的读写、删除或命令执行能力仍按工具配置生效，启用前可以在技能预览中查看其说明和附带工具。

## SkillMeta 接口

定义位置:`src/types/index.ts`

```typescript
export interface SkillMeta {
  id: string;          // 目录名, 唯一标识 (如 "code-review")
  name: string;        // 显示名称
  description: string; // 功能描述
  category: string;    // 分类 (自由文本)
  version: string;     // 版本号
  author: string;      // 作者
  hasTools: boolean;   // 是否包含 tools.json (服务端动态检测)
}
```

## 存储布局

```
data/skills/
  {skillId}/                    ← 每 skill 一个目录, 目录名 = skill id
    config.json                 ← SkillMeta (不含 hasTools, 服务端动态检测)
    SKILL.md                    ← 提示词内容 (Markdown, LLM 可见)
    tools.json                  ← (可选) 工具定义数组, 格式同 ToolDef
    executors/                  ← (可选) 工具执行器
      {toolName}.js             ← export default async function(args, ctx) { ... }
```

## SKILL.md 提示词内容

`SKILL.md` 是技能的核心——定义 Agent 如何使用该技能的指令。Agent 通过内置 `use_skill` 工具按需加载,Skill 指令以 tool result 形式出现在对话中,用完即过。

纯 Markdown,无特定格式约束。推荐包含:角色定义、工作流程、输出格式、约束规则。

```markdown
# Code Review 技能

你是代码审查专家。接收代码或 PR 描述后,按以下标准审查:

## 审查维度(按严重程度排序)
### Critical(阻断性)
- 安全漏洞(SQL 注入、XSS、硬编码密钥)
...

## 输出格式
每条问题:`[严重程度] 文件:行号 — 问题描述 + 修复建议`
```

## 创建和管理技能

在 Skills 管理页面中点击「新建技能」，填写技能文件夹名、显示名称、分类、描述和 `SKILL.md` 内容后即可创建。

技能文件夹名是本地保存时使用的稳定名称，只能包含小写字母、数字、连字符和下划线。

Agent 自己也可以根据任务需要创建技能。它会在 `data/skills/` 下写入完整的技能目录；至少包含 `config.json` 和 `SKILL.md`。系统自动扫描热装载，不需要再经过单独的注册确认。技能附带额外脚本工具时，还需要提供 `tools.json` 和对应的 `executors/`。

创建成功后，技能会出现在 Agent 配置页面中。已有 Agent 不会自动启用新技能，需要在控制台中手动选择；之后新建的 Agent 会默认选中当前已经安装的技能。

移除技能需要再次确认。若技能仍被某个 Agent 使用，系统会拒绝移除并列出相关 Agent；先取消关联，再回到 Skills 页面移除。

## 技能工具(Skill Tools)

Skill 可通过 `tools.json` 和 `executors/` 目录携带专属工具。

### tools.json 格式

与 `tools/registry.json` 中的 `ToolDef` 结构一致(不要求包含 TS 层面的全部字段):

```json
[
  {
    "name": "my_skill_tool",
    "description": "专属工具描述",
    "category": "custom",
    "dangerous": false,
    "executorType": "builtin",
    "executorFile": "my_skill_tool",
    "parameters": {
      "type": "object",
      "properties": {
        "param1": { "type": "string", "description": "参数说明" }
      },
      "required": ["param1"]
    }
  }
]
```

### 执行器查找顺序(skill 工具 shadowing)

当 Agent 调用工具时,服务端(`server/src/services/tool-executor.ts`)按以下顺序查找定义:

```
1. findToolInRegistry(tool)   → data/tools/registry.json
2. findToolInSkills(tool)     → 遍历所有 data/skills/*/tools.json
   └── 命中后标记 _skillId,执行器查找优先查 skill 自身 executors
```

执行器加载优先级:

```
1. data/skills/{_skillId}/executors/{fileName}.js   ← skill 自身执行器(优先)
2. data/tools/executors/{fileName}.js                 ← 全局执行器(回退)
```

这意味着 Skill 工具可以**覆盖**全局同名执行器。

### 与全局工具的区别

| 特性 | 全局工具 (registry.json) | Skill 工具 (tools.json) |
|------|------------------------|------------------------|
| 存储位置 | `data/tools/` | `data/skills/{id}/` |
| 独立存在 | ✅ 是 | ❌ 否(必须属于 skill) |
| 面板可见 | Tools 页面 | Skills 页面(含 🔧 标记) |
| 注册表共享 | 直接注册 | 通过 skill 间接合并 |
| 执行器 shadowing | N/A | 优先查找自身 executors/ |

## Agent → Skill 分配

`AgentConfig`(`src/types/index.ts`)的 `skills?: string[]` 字段保存 Skill ID 列表。

1. **Agent 配置面板** → "技能" 标签页:以 toggle 卡片展示所有已安装 skill,勾选即关联
2. **保存路径**:`data/agents/{agentId}/.workspace/config.json` 的 `skills` 字段
3. 若 skill 目录下存在 `tools.json`,服务端(`server/src/routes/skills.ts`)在 `/api/skills/list` 返回时设 `hasTools: true`,UI 显示「🔧 含工具」徽章

## 运行时加载机制

### 提示词加载 — `use_skill` 按需注入

Skill 的提示词通过内置 `use_skill` 工具按需加载。Agent 被分配 Skill 后**不会**自动注入 SKILL.md 到系统提示词,而是由 Agent 自行判断何时需要并主动调用。

- **省 Token** —— Skill 指令仅在调用时以 `<result>` 形式出现,`/compact` 后可压缩,不永久占用上下文
- **按需触发** —— 与任务无关的 Skill 不会被加载

执行器路径:`data/tools/executors/use_skill.js` —— 读取 `data/skills/{name}/SKILL.md` 并返回内容。**安全检查**:拦截技能名中的 `/`、`\`、`..`(防路径遍历);连字符等普通字符放行(故 `code-review` 这类名称可用)。

**动态描述**:Agent 被分配技能后,`use_skill` 工具的 description 自动更新为「加载技能指令。当前可用技能: code-review, web-search」,Agent 从工具列表即可获知可加载哪些技能。

### 技能工具合并

在 Agent 执行前,服务端 `loadAgentToolDefs()`(`server/src/engine/shared/tool-defs-loader.ts`)收集该 Agent 所有 skill 的工具定义并按名称去重合并到工具列表——所有协作模式共用这一套装配逻辑。

## API 参考

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 技能列表 | `GET` | `/api/skills/list` | 扫描 `data/skills/`,返回 `SkillMeta[]` |
| Skill 文件读取 | `GET` | `/api/storage/read?path=skills/{id}/SKILL.md` | 通用存储 API |
| Skill 删除 | `DELETE` | `/api/storage/delete?path=skills/{id}` | 递归删除目录 |

客户端 store 函数(`src/store/skills.ts`):`listSkills()` / `getSkillMeta(id)` / `readSkillFile(id, file)` / `readSkillToolDefs(id)` / `createSkill(id, meta, md)` / `deleteSkill(id)`。

## 快速上手示例

### 示例:含工具的 Git 技能

**目录结构:**

```
data/skills/git-ops/
  config.json
  SKILL.md
  tools.json          ← 定义 git_status / git_diff
  executors/
    git_status.js
    git_diff.js
```

**executors/git_status.js:**

```javascript
import { execSync } from 'child_process'

export default async function (args, ctx) {
  const output = execSync('git status --short', {
    encoding: 'utf-8',
    cwd: ctx.workspaceDir,
    timeout: 10000,
  })
  return output || '(工作区干净)'
}
```

**SKILL.md:**

```markdown
# Git Ops 技能

你是 Git 操作专家。使用 git_status 和 git_diff 工具查看仓库状态。

## 工作流程
1. 先用 git_status 查看整体状态
2. 根据需要读取具体文件的 diff
3. 总结变更内容
```

分配给 Agent 后,运行时该 Agent 的工具列表 = 配置的全局工具 + `git_status` + `git_diff`(自动合并去重);执行时服务端先查全局 executors,不存在则回退到 skill 自身 executors。

> 工具定义的完整字段见[工具制作](./tools)。
