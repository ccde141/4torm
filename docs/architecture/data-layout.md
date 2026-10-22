# 数据目录

4torm 将 Agent 配置、会话、任务、工作流和运行记录保存在后端的数据目录中，默认是项目的 `data/`；独立部署时也可以另行指定。部分正在运行的状态只存在于服务端进程内，不会写入文件

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
│           └── task-{taskIdHash}/
│               ├── _index.json
│               ├── {sessionId}.json
│               └── bak/
│                       独立潮汐会话与滚动归档
│
├── monsoon/
│   └── runs/
│           季风执行状态与恢复记录
│
├── convection/
│   ├── runs/
│   │       会议执行状态与恢复记录
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
│   ├── runtime/
│   │       工位、群聊及主管的执行状态与履历
│   └── {workshopId}/
│       ├── meta.json
│       ├── organization.json
│       │       协作组、工位布局、跨组联络线和组织版本
│       ├── workspace/
│       ├── bulletin.json
│       ├── bulletin-history.json
│       ├── supervisor.json
│       ├── supervisor-inbox.json
│       ├── supervisor.taskboard.json
│       │       主管单一会话、项目记忆、信息收件箱与任务板
│       ├── seats/
│       │   ├── {seatId}.json
│       │   ├── {seatId}.memory.json
│       │   └── {seatId}.taskboard.json
│       ├── rooms/
│       │   └── {roomId}.json
│       ├── dispatches/
│       │   └── {dispatchId}.json
│       ├── contacts/
│       │   └── {contactId}.json
│       └── bak/
│               会话归档；retired-seats/ 保留退出工位的资料快照
│
├── tradewind/
│   ├── workflows/
│   │   └── {workflowId}/
│   │       ├── definition.json
│   │       ├── profiles.json
│   │       └── workspace/
│   │               原子工作流定义、循环档案和共享文件
│   │
│   └── runs/
│       └── {workflowId}/
│           └── {executionId}/
│               ├── meta.json
│               ├── graph-snapshot.json
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
│   ├── runtime/
│   │       按任务与执行编号保存运行状态、用量及压缩进度
│   └── runs/
│       └── {taskId}/
│           └── {timestamp}-{runId}.json
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
│   ├── servers.json
│   │       MCP Server 配置、环境变量和请求头
│   └── media/
│           MCP 工具返回的图片文件；会话中只保存引用
│
├── runtime/
│   └── execution-observations.json
│           任务板中的后台命令和执行视窗记录
│
├── providers.json
│       模型提供商、地址和 API Key
├── providers.template.json
│       提供商配置模板
├── transport/
│       后端本机 HTTPS 证书与私钥
├── labels.json
│       旧版 Agent 分类标签遗留文件；当前版本不读取、不写入
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

气旋的业务资料位于 `data/cyclone/`，信风工作流位于 `data/tradewind/`。单独复制这些目录只带走对应资料；要在新环境继续执行，还需保留其引用的池化 Agent、模型提供商、工具与技能配置，以及外部工作区文件。完整迁移应按上面的清单备份。

涉及 MCP 工具图片时，还需保留 `data/mcp/media/`，否则旧会话中的图片引用无法解析。工位配置与绑定履历保存在工位主文件，记忆变更履历保存在对应的 `.memory.json` 中。旧版潮汐目录与不带 `runId` 的运行记录仍可能存在，应连同当前目录一起保留。

复制前应先正常关闭 4torm，避免文件在复制期间继续变化。恢复时保持原有目录层级，再启动服务读取
