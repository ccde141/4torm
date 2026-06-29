# 潮汐 Tide · 自动化

潮汐是定时自动化引擎。按固定间隔自动向 Agent 发送消息,Agent 执行 ReAct 循环并持久化结果。无需 crontab。

![潮汐 自动化](/screenshots/潮汐自动化.png)

## 核心概念

| 概念 | 说明 |
|------|------|
| **任务 Task** | 一份配置:目标 Agent、消息内容、执行频率、重复次数 |
| **调度器 Scheduler** | 进程内 15 秒 tick,到期自动触发 |
| **推送模式** | `accumulate` = 潮汐自有会话(独立归档)/ `designated` = 追加到季风聊天会话 |
| **滚动窗口归档** | 避免会话无限膨胀,按窗口大小 N 自动切分归档 |
| **自循环 Self-Loop** | Agent 每轮结束后用 `[NEXT: ...]` 交出下一轮任务描述 |
| **容错暂停** | 连续 3 次失败自动停用任务 |
| **互斥锁** | Agent 被某任务驱动期间,同 Agent 的其他任务等待排队 |

## 创建任务

1. 侧栏切换到 **潮汐 · 自动化**
2. 点击「新建任务」
3. 配置项:

| 配置 | 说明 |
|------|------|
| **名称** | 任务显示名称 |
| **目标 Agent** | 下拉选择已注册的 Agent |
| **执行频率** | 时 / 分 / 秒(组合),如 `5m 30s` |
| **消息内容** | 每次推送给 Agent 的 prompt |
| **重复次数** | 数字 = 限次 / 勾选「永续」 |
| **推送模式** | `accumulate` 或 `designated` |
| **滚动窗口** | N=1 每轮独立 / N≥2 保留最新 N 轮上下文 |
| **自循环** | 勾选后自动锁定 accumulate + 窗口 2 + 永续 |

4. 保存后调度器自动接管,到期触发

### 自循环说明

- Agent 回答末尾需包含 `[NEXT: 下一轮任务描述]`
- 引擎提取该标记后剥离,将内容作为下一轮的任务提示输入。第一次由人类填写的内容为主要目标,不再修改;本轮指令由 Agent 自主根据实际执行情况迭代。
- 适合需要 Agent 自主推进的持续任务(如每日日报生成、代码巡检)

## 任务操作

- **启用 / 暂停** —— 卡片上切换开关
- **立即运行** —— 任务不活跃时,仅作手动触发(或测试);任务活跃时,作为一次"自动触发",刷新触发时间并计数 -1
- **删除** —— 删除任务及其所有运行记录和归档
- **查看会话** —— 点击卡片展开最近的潮汐对话内容
- **查看历史** —— 「运行历史」面板展示最近 20 条运行记录

## HTTP API

所有端点前缀 `/api/tide`。

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/tasks` | 列出所有任务 |
| `POST` | `/task` | 创建任务 |
| `GET` | `/task/:taskId` | 任务详情 + 近 5 条运行记录 |
| `PATCH` | `/task/:taskId` | 修改任务 |
| `DELETE` | `/task/:taskId` | 删除任务及归档 |
| `POST` | `/task/:taskId/toggle` | 启用 / 暂停切换 |
| `POST` | `/task/:taskId/run-now` | 立即执行一次 |
| `GET` | `/task/:taskId/runs?limit=20` | 运行历史 |
| `GET` | `/sessions/:agentId` | Agent 的潮汐会话摘要 |
| `GET` | `/session/:agentId/:sessionId` | 读取会话完整消息 |
| `DELETE` | `/session/:taskId` | 删除活跃会话(保留 bak 归档) |

## 会话归档

### Accumulate 模式(默认)

```
data/agents/{agentId}/sessions-tide/
└── {任务名}_{taskId短}/
    ├── _index.json                          ← 活跃会话 ID 列表
    ├── {agentId}-tide-{taskId8位}-acc.json  ← 活跃滚动会话
    └── bak/                                  ← 归档目录
        ├── {sessionId}_{日期}_{轮次}.json.bak.1
        └── ...
```

- **N=1** —— 每轮完整归档,活跃会话清空(各轮独立无上下文)
- **N≥2**(强制偶数)—— 满 N 轮后最老 N/2 轮到 bak,活跃会话保留最新 N/2 轮。例:N=10,会话达 10 条时自动归档最老 5 条,活跃剩 5 条,等再次达 10 触发下一次归档。

### Designated 模式

直接追加到季风普通会话 `data/agents/{agentId}/sessions/{sessionId}.json`。无归档操作、不存储中间工具调用。

## 容错与调度

- **15 秒 tick** —— 调度器每 15 秒检查到期任务
- **互斥锁排队** —— Agent 被占用时,新任务写入槽位,Agent 解锁后立即投递(覆盖式,只保留最新等待任务)
- **连续失败暂停** —— `consecutiveErrors ≥ 3` 自动将任务设为暂停
- **单次成功清零** —— 成功执行后 `consecutiveErrors` 归零
- **磁盘权威** —— 每次调度从磁盘重读 `tasks.json`,保证多实例场景数据一致

## 数据目录

```
data/tide/
├── tasks.json              ← 所有任务配置(TideTask[] 数组)
├── tasks.template.json     ← 空模板
└── runs/
    └── {taskId}/
        ├── 2026-06-04T03-09-27.573Z.json   ← 每次运行记录
        └── ...
```

### 任务配置类型

```typescript
interface TideTask {
  id: string                // 自动生成,格式 "tide-{时间戳36}-{随机6}"
  name: string
  schedule: string          // "every 5m" / "every 2h30m" / "every 30s"
  prompt: string
  agentId: string
  repeatCount: number       // -1=永续, N=剩余次数, 0=结束
  pushMode: 'accumulate' | 'designated'
  targetSessionId?: string
  windowN: number           // 1 或 ≥2 的偶数
  selfLoop: boolean
  consecutiveErrors: number
  enabled: boolean
  createdAt: string         // ISO 格式
  lastRun?: string
  nextRun?: string
}
```
