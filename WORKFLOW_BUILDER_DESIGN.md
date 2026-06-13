# 工作流搭建假工具 — 实现设计

## 概述

季风/对流中的 AI 通过假工具 `list_agents` + `create_workflow`，引导用户完成信风工作流搭建。AI 只负责拓扑设计和文本填写，不创建/修改 agent 实体。

---

## 流程

```
用户："帮我搭个工作流"
    ↓
AI 调 list_agents → 拿到可用 agent 列表
    ↓
AI 通过 ask 机制逐步澄清：
  1. 工作流目标
  2. 需要几个角色、各自职责
  3. 是否需要会议室节点
  4. 哪些环节需要 HumanGate
  5. 比对现有 agent → 告知缺什么 → 给出建议的 name + rolePrompt 示例
  6. 等用户建好后继续
    ↓
用户确认就绪
    ↓
AI 调 create_workflow 一次性生成
    ↓
AI 回复："工作流已创建，你可以在信风画布中看到"
```

---

## 工具定义

### list_agents（只读）

描述：列出框架内所有已注册的 agent 实体。

参数：无

返回示例：
```json
[
  { "agentId": "agent-mq6nm14gwbk8", "name": "牛顿", "role": "动力学方程推导与验证" },
  { "agentId": "agent-mq6nmi9ai5u7", "name": "费曼", "role": "物理现象可视化呈现" }
]
```

字段说明：
- agentId：实体唯一标识（节点配置引用用）
- name：agent 显示名
- role：rolePrompt 的第一句话摘要（帮 AI 判断能否复用）

---

### create_workflow（写入）

描述：创建一个完整的信风工作流（拓扑 + 配置），写入 workflows 目录。

参数：

```json
{
  "name": "工作流名称",
  "nodes": [
    {
      "id": "entry-1",
      "type": "entry",
      "label": "入口",
      "content": "初始信封内容（可选）"
    },
    {
      "id": "agent-1",
      "type": "agent",
      "label": "节点显示名",
      "agentId": "agent-xxx",
      "note": "节点级任务描述（告诉 agent 在此工作流中具体做什么）"
    },
    {
      "id": "meeting-1",
      "type": "meeting",
      "label": "会议名称",
      "topic": "讨论议题",
      "chairAgentId": "agent-xxx",
      "participants": ["agent-1", "agent-2"]
    },
    {
      "id": "note-1",
      "type": "note",
      "label": "备注名",
      "content": "注入到下游 agent 的静态提示",
      "targets": ["agent-1"]
    },
    {
      "id": "gate-1",
      "type": "humangate",
      "label": "审查点名称",
      "hint": "人类审查时的提示说明"
    },
    {
      "id": "output-1",
      "type": "output",
      "label": "输出"
    }
  ],
  "edges": [
    { "from": "entry-1", "to": "agent-1" },
    { "from": "agent-1", "to": "gate-1" },
    { "from": "gate-1", "to": "meeting-1" },
    { "from": "meeting-1", "to": "output-1" }
  ]
}
```

---

## 节点类型字段说明

| 类型 | 必填字段 | 可选字段 |
|------|----------|----------|
| entry | id, type, label | content |
| agent | id, type, label, agentId | note |
| meeting | id, type, label, topic, chairAgentId, participants | — |
| note | id, type, label, content | targets |
| humangate | id, type, label | hint |
| output | id, type, label | — |

---

## 约束（后端校验）

- 至少一个 entry 节点
- 恰好一个 output 节点
- 无环（DAG）
- 所有 agentId 必须引用已存在的 agent 实体
- meeting.participants 引用同工作流内的 agent 节点 id（不是 agentId）
- note.targets 引用同工作流内的 agent 节点 id
- meeting.chairAgentId 引用已存在的 agent 实体

---

## AI 权限边界

### 能做
- 选用已有 agent 实体
- 填写所有文本字段（label、note、content、topic、hint）
- 设计拓扑结构（节点 + 边）
- 通过 ask 建议用户创建缺失的 agent（给出 name + rolePrompt 示例）

### 不能做
- 新建 / 修改 / 删除 agent 实体
- 修改 agent 的模型、工具权限、sandboxLevel
- 删除已有工作流
- 运行工作流

---

## Prompt 注入位置

季风 `session-runner.ts` 和对流 `meeting-handlers.ts` 的 system prompt 中追加工具说明段：

```
### list_agents
  描述: 列出框架内所有可用的 Agent 实体。
  参数: 无

  调用示例:
  <action tool="list_agents">{}</action>

### create_workflow
  描述: 创建一个完整的信风工作流。
  参数: JSON 对象（包含 name、nodes、edges）

  调用示例:
  <action tool="create_workflow">{"name":"xxx","nodes":[...],"edges":[...]}</action>

  注意：
  - 调用前必须通过 list_agents 确认可用 agent
  - 如果缺少必要的 agent，先用 ask 告知用户去创建，给出建议的名称和 rolePrompt
  - 不要凭空编造 agentId，必须使用 list_agents 返回的真实 ID
  - meeting 的 participants 填的是同工作流内 agent 节点的 id，不是 agentId
```

---

## 后端实现清单

1. `list_agents` 执行器
   - 读 `data/agents/` 目录，解析每个 agent 的 config.json
   - 返回 agentId + name + role 摘要

2. `create_workflow` 执行器
   - 校验 DAG / 节点引用合法性
   - 生成 workflowId
   - 生成节点坐标（自动布局，简单纵向排列即可）
   - 写入 `data/tradewind/workflows/{id}/graph.json` + `meta.json`
   - 返回 workflowId + 成功提示

3. 路由层拦截
   - 季风 `conversation.ts` 的 toolCaller 拦截 `list_agents` / `create_workflow`
   - 对流 `meeting-handlers.ts` 的 toolCaller 同样拦截

---

## 自动布局算法（简易版）

根据 edges 做拓扑排序，逐层分配 y 坐标，同层节点水平分布：

```
entry 层:    y = 0
第一层 agent: y = 200
gate/note:   y = 400
meeting:     y = 600
output:      y = 800
```

同层多节点时 x 偏移 300px。足够用，用户可在画布上手动调整。

---

## 工具类型：假工具

`list_agents` 和 `create_workflow` 均为假工具（与 delegate、contact、ask 同级），不是真工具。

理由：
- 框架内建能力，不是用户自定义的外部操作
- 不走 HTTP tool bridge，在 toolCaller 里直接拦截处理
- 权限由引擎层控制，用户无法在 agent 配置面板误删或错配
- 与现有假工具体系一致（delegate / contact / ask / spawn_sub_agents）

---

## 容错机制

### 校验（后端执行器）

`create_workflow` 执行器在写盘前逐项校验，**收集所有错误一次性返回**（不是遇到第一个就停）：

| 校验项 | 错误信息示例 |
|--------|-------------|
| id 重复 | `节点 id 重复：agent-1` |
| agentId 不存在 | `agent 节点「agent-3」引用的 agentId「agent-fake」不存在` |
| 缺 output | `缺少 output 节点` |
| output 多于一个 | `output 节点只能有一个` |
| 缺 entry | `缺少 entry 节点` |
| 存在环路 | `存在环路（agent-1 → agent-2 → agent-1），工作流必须为 DAG` |
| participants 引用无效 | `会议「meeting-1」的参与者「agent-9」不在节点列表中` |
| chairAgentId 不存在 | `会议「meeting-1」的会长 agentId「agent-zzz」不存在` |
| note.targets 引用无效 | `备注「note-1」的 targets「agent-5」不在节点列表中` |
| edges 引用无效节点 | `边 from「agent-99」不在节点列表中` |

返回格式：
- 成功：`"工作流「牛顿力学研究」已创建，ID: wf-mq8abc123。可在信风画布中查看。"`
- 失败：`"创建失败，发现以下问题：\n1. agent 节点「agent-3」引用的 agentId「agent-fake」不存在\n2. 缺少 output 节点"`

### 重试（ReAct 循环自带）

AI 调 create_workflow → 收到错误 → 下一轮思考修正 → 重新调用。无需额外机制。

Prompt 中加一句引导：
```
如果 create_workflow 返回错误，根据错误信息修正参数后重新调用，不要放弃或向用户报错。
```

### 极端情况

如果 AI 连续 3 次调用都失败（理论上不应该），ReAct 循环的轮次上限会自然终止，AI 输出当前状态告知用户哪里有问题。
