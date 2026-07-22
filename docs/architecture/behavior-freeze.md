# 4torm 行为冻结（当前实现）

本文记录实验副本在 `9f82eaf` 之后的可观察行为，作为后续结构整理的回归基线。这里写的是“代码现在怎么做”，不是目标权限模型；若未来要改变行为，必须增加迁移或显式版本说明。

## HTTP 路由

所有 API 均挂在 `http://<host>:3001`，以下路径省略主机。

| 前缀 | 方法与路径 | 当前请求 | 成功响应/流 |
|---|---|---|---|
| `/api/health` | `GET /` | 无 | `{status,ts}` |
| `/api/storage` | `GET /read?path=`、`GET /file?path=` | 查询路径 | 文本/二进制；不存在 `404 {error}` |
|  | `PUT /write?path=` | 文本或 JSON body | `{ok:true}` |
|  | `PUT /upload?path=` | base64 文本 body | `{ok:true}` |
|  | `DELETE /delete?path=`、`POST /mkdir?path=` | 查询路径 | `{ok:true}` |
| `/api/tools` | `POST /exec` | `{tool,args?,agentId?,workspaceDirOverride?,sandboxLevelOverride?}` | `{result,meta?}`；executor 异常 `500` |
| `/api/skills` | `GET /list` | 无 | 技能定义数组 |
| `/api/llm` | 由 `llm-proxy.ts` 注册 | provider/model 请求 | LLM 代理响应；字段以 provider 兼容格式透传 |
| `/api/chat` | `POST /agent/:agentId/open-workspace` | 无 | `{ok,path}` |
|  | `POST /compact` | `{agentId,sessionId,model?}` | SSE：`start` → `token*` → `done`；失败 `error` |
| `/api/conversation` | `POST /chat` | `{sessionId,agentId,model?,messages[]}` | SSE `ConversationEvent` |
|  | `POST /abort`、`POST /reply` | `{sessionId,...}` | `{ok:true}` 或错误 |
| `/api/convection` | `POST /create` | `{chairAgentId,participantAgentIds,topic?,title?}` | 完整 `ConvectionSessionData` |
|  | `GET /list` | 无 | `ConvectionSessionSummary[]` |
|  | `ALL /session/:sessionId/:action` | action 见下表 | JSON 或 SSE |
| `/api/tide` | `POST /task` | `TideTask` 创建字段 | 完整任务 |
|  | `GET /tasks`、`GET /task/:taskId`、`GET /task/:taskId/runs` | 查询参数 `limit?` | 任务、详情或运行记录数组 |
|  | `PATCH /task/:taskId` | 任意可更新任务字段 | 更新后任务 |
|  | `DELETE /task/:taskId`、`POST /task/:taskId/toggle`、`POST /task/:taskId/run-now` | 无 | `{ok:true}` 或任务 |
|  | `GET /sessions/:agentId`、`GET /session/:agentId/:sessionId` | 路径参数 | 潮汐会话摘要/完整会话 |
|  | `DELETE /session/:taskId` | 任务必须停用且有绑定会话 | `{ok:true}` |
| `/api/tradewind` | `POST /run` | `{graph,workflowId,initialInput?,mode?,profileId?}` | `{executionId,runDir,loop?}` |
|  | `POST /stop`、`GET /status`、`GET /nodes/status`、`GET /health` | 无 | 状态 JSON |
|  | `GET /events`、`GET /stream` | 无 | SSE |
|  | `POST /human-gate/:nodeId/submit` | gate 内容 | `{ok:true}` |
|  | `POST /workflow/save`、`GET /workflow/load/:id`、`GET /workflow/list`、`DELETE /workflow/:id` | 工作流图/ID | 工作流或 `{ok:true}` |
|  | `GET/POST/DELETE /workflow/:id/profiles[/:profileId]` | profile 字段/ID | profile 数组或 `{ok:true}` |
|  | `POST /chat/:nodeId`、`GET /chat/:nodeId/events`、`GET /chat/:nodeId/messages`、`GET /chat/:nodeId/status`、`GET /chat/:nodeId/snapshot` | 消息或无 | SSE/消息/状态 |
|  | `POST /chat/:nodeId/{abort,pause,resume}` | 无 | `{ok:true}` |
|  | `GET /meeting/:nodeId/events`、`GET /meeting/:nodeId/status` | 无 | SSE/状态 |
|  | `POST /meeting/:nodeId/{speak,chair,abort-round,end,join,leave,reorder}` | action 对应消息、参与者或顺序 | SSE、状态或 `{ok:true}` |
| `/api/cyclone` | `POST /create`、`GET /list` | `{title?,chairAgentId?}`/无 | 工作室或摘要数组 |
|  | `ALL /workshop/:workshopId/:action` | 工作室 action | JSON 或 SSE |
|  | `POST /workshop/:workshopId/create-room` | 房间标题、主题、参与工位等 | 完整房间 |
|  | `ALL /workshop/:workshopId/seat/:seatId/:action` | 工位 action | JSON 或 SSE |
|  | `ALL /workshop/:workshopId/room/:roomId/:action` | 房间 action | JSON 或 SSE |
| `/api/mcp` | `GET /list`、`GET /tools` | 无 | MCP 状态/工具数组 |
|  | `POST /add`、`/update`、`/import`、`/remove`、`/toggle`、`/reconnect` | MCP 配置、配置列表或名称 | 配置/状态 |
| `/api/memory` | `GET /list`、`POST /create`、`POST /update`、`POST /delete` | agent/记忆字段 | 记忆数组或 `{ok:true}` |
| `/api/delegate` | `POST /` | delegate 任务字段 | delegate 结果 |

### 动态 action 约定

- Convection action：`status`、`speak`、`chair`、`abort`、`rename`、`join`、`leave`、`reorder`、`set-chair`、`delete`、`edit-message`、`delete-message`、`reset-context`、`open-workspace`。
- Cyclone 工作室 action：`status`、`summary`、`bulletin`、`bulletin-mutate`、`bulletin-history`、`bulletin-revert`、`rename`、`set-chair`、`add-seat`、`gen-duty`、`open-workspace`、`delete`；创建房间是独立的 `POST /workshop/:workshopId/create-room`。工位 action 包含 `status`、`update-role`、`gen-duty`、`chat`、`resume`、`abort`、`edit-message`、`delete-message`、`reset-context`、`delete`；房间 action 包含 `status`、`join`、`leave`、`reorder`、`rename`、`set-mode`、`intro`、`speak`、`abort`、`edit-message`、`delete-message`、`reset-context`、`delete`。
- 未知 action 当前返回 `400 {error}`；不存在实体通常返回 `404`；同一会话/工位正在运行时通常返回 `409`。

## 工具契约

`data/tools/registry.json` 当前登记 10 个 builtin 工具；参数均为 object schema。builtin executor 从 `data/tools/executors/{executorFile}.js` 加载，skill 工具从 `data/skills/{skillId}/tools.json` 加载。`mcp:` 前缀直接交给 MCP manager。

| 工具 | 参数 | 成功结果 | 失败行为 |
|---|---|---|---|
| `read_file` | `filePath`, `offset?`, `limit?` | 文本，默认最多 800 行 | 缺参/越界由 executor 抛错 |
| `write_file` | `filePath`, `content` | 写入确认及 diff；UI meta 可能含旧内容 | 路径守卫或 IO 抛错 |
| `edit_file` | `filePath`, `oldString`, `newString`, `replaceAll?` | 替换确认及 diff | 未唯一匹配时抛错 |
| `list_directory` | `dirPath?` | 目录条目 | 路径守卫/IO 抛错 |
| `run_command` | `command`, `timeout?` | stdout 或退出信息 | 黑名单/超时抛错；非零退出返回带退出码文本 |
| `webfetch` | `url` | HTTP 文本 | 网络异常抛错 |
| `webfetch_advanced` | `url`, `selector?`, `timeout?` | Playwright 提取文本 | 浏览器/网络异常抛错 |
| `use_skill` | `skill` | SKILL.md 内容 | 技能不存在返回错误文本 |
| `delete_file` | `filePath` 或 `dirPath` | 删除确认 | 路径守卫/IO 抛错 |
| `search_content` | `pattern`, `dirPath?`, `filePattern?` | 匹配行及文件行号 | 正则/路径错误抛错 |

未知本地工具返回“未知工具”文本，不抛 HTTP 500；executor 文件缺失或未知 executor 类型抛异常。工具结果通过 `{result,meta?}` 返回，`meta` 不进入 LLM 结果正文。

## 当前两级文件权限语义

代码中的正式名称是 `project` 和 `unrestricted`，前端显示为「项目级」和「无限制」。旧值在读取时会映射为项目级，不需要迁移已有 Agent 数据。

| 级别 | 内置文件工具读取 | 内置文件工具写入/删除 | 命令 cwd | 当前已知限制 |
|---|---|---|---|---|
| `project`（默认） | 4torm 项目与当前 `workspaceDir` | 同读取范围，并禁止控制面文件 | `workspaceDir` | Shell、MCP 与自定义执行器不受此路径守卫自动限制 |
| `unrestricted` | 相对路径基于 `workspaceDir`，同时允许其他外部路径 | 任意路径仍禁止控制面文件 | `workspaceDir` | Shell、MCP 与自定义执行器按各自能力运行 |

所有内置文件工具复用 `_resolve.js`，路径判断会归一化相对路径、绝对路径以及符号链接或 junction 的真实目标。HTTP storage API 使用自己的路径解析，两者边界不同。`run_command` 只从工作区启动，并另有危险命令黑名单和超时限制；Shell 可以自行 `cd`，MCP 与自定义执行器也不会自动经过本地文件守卫。`/api/tools/exec` 请求体仍可传 `sandboxLevelOverride` 供内部执行链使用，当前没有独立的鉴权或人工确认层。

## 状态转换

- Agent：注册表中不存在 → 创建 → 空闲；模型不可用时显示离线。运行期间由进程内活动状态显示工作中及所在功能区，所有活动结束后恢复空闲；应用重启后活动状态自然清空。
- 普通会话：不存在 → 创建 → 空闲；`chat` 进入运行，可能 `suspended`（`ask`），`reply` 恢复；完成/错误/abort 回到空闲；删除后不可轮询。
- Convection：创建会话 → 空闲；`speak`/`chair` 逐轮运行并写回 public/chair messages；可压缩归档；删除移除 JSON、workspace 和 index 项。
- Cyclone：创建 workshop → 添加 seat/room；seat/room 的 chat/speak 运行、可挂起等待回答；消息编辑/删除只改目标持久化数组；workshop 删除不主动清理历史备份之外的数据。
- Tradewind：`idle` → `running`（单次或 loop）；节点状态 `idle → active → idle`，human-gate 可进入 waiting；`stop`/错误/完成进入停止态，运行目录保留归档。
- Tide：任务 `enabled/disabled`；调度触发一次 run，成功将 `consecutiveErrors` 清零，失败递增；`repeatCount=0` 表示结束，`-1` 表示持续；每次运行写 `success/error` 记录和独立会话。

## SSE 契约

所有 SSE 帧格式为 `data: JSON\n\n`；heartbeat 是注释帧 `: heartbeat\n\n`。事件顺序由引擎回调顺序决定，路由只透传，不重排、不改名。

- Conversation：`notice?` → `reasoning*`/`token*` → `tool-call` → `tool-result`（可重复）→ `delegate-*`（可嵌套）→ `answer`/`ask` → `usage?` → `done`；异常为 `error`。
- Convection：`agent-start` → `token/reasoning/tool-call/tool-result/heartbeat*` → `agent-done`；会长有 `chair-token/chair-reasoning/chair-done`；压缩有 `compact-start/compact-done`；最后由路由补 `done`，异常为 `error`。
- Cyclone meeting broadcast：连接先发 `connected`，之后是 agent/tool/contact/round/phase/summary/compact 事件，正常结束为 `done`，异常为 `error`。
- Tradewind：事件总线先写 `events.jsonl` 再向 `/events`、`/stream` 推送；内置事件 ID 包括 `node-activate`、`work-done`、`handoff`、`meeting-start/speak/end`、`human-gate-arrive`、`workflow-end`、`auto-anomaly`、`delivery-delay`、`lap-done`、`loop-end`。

## 数据目录与写入口

`data/` 是运行时事实来源；控制面定义、运行时状态、Agent workspace 当前混合在同一根目录，但所有者如下：

| 路径 | 所有者/主要写入口 | 备注 |
|---|---|---|
| `agents/registry.json` | Agent 管理 UI/API、专用 workflow/automation 工具 | 控制面；普通文件工具禁止写 |
| `agents/{id}/.workspace/` | Agent 文件工具、会话/工位引擎 | role-prompt.md 是角色真源 |
| `agents/{id}/sessions/` | Conversation/chat 路由与 runner | 普通季风会话 |
| `agents/{id}/sessions-tide/` | Tide runner | 潮汐会话，按任务隔离 |
| `convection/sessions/` | Convection session store | `_index.json` + 会话 JSON + workspace |
| `cyclone/{workshopId}/` | Cyclone workshop/seat/room stores | 共享 workspace、私聊、公告、备份 |
| `tradewind/workflows/` | workflow API/editor | graph/meta 为控制面，`{id}/workspace` 放行给 Agent |
| `tradewind/runs/` | Orchestrator、EventBus、Output | 运行归档，events.jsonl 是事件事实 |
| `tide/tasks.json`、`tide/runs/` | Tide store/scheduler | 任务控制面与运行记录 |
| `tools/registry.json`、`tools/executors/` | 工具管理与加载器 | 工具定义/执行器 |
| `skills/{skillId}/` | Skill 管理与加载器 | `config.json`、`SKILL.md`、tools/executors |
| `mcp/servers.json`、`providers.json` | MCP/LLM 设置 | 可能含密钥，已 gitignore |

当前已知的多写风险：各 session/index store 通过原子写保护单文件完整性，但跨进程并发合并仍未统一；内置文件工具已处理 symlink/junction，Shell 子进程、MCP 和自定义执行器仍属于各自独立的权限边界。

## 最小特征测试

- `server/src/services/execution-context.test.ts` 与 `execution-context.freeze.test.ts`：默认值、Agent workspace、override 和级别回退。
- `server/src/services/tool-registry.test.ts`：registry 名称唯一、参数 schema 存在、builtin executor 文件存在。
- `server/src/utils/sse.test.ts`：SSE JSON 帧格式及调用顺序。

这些测试只锁定现状，不证明权限模型已经安全，也不替代 API 集成、并发、断线重连和迁移测试。
