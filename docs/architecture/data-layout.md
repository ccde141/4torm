# 数据目录

4torm 没有数据库,所有运行时状态都以 JSON 文件落在 `data/` 下。好处是可直接查看、易于备份,代价是删库就等于删目录。

```
data/
├── agents/
│   ├── registry.json              ← Agent 注册表(元数据 + 状态)
│   └── {agentId}/
│       ├── .workspace/
│       │   ├── config.json        ← 模型、温度、工具、技能、沙箱配置
│       │   ├── role-prompt.md     ← 角色提示词(运行时真理来源)
│       │   └── MEMORY.md          ← (可选)长期记忆,命中关键词时注入
│       ├── sessions/              ← 季风对话历史
│       └── sessions-tide/         ← 潮汐专用会话(按任务隔离 + 滚动归档)
│
├── convection/
│   └── sessions/                  ← 对流会议会话 + _index.json + 各会话工作区
│
├── cyclone/                       ← 气旋工作室(gitignore)
│   └── {workshopId}/
│       ├── workshop.json          ← 工作室元数据(含 chairAgentId)
│       ├── chair.json             ← 会长私聊会话
│       ├── seats/                 ← 各工位(私聊记忆 + 角色覆盖 + 职责)
│       └── rooms/                 ← 各群聊房间(公共消息流 + 参与工位 + 模式)
│
├── tradewind/
│   ├── workflows/                 ← 工作流定义({id}/graph.json + meta.json)
│   └── runs/                      ← 运行归档(events.jsonl + 节点 messages + output)
│
├── tide/
│   ├── tasks.json                 ← 潮汐任务配置(TideTask[])
│   ├── tasks.template.json        ← 空模板
│   └── runs/{taskId}/             ← 每次运行一个 JSON 记录
│
├── tools/
│   ├── registry.json              ← 工具定义注册表(ToolDef[])
│   ├── executors/                 ← 工具执行器(.js)
│   └── permissions.json           ← 工具权限({agentId}:{toolName}:级别)
│
├── skills/
│   └── {skillId}/
│       ├── config.json            ← 技能元数据 SkillMeta
│       ├── SKILL.md               ← 专业提示词
│       ├── tools.json             ← (可选)专属工具
│       └── executors/             ← (可选)专属执行器
│
├── mcp/
│   └── servers.json               ← MCP 服务器配置(gitignore)
│
└── providers.json                 ← LLM 提供商配置(含 API key,gitignore)
```

## 不入仓库的目录

以下涉及敏感信息或纯本地状态,均在 `.gitignore` 中:

| 路径 | 原因 |
|------|------|
| `data/providers.json` | 含 API key |
| `data/mcp/servers.json` | MCP 服务器配置 |
| `data/cyclone/` | 工作室 / 工位 / 群聊会话 + 共享工作区 |

> Agent 的角色提示词以 `role-prompt.md` 为运行时真理来源;`config.json` 存模型、工具、技能、沙箱级别等。改 Agent 行为就是改这两个文件——UI 配置面板本质上也是在写它们。
