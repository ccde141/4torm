# 安全与隔离

4torm 本地运行,但仍有几道隔离与防护,防止 Agent 越权、并发污染、或密钥泄漏入库。

## 沙箱级别

Agent 文件操作受沙箱限制,按级别约束可访问路径:

| 级别 | 约束 |
|------|------|
| `strict` | 最严,仅限自身工作区 |
| `relaxed` | 默认,放宽到约定的可访问范围 |
| `unrestricted` | 不限制路径 |

在 Agent 配置中按需选择。执行器拿到的 `ctx`(`workspaceDir` / `projectDir` / `dataDir`)配合沙箱级别决定文件操作的合法范围。

## 工具权限

危险工具(写文件、改文件、执行命令)可逐 Agent 配置:

| 等级 | 行为 |
|------|------|
| `always` | 自动允许,不弹窗 |
| `ask` | 每次调用前弹出确认对话框 |
| `never` | 跳过不执行 |

- 危险工具列表:`DANGEROUS_TOOLS = ['write_file', 'edit_file', 'run_command']`
- 存储:`data/tools/permissions.json`
- 注意:自动化(潮汐 / 沙盒)执行时危险工具检查被**跳过**(全自动允许)——给无人值守任务配 Agent 时要留意这点

## 敏感数据隔离

以下文件含密钥或本地敏感配置,均在 `.gitignore` 中,不入仓库:

- `data/providers.json` —— LLM 提供商 API key
- `data/mcp/servers.json` —— MCP 服务器配置
- `data/cyclone/` —— 工作室会话与工作区

## Agent 互斥锁

`agent-lock` 防止同一 Agent 被多个任务 / 会话同时驱动导致状态污染:

- 内存级互斥,非阻塞,占不到立即拒绝
- 气旋的工位与会长各用独立锁(工位锁 vs `__chair__` 锁),互不冲突
- 潮汐任务遇到 Agent 被占用时排队等待,解锁后投递

## LLM 并发限制

全局最大 **3 路** 并发 LLM 调用(信号量队列),避免对提供商瞬时打满或被限流。超出的调用排队等待。

## MCP 工具名净化

注入 LLM 前,将 `mcp:服务:工具` 等含非法字符的函数名**可逆净化**(兼容 OpenAI 函数命名),LLM 返回工具调用时再还原为原名。既满足函数命名约束,又避免越权 / 串到别的服务器。详见 [MCP 接入](../extend/mcp)。
