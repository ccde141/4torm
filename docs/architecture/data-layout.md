# 数据目录

4torm 将 Agent 配置、会话、任务、工作流和运行记录保存在项目的 `data/` 目录中。部分正在运行的状态只存在于服务端进程内，不会写入文件

Agent 还可以使用项目外部的工作区。此类工作区不属于 `data/`，备份或迁移时需要单独处理

## 数据类型

| 类型 | 内容 | 主要写入入口 |
|------|------|--------------|
| 控制数据 | Agent 注册表、工具注册表、潮汐任务和工作流定义 | 控制台、专用页面或对应接口 |
| 会话数据 | 季风会话、会议记录、工位私聊和任务板 | 对应功能区 |
| 运行记录 | 信风执行、潮汐历史、气旋异步派发和任务板执行记录 | 服务端运行过程 |
| 工作区文件 | Agent 或任务创建的文档、代码和其他文件 | 人类或 Agent 文件工具 |
| 个人配置 | 模型提供商、MCP、标签和界面设置 | 对应管理页面 |

框架内置文件工具不能直接改写主要控制数据，工作区文件则根据 Agent 的执行权限进行读写

## 目录结构

部分目录只会在相关功能实际使用后出现

```text
data/
├── agents/
│   ├── registry.json
│   │       Agent 名称、默认模型、工具、技能、工作区和执行权限配置
│   │
│   └── {agentId}/
│       ├── .workspace/
│       │   ├── role-prompt.md
│       │   │       Agent 角色提示词
│       │   ├── config.json
│       │   │       创建或编辑 Agent 时写入的配置副本
│       │   └── 其他文件
│       │           Agent 使用默认工作区时产生的文件
│       │
│       ├── memory/
│       │   ├── index.md
│       │   └── {memorySlug}.md
│       │           Agent 的长期记忆索引与条目
│       │
│       ├── profile/
│       │   └── avatar.webp
│       │           Agent 头像
│       │
│       ├── sessions/
│       │   ├── _index.json
│       │   ├── {sessionId}.json
│       │   ├── {sessionId}.taskboard.json
│       │   └── {sessionId}.attachments/
│       │           季风会话、索引和任务板；附件目录保存季风会话中发送的图片附件
│       │
│       └── sessions-tide/
│           └── {taskName}_{taskId}/
│               ├── _index.json
│               ├── {sessionId}.json
│               └── bak/
│                       独立潮汐会话与滚动归档
│
├── convection/
│   └── sessions/
│       ├── _index.json
│       ├── {sessionId}.json
│       └── {sessionId}/
│           └── workspace/
│               └── bak/
│                       会议配置、公共记录、会议助理私聊、工作区和归档
│
├── cyclone/
│   ├── _index.json
│   └── {workshopId}/
│       ├── meta.json
│       ├── organization.json
│       │       协作组、工位布局、跨组联络线和组织版本
│       ├── workspace/
│       ├── bulletin.json
│       ├── bulletin-history.json
│       ├── seats/
│       │   ├── {seatId}.json
│       │   └── {seatId}.taskboard.json
│       ├── rooms/
│       │   └── {roomId}.json
│       ├── dispatches/
│       │   └── {dispatchId}.json
│       └── bak/
│               工作室、协作结构、工位、群聊、公告板、异步派发和归档
│
├── tradewind/
│   ├── workflows/
│   │   └── {workflowId}/
│   │       ├── graph.json
│   │       ├── meta.json
│   │       ├── profiles.json
│   │       └── workspace/
│   │               工作流画布、循环档案和共享文件
│   │
│   └── runs/
│       └── {workflowId}/
│           └── {executionId}/
│               ├── meta.json
│               ├── events.jsonl
│               ├── output.json
│               ├── nodes/
│               │   └── {nodeId}/messages.json
│               └── meetings/
│                       单次执行状态、事件、节点会话、会议和输出
│
├── tide/
│   ├── tasks.json
│   ├── tasks.template.json
│   └── runs/
│       └── {taskId}/
│           └── {timestamp}.json
│                   潮汐任务和每次运行记录
│
├── tools/
│   ├── registry.json
│   └── executors/
│           全局工具定义和 JavaScript 执行器
│
├── skills/
│   └── {skillId}/
│       ├── config.json
│       ├── SKILL.md
│       ├── tools.json
│       └── executors/
│               技能说明及可选的专用工具
│
├── mcp/
│   └── servers.json
│           MCP Server 配置、环境变量和请求头
│
├── runtime/
│   └── execution-observations.json
│           任务板中的后台命令和执行视窗记录
│
├── providers.json
│       模型提供商、地址和 API Key
├── providers.template.json
│       提供商配置模板
├── labels.json
│       用户自定义 Agent 标签
├── skin-config.json
│       当前界面外观配置
└── skin-textures/
        用户导入的自定义图片
```

## 备份与迁移

备份全部 4torm 运行数据时，需要保留：

1. 整个 `data/` 目录
2. Agent 配置中指向项目外部的工作区
3. 由 MCP Server 自己管理的数据目录

只迁移某个功能区时，可以复制对应目录；例如气旋工作室位于 `data/cyclone/`，信风工作流位于 `data/tradewind/`

复制前应先正常关闭 4torm，避免文件在复制期间继续变化。恢复时保持原有目录层级，再启动服务读取
