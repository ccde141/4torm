# 风暴沙盒 — 节点完整参考手册

## 一、信封（Envelope）结构

每个节点之间传递的数据载体，由 `Envelope` 接口定义（`src/types/sandbox.ts`），支持 XML 序列化/反序列化（`src/engine/sandbox/envelope.ts`）。

| 字段 | 类型 | 传播策略 | 说明 |
|------|------|---------|------|
| `meta` | `EnvelopeMeta` | **重建** | `flowId` / `nodeId` / `forkIndex` / `iteration` — 每跳到下游由 `createEnvelopeFromUpstream` 重建 |
| `goal` | string | **透传** | 工作流全局目标。Entry 节点写入，`createEnvelopeFromUpstream` 逐跳拷贝 |
| `input` | string | **逐跳覆写** | 核心数据载体。Entry 写入初始值；Agent 写入 LLM 回复；merge 写入拼接结果；每跳由上游 `input` 提取后传入，节点执行后再覆盖 |
| `context` | string | **自动生成** | 上游工作摘要。包含上游角色前缀 + 智能截断的上游 input（≤1000 字完整保留，超出则截断于完整段落边界）。通过连线 `contextMode: false` 可禁用 |
| `variables` | `Record<string, unknown>` | **深拷贝** | 全局变量键值对。`createEnvelopeFromUpstream` 执行 `deepCopy`，Variable/Agent 节点可读写 |
| `role` | string | **逐跳覆写** | 各节点按其语义设置：Entry → label；Agent → agentRole；Merge → "汇总上游结果"；可通过连线 `injectRole: true` 用上游值覆盖 |
| `requirement` | string | **重置** | 默认 `"深刻理解目标，严谨执行，按 output_schema 输出，不得增减字段。"` — 仅无工具 Agent 模式使用 |
| `outputSchema` | `Record<string, unknown>\|null` | **重置为 null** | Agent 节点可通过 data.outputSchema 设置 |
| `reminder` | string | **重置** | 默认 `"严格按照 output_schema 输出，不得附加自由文本。"` — 仅无工具 Agent 模式使用 |

**新信封默认值**（`createEnvelope()`）：
```
goal: ''         role: ''         context: ''         input: ''
variables: {}    requirement: "深刻理解目标，严谨执行..."    outputSchema: null
reminder: "严格按照 output_schema 输出..."
```

**逐跳传递流程**（`createEnvelopeFromUpstream()`）：
1. `goal` = 上游 `goal`（逐跳透传）
2. `variables` = `deepCopy(上游.variables)`（深拷贝隔离）
3. `context` = 上游工作摘要（含上游角色前缀 + 智能截断，若 contextMode !== false）
4. `input` = `extractField` 提取 → 上游 input（若未配 extractField）
5. `role` / `requirement` / `reminder` / `outputSchema` = 新信封默认值（节点执行后再按需覆写）

```
     上游 Node A                         下游 Node B
┌─────────────────────┐          ┌─────────────────────┐
│ goal: "写一个爬虫"  │ ──透传──→ │ goal: "写一个爬虫"  │   ← copy
│ input: "import..."  │ ──extract→ │ input: "import..."  │   ← extractField 或默认
│ context: ""         │ ─智能摘要→│ context: "[上游角色:..] import url"│  ← summarizeEnvelope
│ variables: {a:1}    │ ──深拷──→ │ variables: {a:1}    │   ← deepCopy
│ role: "代码专家"    │ ──重置──→ │ role: ""            │   ← 新建默认值，节点自行覆写
│ requirement: "..."  │ ──重置──→ │ requirement: "..."  │   ← 新建默认值
│ outputSchema: null  │ ──重置──→ │ outputSchema: null  │   ← 新建默认值
│ reminder: "..."     │ ──重置──→ │ reminder: "..."     │   ← 新建默认值
└─────────────────────┘          └─────────────────────┘
```

---

## 二、连线配置（Arrow Config）

每条连线上可配置 3 个选项，在画布上**右键连线 → 配置箭头**：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `extractField` | string | 空 | 从上游信封中提取指定字段作为下游 input。可选：`input` / `context` / `role` / `variables.key`。留空 = 上游完整 output |
| `contextMode` | boolean | `true` | 是否向下游携带上游工作摘要（包含上游角色 + 智能截断的 input 内容） |
| `injectRole` | boolean | `false` | 是否用上游 `input` 覆盖下游 Agent 节点的 `role`。**不依赖 `extractField`，独立生效**。生效顺序：先设节点自身 `agentRole`，再 apply injectRole（可覆盖），覆盖后该值被 `resolveTemplate` 解析并作为 System Prompt 中的角色指令 |

---

## 三、内置节点类型

所有节点类型定义在 `src/types/sandbox.ts` 的 `SandboxNodeType` 联合类型中，共 12 种（文档列出 10 种可用节点，2 种仅兼容旧工作流）。

执行注册（`register()`）在 `src/engine/sandbox/executor.ts` 中，React Flow 渲染组件注册在 `src/components/sandbox/FlowCanvas.tsx` 的 `nodeTypes` 中。

**10 种可用节点总览：**

| 节点 | ts type | 可执行 | 画布渲染 | 面板可创建 |
|------|---------|--------|---------|-----------|
| `entry` | EntryNode | ✅ | ✅ EntryNode | ✅ |
| `agent` | AgentNode | ✅ | ✅ AgentNode | ✅ |
| `condition` | ConditionNode | ✅ | ✅ ConditionNode | ✅ |
| `merge` | MergeNode | ✅ | ✅ MergeNode | ✅ |
| `fork` | ForkNode | ✅ | ✅ ForkNode | ✅ |
| `variable` | VariableNode | ✅ | ✅ VariableNode | ✅ |
| `human-gate` | HumanGateNode | ✅ | ✅ HumanGateNode | ✅ |
| `error-handler` | ErrorHandlerNode | ✅ | ✅ ErrorHandlerNode | ✅ |
| `output` | OutputNode | ✅ | ✅ OutputNode | ✅ |
| `group` | GroupNode | ❌ (非执行) | ✅ GroupNode | ✅ (侧栏) |
| `note` | NoteNode | ❌ (非执行) | ✅ NoteNode | ✅ (侧栏) |

> `loop-count`、`subflow` 已删除。`loop-while` 已冻结（类型保留，但不推荐使用）。

### 通用操作

**拖拽缩放：** 选中节点后，四角出现 8px 手柄，拖拽即可自由调整节点宽度和高度。

| 节点类型 | 最小尺寸 | 默认尺寸 |
|----------|---------|---------|
| Group | 160×100 | 300×200 |
| Note | 140×60 | 180×100 |
| 其他标准节点 | 140×50 | 180×60 |

**z 轴层级：** 右键节点 → 右键菜单提供三个层级控制项：
- `上移一层` — 最高手动层级 +1
- `下移一层` — 最低降至 1
- `重置层级` — 恢复默认：execStatus='running' → 20, standard → 10, note → 1, group → 0

**执行状态视觉反馈：** 节点在执行时会显示颜色/动画反馈：
- **执行中（running）**：节点蓝色边框 + 蓝色脉冲光圈呼吸动画
- **出错（error）**：节点红色边框 + 红色发光阴影
- **完成（done）/ 空闲（idle）**：保持原有样式

---

### 3.1 Entry — 入口

工作流起点，写入初始目标和输入。

**代码位置:** `executor.ts` → `register('entry', ...)`

**配置面板字段：**

| 字段 | 键 | 类型 | 说明 |
|------|-----|------|------|
| 节点名称 | `label` | text | 显示在画布上，同时写入 `role` |
| 输入内容 | `inputContent` | textarea | 任务目标描述 |

**数据流向：**
```
READ:  data.inputContent, data.label
WRITE: envelope.goal   = data.inputContent
       envelope.input  = envelope.input || data.inputContent  // 有上游则保留上游输入
       envelope.role   = data.label || '任务入口'
```

**与旧版的差异：** `input` 不再硬编码为 `data.inputContent`。若 Entry 有上游输入（例如作为 loop body 中的子节点），`input` 保留上游值，仅 `goal` 始终设为 `inputContent`。这使 `goal` 和 `input` 在语义上可区分。

---

### 3.2 Agent — 智能体

核心节点，调用 LLM API 执行任务。**同一节点类型通过不同 `agentRole` 可充当 Planner、Executor、Reviewer 等不同角色。**

**Agent 节点命名规则：** 画布上显示优先使用节点配置面板中的 `label`（节点名称），若未设置则回退到 Agent 的 Dashboard 名称。副标题行显示 `↳ Agent原始名` 以区分节点标识和 Agent 来源。

**代码位置:** `executor.ts` → `register('agent', ...)`

#### 数据加载流程

1. 通过 `getAgentModel(agentId)` 解析模型名称 → `getProviderForModel(model)` 查找提供商 → `buildRequestOptions()` 构建请求配置
2. 通过 `getAgent(agentId)` 获取完整 Agent 配置（tools / skills / maxToolCalls / workspace）
3. `workspace` = `data.workspacePath || config?.workspace || 'data/agents/{id}/.workspace/'`
4. 调用 `getToolsByNames(config.tools)` 加载工具定义 → `readSkillToolDefs(skillId)` 加载技能定义并合并去重
5. `resolvedRole` = `resolveTemplate(envelope.role, envelope)` — 从 `envelope.role` 解析模板变量（此时 `envelope.role` 已是 `agentRole` 经过 injectRole 可选覆盖后的最终值）

**执行路径分支：** 取决于 tools/skills 是否为空

| 条件 | 路径 | LLM 调用次数 |
|------|------|------------|
| `toolDefs.length > 0` | 两层套壳：内层 ReAct + 外层封装 | 3+ (至少内层1轮 + 外层1次) |
| `toolDefs.length === 0` | 单次调用（原有行为） | 1 |

#### 路径一：两层套壳（有 tools / skills）

```
┌──────────────────────────────────────────────────────────────┐
│  1. 内层 ReAct 循环 (runReActLoop)                            │
│                                                              │
│  System: buildSystemPrompt(toolDefs)                          │
│        + WorkflowContext（工作流全貌，动态生成）               │
│        + resolvedRole（模板解析后的角色）                      │
│        + workspace info                                       │
│  User:   buildTaskPrompt(envelope)                            │
│        → 工作流总目标 / 上游交付内容 / 上游工作摘要 / 执行要求  │
│                                                              │
│  ┌──────────────────────────────────────┐                    │
│  │ for loop < maxLoops (默认[1](#footnote-1)轮):             │                │
│  │   POST /chat/completions             │                    │
│  │   → parseStructuredOutput(content)   │                    │
│  │   → get <answer>? → finalAnswer, break│                    │
│  │   → get <action>? → executeTool()    │                    │
│  │     → <result> 成功/失败注入会话     │                    │
│  │   → 无 action 无 answer? → hint 注入 │                    │
│  │   → continue                         │                    │
│  └──────────────────────────────────────┘                    │
│  finalAnswer = <answer> 内容 或 信封内 <input>               │
│  → set envelope.input = finalAnswer                          │
│                                                              │
│  → 进入外层                                                   │
│                                                              │
│  2. 外层信封封装 (wrapInEnvelope)                              │
│                                                              │
│  System: buildWrapperSystemPrompt(data) 格式化助手             │
│  User:   finalAnswer (内层的回答)                              │
│                                                              │
│  POST /chat/completions                                       │
│  → parseEnvelope(content) → get <input>                      │
│  → 有 outputSchema? → safeJsonParse() 校验                    │
│  → set envelope.input = 封装后内容                             │
│                                                              │
│  3. 返回 envelope → 传给下游                                   │
└──────────────────────────────────────────────────────────────┘
```

内层 ReAct System Prompt 最终结构（`runReActLoop` 组装）：

```
## 输出模板                                          ← buildSystemPrompt(toolDefs)
<think>...</think>
<plan>[ ] 步骤</plan>
<action tool="工具名">{"参数":"值"}</action>
<answer>最终答案</answer>
（含工具列表 [必填]/[可选] 标注、规则、能力扩展段落）

## 工作流全貌                                        ← WorkflowContext（动态生成）
你处于多 Agent 协作工作流中。上游已完成其环节并将产出交付给你，你的输出将成为下游环节的输入。

工作流链路:
  1. 计划制定 ✓
  2. 代码执行 ← 你
  3. 代码审查

已完成环节:
  计划制定: 已产出内容（约 200 字符）

你是第 2 个环节。请输出完整、可独立交付的内容。

## 角色与任务指令                                     ← resolvedRole（模板解析后的最终角色）
{你配置的角色描述}

## 环境信息                                          ← 自动组装
- 工作区路径: data/agents/{id}/.workspace/
- 所有文件读写操作默认基于工作区路径
```

内层 ReAct User Prompt 结构（`buildTaskPrompt()` 组装）：

```
## 工作流总目标
{envelope.goal}

## 上游交付内容
{envelope.input}

## 上游工作摘要
{envelope.context}

## 执行要求
{envelope.requirement}
```

外层封装 System Prompt（`buildWrapperSystemPrompt()`）：

```
你是一个格式化助手。请将以下研究结果封装成标准信封格式。

## 输出格式
使用以下标签结构响应，不要输出任何标签外的内容：
<envelope>
  <input>完整的最终输出内容</input>
</envelope>

## 规则
- 将原始内容完整保留，放入 <input> 标签内
- 如果原始内容是 JSON，保持 JSON 格式
- 如果原始内容是 Markdown，保持 Markdown 格式
- 可以适当润色和整理，但不得丢失关键信息

{如有 outputSchema，追加 schema 约束}
```

#### 路径二：单次调用（无 tools / skills）

```
  envelope.role = resolvedRole
  System: buildAgentSystemPrompt(data, envelope, workflowContext)
          → role + workflowContext + outputSchema + requirement + reminder + 信封格式指令
  User:   serializeEnvelope(envelope)（完整信封 XML）

  POST /chat/completions
  → parseEnvelope(content)
  → 成功? → set envelope.input = <input> 内容
  → 失败? → set envelope.input = 原始 content
```

#### 多输入口 (Multi-Port Input)（框架就绪，UI 待开放）

Agent 节点当前仅开放单个输入口（`in-0`）。执行引擎已完整实现多端口合并逻辑（`mergeInputEnvelopes()`），未来 UI 开放后支持左侧多个输入口，按端口标签分段合并上游内容。

> `{{input.标签名}}` 模板变量同样框架就绪，待 UI 开放后可用。

#### 危险工具处理

沙盒自动化场景下，`write_file` / `edit_file` / `run_command` **全部自动允许执行**，不弹窗询问。

#### 工具执行失败反馈

当工具调用失败时，内层 ReAct 会注入详细错误信息，包括工具参数签名，帮助 LLM 修正参数：

```
<result>错误: {errMsg}
工具 {tool} 的参数定义: {properties}
请检查工具参数是否正确，特别是 [必填] 参数和路径格式。</result>
```

#### 配置面板字段

| 字段 | 键 | 类型 | 说明 |
|------|-----|------|------|
| 节点名称 | `label` | text | 显示在画布上（**优先显示**：若设置了 `label` 则覆盖 Agent 的 Dashboard 名称） |
| Agent ID | `agentId` | select（下拉） | 关联沙盒中已添加的 Agent。画布副标题显示 Agent 原始名称（`↳ Agent名`） |
| 工作区路径 | `workspacePath` | text | 默认自动填充为 Agent 配置的工作区，可手动覆盖 |
| 角色描述 | `agentRole` | textarea | 核心字段，支持模板变量 `{{goal}}` / `{{input}}` / `{{iteration}}` 等 |
| 输出结构 | `outputSchema` | json | 可选 JSON Schema，在外层信封封装时生效；配后温度降至 0.3 |

#### 模板变量

在 `agentRole` 中使用 `{{变量名}}`，由 `resolveTemplate()` 解析：

| 模板 | 解析为 | 说明 |
|------|--------|------|
| `{{goal}}` | envelope.goal | Entry 写入的原始任务目标 |
| `{{context}}` | envelope.context | 上游工作摘要（含上游角色 + 智能截断内容） |
| `{{input}}` | envelope.input | 上游交付内容（多输入口时为结构化拼接，待 UI 开放） |
| `{{input.标签名}}` | 按 `## label` 提取 | 多输入口时按 label 提取单端口内容（待 UI 开放） |
| `{{iteration}}` | meta.iteration | 循环当前轮次 (0-based) |
| `{{fork_index}}` | meta.forkIndex | 并行分支编号 |
| `{{variables.xxx}}` | variables.xxx | 全局变量值 |

> 模板变量区分大小写，`{{Goal}}` 不匹配。解析顺序：goal → context → input.label → input → iteration → fork_index → variables.*。

---

#### 工作流感知机制（WorkflowContext）

沙箱在执行时为每个 Agent 节点**动态生成**工作流上下文快照，注入到 System Prompt 中。Agent 能够感知：

- **自身位置** — 在整条工作流链中的第几个环节
- **上游状态** — 哪些环节已完成，各自产出了多少内容
- **下游方向** — 后续还有什么环节，输出将交接给谁

**生成逻辑**（`executeNode` 中）：
1. 工作流启动时，从 `workflow.nodes` 提取所有 Agent 节点，生成静态 `nodeManifest`（节点名称列表）
2. 每个 Agent 执行前，检查 `ctx.envelopes` 中已完成的节点，生成动态上下游视图
3. 该视图同时注入 ReAct 路径（`runReActLoop`）和无工具路径（`buildAgentSystemPrompt`）

**示例** — 三 Agent 链中第二个 Agent 收到的内容：

```
## 工作流全貌
你处于多 Agent 协作工作流中。上游已完成其环节并将产出交付给你，你的输出将成为下游环节的输入。

工作流链路:
  1. 计划制定 ✓
  2. 代码执行 ← 你
  3. 代码审查

已完成环节:
  计划制定: 已产出内容（约 200 字符）

你是第 2 个环节。请输出完整、可独立交付的内容。
```

**设计考量**：不占用 Envelope 结构字段，而是通过 `ExecContext` 传递。每个 Agent 看到的 WorkflowContext 基于**执行到当下那一刻的真实状态**，不是静态模板。数据来源 `ctx.envelopes` 本身已在运行时动态维护，无额外 I/O 开销。

---

### 3.3 Condition — 条件分支

根据信封中某字段的值决定走哪个下游分支。**按顺序匹配规则，首个匹配即停止。**

**代码位置:** `executor.ts` → `register('condition', ...)`

**条件规则（ConditionRule）：**
```typescript
{ field: string; operator: string; value: string }
```

**字段名支持**（`extractFromEnvelope()`）：`input` / `context` / `role` / `variables.xxx` / `meta.xxx`

**支持的运算符（`evaluateCondition()`）:**

| 运算符 | 含义 | 比较方式 |
|--------|------|---------|
| `eq` | 等于 | `fieldValue === value` |
| `neq` | 不等于 | `fieldValue !== value` |
| `gt` | 大于 | `Number(fieldValue) > Number(value)` |
| `gte` | 大于等于 | `Number(fieldValue) >= Number(value)` |
| `lt` | 小于 | `Number(fieldValue) < Number(value)` |
| `lte` | 小于等于 | `Number(fieldValue) <= Number(value)` |
| `regex` | 正则匹配 | `new RegExp(value).test(fieldValue)` |
| `expr` | JS 表达式 | `new Function('value', 'return ' + value)(fieldValue)` |

**数据流向：**
```
READ:  rule.field → extractFromEnvelope(envelope, field) → fieldValue
       evaluateCondition(fieldValue, rule.operator, rule.value)

匹配:  envelope.input = "条件匹配: {field} {op} {value}"
       ctx.conditionRoutes[node.id] = matchIndex  → 主循环据此激活对应 output-N handle

默认:  envelope.input = "无匹配条件，走默认路由"
       ctx.conditionRoutes[node.id] = -1  → 主循环激活 output-default handle
```

**Handle:** 条件节点有动态 handle: `output-0`, `output-1`, ... `output-default`。handle 数量 = rules.length + 1。

**未配规则时**（`rules` 为空数组）：直接走默认路由 `output-default`。

---

### 3.4 Merge — 合并

汇合多条并发分支的结果。接收所有上游信封，合并为一个统一信封传出。

**代码位置:** `executor.ts` → `register('merge', ...)` + `mergeEnvelopesForNode()`

#### 前置合并（`mergeEnvelopesForNode`）

在 `executeNode()` 中，Merge 节点和有 2+ 上游的非 Merge 节点都经过此函数：

```
env.role       = "汇总上游结果"
env.requirement = "汇总分析上游输出，给出整体结论。"
env.context    = "[分支 0]\n{env1.context}\n\n[分支 1]\n{env2.context}..."
env.input      = "[分支 0] {env1.input}\n\n---\n\n[分支 1] {env2.input}..."
env.goal       = upstreamEnvs[0]?.goal || ''
env.variables  = Object.assign 合并所有上游 variables（后到覆盖）
```

#### 三种合并策略

| 策略 | 执行逻辑 |
|------|---------|
| `concat` | 前置合并完成 → input 中去掉 `---` 分隔符 (`envelope.input.replace(/\n\n---\n\n/g, '\n')`) |
| `structured` | 与 concat 实现一致（当前无区分） |
| `agent-summary` | 前置合并完成 → 调用 `summaryAgentId` 对应的 LLM 对 input 进行摘要合并。失败时回退到原始 input |

> **Merge vs 自然多输入：** Merge 的 role 固定为 "汇总上游结果"。其他节点类型（Agent / Condition 等）在 2+ 上游时自动使用相同合并逻辑。

---

### 3.5 Fork — 分叉

创建多条并发分支，各分支**完全并行执行**，无需等待彼此。

**代码位置:** `executor.ts` → `register('fork', ...)`

**输出 Handle:** `fork-0` `fork-1` `fork-2` ...，数量随 `branchCount` 动态增减。

**执行逻辑：**
1. 为每条分支 `deepCopy(envelope)`
2. 注入 `branchEnv.meta.forkIndex = i`
3. 存入 `ctx.envelopes['{node.id}:fork-{i}']`
4. 返回原始 envelope（不变）
5. 主循环中，下游节点通过 `ctx.envelopes[branchKey]` 获取对应分支的信封

**配置:**
| 字段 | 键 | 类型 | 说明 |
|------|-----|------|------|
| 节点名称 | `label` | text | |
| 分叉数量 | `branchCount` | number (2-10) | 下游并行分支数 |

---

### 3.6 Variable — 变量读写

跨节点存储和读取全局变量。通过 `envelope.variables` 字段传递（深拷贝保证隔离）。

**代码位置:** `executor.ts` → `register('variable', ...)`

**配置:**
| 字段 | 键 | 类型 | 说明 |
|------|-----|------|------|
| 节点名称 | `label` | text | |
| 模式 | `mode` | select | `read` 或 `write` |
| 变量键名 | `variableName` | text | 变量名 |
| 来源字段 | `sourceField` | text | write 模式时从何处取值（input/context/role/meta/variables.xxx） |

**Write 模式：**
```
value = extractFromEnvelope(envelope, sourceField)
envelope.variables[variableName] = value   // 直接修改当前 envelope 的 variables
```

**Read 模式：**
```
value = envelope.variables[variableName]
if (value) envelope.input = String(value)   // 有值才写入，否则保持原 input
```

---

### 3.7 Human-Gate — 人工确认

**暂停**整个工作流，从右侧面板滑入人工审阅界面，等待人工输入后继续。

**代码位置:** `executor.ts` → `register('human-gate', ...)`

**执行逻辑：**
```
ctx.onPause({ nodeId, nodeName, envelope, prompt })
→ SandboxPage.tsx 中右侧面板滑入（不遮画布）
→ 人工编辑完整信封（goal/context/input/variables 等）
→ resolve → 返回修改后的信封
```

**配置:**
| 字段 | 键 | 类型 | 说明 |
|------|-----|------|------|
| 节点名称 | `label` | text | |
| 提示文本 | `prompt` | textarea | 展示给人工的提示信息 |

---

### 3.8 Error-Handler — 错误处理

**仅在前面有节点报错时才触发。** 将错误消息透传给下游。该节点无需手动连线输入（执行引擎自动路由异常）。

**代码位置:** `executor.ts` → `register('error-handler', ...)` + `executeNode()` catch 块

**触发逻辑**（`executeNode()` catch 块）：
```typescript
const errorHandler = nodes.find(n => n.type === 'error-handler');
if (errorHandler && errorHandler.id !== nodeId) {
  // 累积错误消息：每个新错误追加到已有错误之后
  const prev = incomingEnvelope.input ? incomingEnvelope.input + '\n\n' : '';
  incomingEnvelope.input = prev + `[${nodeLabel}] ${msg}`;
  envelopes[nodeId] = incomingEnvelope;
  errored.add(nodeId);
  // errorHandler 在下一次拓扑扫描中执行
}
```

**关键特性：**
- 多个节点同时报错时，错误消息**累积**（不覆盖），格式为 `[节点名] 错误消息`
- error-handler 的 input 接收所有累积的错误文本
- error-handler 自身执行后 passthrough error info 给下游

**配置:**
| 字段 | 键 | 类型 | 说明 |
|------|-----|------|------|
| 节点名称 | `label` | text | |

> 建议在 Error-Handler 后接 Agent 让 LLM 尝试修复错误。

---

### 3.9 Output — 输出

将**完整执行报告**写入文件，并按拓扑顺序逐节点列出目标、角色与产出。支持在应用内直接查看。

**代码位置:** `executor.ts` → `register('output', ...)`

**报告结构（单层，无重复汇总区）：**
```
# 工作流执行报告
> 工作流 ID: `wf-xxx` | 节点数: 4

## 计划制定
*( Agent 节点 )*
**角色**: 你是任务规划专家...
**产出**:
1. 安装 requests...

## 代码执行
*( Agent 节点 )*
**角色**: 根据计划编写代码...
**产出**:
import requests...

## 代码审查
*( Agent 节点 )*
**产出**:
审查报告: Critical: 无...
```

每个节点标题含节点类型标注（`*( Agent 节点 )*`），产出直接展示（不使用 ` ``` ` 代码块），长内容在 3000 字符处截断并注明总长度。

**配置:**
| 字段 | 键 | 类型 | 说明 |
|------|-----|------|------|
| 节点名称 | `label` | text | |
| 模式 | `mode` | select | `snapshot` / `final`（当前实现无行为差异） |
| 输出路径 | `filePath` | text | 文件目录 |
| 文件名模板 | `fileNameTemplate` | text | 支持 `{timestamp}` `{flow}` |
| 格式 | `format` | select | `json` / `xml` / `txt` |

**三种格式：**
- `json`: 结构化 `{ flowId, timestamp, finalOutput, nodes: [...] }`
- `xml` / `txt`: 完整的 Markdown 执行报告

**应用内查看：** 工作流执行完毕后，日志面板标题右侧出现「📄 查看输出」按钮，点击在右侧面板中展示完整报告（若节点配置面板已打开则追加在其底部）。也可直接双击画布上的 Output 节点查看。报告内容来自 Output 节点执行后的 `envelope.input`。

**文件写入**：通过 `fetch('/api/storage/write?...', { method: 'PUT', body: content })` API。

---

## 四、内层 ReAct 循环详解

Agent 节点有 tools/skills 时走两层套壳。以下是内层 ReAct 的完整行为。

### 结构化输出解析（`parseStructuredOutput()` in `src/engine/parser.ts`）

从 LLM 回复中提取标签：

| 标签 | 字段 | 说明 |
|------|------|------|
| `<think>...</think>` | `parsed.think` | 思维链 |
| `<plan>[ ] ...</plan>` | `parsed.plan` + `parsed.planItems` | 分解标记 done/undone |
| `<action tool="xxx">...</action>` | `parsed.actions[]` | 多个 action 并行提取，内部 JSON 解析，仅匹配已注册的工具名（忽略不存在工具） |
| `<answer>...</answer>` | `parsed.answer` | 最终答案 |
| `<note>...</note>` | `parsed.note` | 补充说明 |

**工具 JSON 解析失败时**：`{ _raw: jsonStr }` — 原始字符串保留在 `_raw` 字段。

**备选提取**：如 LLM 输出 `<envelope><input>...</input></envelope>` 而非 `<answer>`，内层也识别为 finalAnswer。

### 内层 ReAct 提示注入

**系统提示组装**（`buildSystemPrompt()` in `src/engine/prompt.ts`）：
```
## 输出模板
<think>...</think>
<plan>[ ] ...</plan>
<action tool="工具名">{"参数":"值"}</action>
<answer>完整回答</answer>

## 规则
- 每次回复必须包含 <action> 或 <answer>，至少其一
- 可在一条消息中包含多个 <action>
- <result> 标签由系统注入，你不需要输出
- 读取文件用 read_file，查看目录内容用 list_directory，不要用 read_file 去读目录路径
- 调用工具前确认所有 [必填] 参数都已包含，否则会执行失败

## 可用工具
### read_file
   描述: xxx
   参数:
       filePath: string [必填] — ...

## 示例
用户: "读取 README.md"
<think>...</think>
<action tool="read_file">{"filePath": "README.md"}</action>

用户: "写一个 hello.txt 文件"
<think>...</think>
<action tool="write_file">{"filePath": "hello.txt", "content": "hello world"}</action>
```

**工具列表格式**（`buildSystemPrompt()`）：每个工具按以下格式输出，参数含 `[必填]` / `[可选]` 标注：
```
### {tool.name}
  描述: {tool.description}
  参数:
    {key}: {type} [必填]/[可选] — {description}
```

### 无答案无动作的处理

如果 LLM 回复既没有 `<answer>` 也没有 `<action>`（格式错误），注入提示：
```
你的回复缺少 <action> 或 <answer> 标签。请按照输出模板格式重新回复。
```

### 工具执行失败的处理

```
<result>错误: {errMsg}
工具 {tool} 的参数定义: {JSON.stringify(properties)}
请检查工具参数是否正确，特别是 [必填] 参数和路径格式。</result>
```

---

## 五、执行流程详解

**主循环**（`executeWorkflow()` → `executor.ts`）：

```
1. buildGraph(nodes, edges) → 构建 successors/predecessors/inDegree/nodeMap
2. 初始化 completed Set / errored Set
3. 状态恢复：envelopes = { ...state.envelopes }（保留暂停前历史）
           logs = [...state.logs]（保留暂停前日志）
   → 支持暂停工作流后继续执行，不丢历史数据

4. 拓扑主循环（外层 while progress && !aborted）：
   for nodeId in inDegree:
     a. 跳过 completed/errored 节点
     b. 检查 allUpstreamDone（所有上游 completed 或 errored）
        - condition 上游：匹配 edge.sourceHandle === `output-{matchIndex}`
        - 未匹配：edge.sourceHandle === 'output-default'
     c. 特殊节点分流：
        - merge: 等待所有上游 completed
        - error-handler: errored.size === 0? → 跳过（无错误）: → 执行
        - 其他: executeNode(nodeId)

5. executeNode(nodeId):
     a. 确定 incomingEnvelope（来源策略见下节）
     b. 应用 global variables
     c. agent 节点：设置 outputSchema + agentRole
     d. 应用 injectRole（在 agentRole 之后，可覆盖）
     e. 执行 register 的 executor
     f. 成功 → completed.add, 写 logs/files
     g. 失败 → 路由到 error-handler（累积错误消息）

6. 终结条件：所有节点 completed 或 errored → 更新状态 finished/error
```

### 信封来源策略（`executeNode()` incomingEnvelope 确定）

| 条件 | 策略 |
|------|------|
| 无上游 (inDegree = 0) | `envelopes[nodeId] || createEnvelope()` |
| Agent 多输入口 (inputPorts > 1) | 收集各端口上游 → `mergeInputEnvelopes(portEnvelopes, ports)`（框架就绪，待 UI 开放） |
| 单上游 | Fork 分支: `ctx.envelopes[branchKey]`；普通: `createEnvelopeFromUpstream(edge)` |
| 2+ 上游 (非 Agent 多端口) | `mergeEnvelopesForNode(upstreamEnvelopes)` 通用合并 |
| Node 类型 = merge | `mergeEnvelopesForNode(upstreamEnvelopes)` 合并所有上游 |

### 暂停与恢复

- 执行中任意时间点按停止按钮 → `ctx.signal.aborted` → 状态保存为 `paused`
- 下次执行时：`envelopes = { ...state.envelopes }` 保留历史节点输出
- `logs = [...state.logs]` 保留执行日志
- `variables` 保留全局变量状态
- `completed` Set 从 0 开始重建，但已有 envelopes 的节点可正确恢复

---

## 六、模板变量速查

在任意 Agent 节点的 `agentRole` 中可用（`resolveTemplate()`）：

| 模板 | 解析函数 | 使用场景 |
|------|---------|---------|
| `{{goal}}` | `envelope.goal` | 获取全局目标 |
| `{{context}}` | `envelope.context` | 了解上一步做了什么 |
| `{{input}}` | `envelope.input` | 上游交付内容（多输入口时为完整拼接，待 UI 开放） |
| `{{input.标签名}}` | 从 input 按 `## 标签名` 提取 section | 多输入口独立引用（待 UI 开放） |
| `{{iteration}}` | `meta.iteration` | 循环轮次 (0-based) |
| `{{fork_index}}` | `meta.forkIndex` | 并行分支编号 |
| `{{variables.xxx}}` | `envelope.variables.xxx` | 跨节点传递中间结果 |

> 解析顺序：goal → context → input.label → input → iteration → fork_index → variables.*。区分大小写。

---

## 七、工作流存储与导入导出

### 文件存储结构

```
data/workflows/
  _registry.json                    ← 名称→内部 ID 映射表
  {工作流名}/
    {工作流名}.json                 ← SandboxWorkflow 数据
    {工作流名}_exec.json            ← ExecutionState（运行后生成）
```

### 导入导出

支持拖入 `.json` 工作流文件到画布自动导入。校验：格式校验 → 重名检测 → 创建文件夹 + JSON + 注册。

---

## 八、完整示例

### 多 Agent 协作链

```
Entry → Agent(计划制定) → Agent(代码执行) → Agent(代码审查) → Output
```

### 并行审查（Fork → Merge）

```
Entry → Fork(3) → Agent(安全) → Merge → Agent(汇总) → Output
                  Agent(性能) → ──┘
                  Agent(风格) → ──┘
```

---

> 此文档基于 `@xyflow/react` v12 + React 19 + TypeScript 6 实现。
> 更新于 2026-05-03：WorkflowContext 工作流感知机制、injectRole 独立生效、context 智能摘要、User Prompt 措辞优化、Skills use_skill 按需加载、Agent 节点命名规则、删除 loop-count/subflow、冻结 loop-while、Output 报告重构与右侧面板查看、节点执行态脉冲/红框视觉反馈、人工确认右侧面板嵌入。

[1]: 默认值来自 `config?.maxToolCalls ?? 100` — 可在 Dashboard Agent 配置中修改
