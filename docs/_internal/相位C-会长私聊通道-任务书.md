# 相位 C：会长私聊通道 —— 完整任务书

> 给接手 Agent 的自足任务说明。读完本文档即可开始编码，无需翻阅其他设计文档。

---

## 1. 项目背景

**项目**：4torm — 多 Agent 协作工作台。项目根目录 `I:\A_Test_zone\4torm\`。

**气旋引擎（Cyclone）**：工作室模式，工位（Seat）= agent + 私聊记忆，群聊（Room）= 多个工位串行讨论。

**会长（Chair）**：工作室创建时指定的一个 agent，**不占工位**，不进群聊。职责是作为人类的参谋——在独立私聊通道里俯瞰全工作室群聊记录，给人出主意。

**引擎隔离铁律**：气旋只 import `shared/` 地基，不 import 季风/信风的任何代码。后端在 `server/src/engine/cyclone/`，前端在 `src/cyclone/ui/pages/`。

**运行方式**：`npm run dev`（前端 Vite + 后端 Fastify 同起）。

---

## 2. 当前状态

**后端已完成**：workshop/seat/room 完整 CRUD、seat 私聊 SSE 流式、room 群聊串行发言、contact 工位间联络、seat prompt 构建（含 duty + overrideAgentRole）、react-loop 复用。

**前端已完成**：CyclonePage 三栏布局、SeatChat 私聊面板、RoomPanel 群聊面板、CreateWorkshopPanel、CreateRoomPanel、SeatPanel 工位配置、私聊+群聊流式注册表（切走不丢内容）、AskCard/DelegateCard/ContactCard 卡片。

**会长现有资产**：`WorkshopData.chairAgentId` 字段已存在，创建工作室时可以选会长 agent。但**没有实际可用的会长私聊 UI 或 API**。

**设计文档**：`I:\A_Test_zone\气旋工作室-群聊设计敲定稿.md` 第 11 节（会长私聊通道完整设计），第 8 节状态表。

---

## 3. 你要交付的东西

8 个步骤，按依赖顺序：

### C1：椅库（chair store）— 数据模型 + 读写

**新建文件**：`server/src/engine/cyclone/chair-store.ts`

**数据模型**：椅册只需要会话段，沿用 `SeatData` 的 messages 结构。**不要引入新类型**，直接在 store 函数里拼。

```ts
// chair.json 的内容结构（文件落地）：
{
  messages: ContextMessage[],   // 来自 shared/types.ts
  pending?: {                   // ask 挂起态，结构同 SeatData.pending
    question: string;
    options?: string[];
    pendingToolCallId?: string;
    native: boolean;
  },
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number; }
}
```

**store 函数**（参照 `seat-store.ts` 的三个函数）：

| 函数 | 行为 | 参照 |
|---|---|---|
| `loadChair(dataDir, workshopId)` | `readJsonSafe( chairFile(p) )`，不存在返回 `null` | `loadSeat` |
| `saveChair(dataDir, workshopId, chair)` | `atomicWrite( chairFile(p), JSON )` | `saveSeat` |
| `chairFile(dataDir, workshopId)` | `path => data/cyclone/{wid}/chair.json` | `seatFile` |

**paths.ts 改动**：在 `cyclone/paths.ts` 加 `chairFile(dataDir, workshopId)` 函数。

**types.ts 改动**：不加新类型。椅册数据结构由 store 函数内部 `readJsonSafe<{ messages: ContextMessage[]; pending?: ... }>` 即可。

**验证**：无独立测试。C2 的 chatChair 首次调用会自动创建 chair.json。

---

### C2：椅跑道（chair-runner）— 核心执行器

**新建文件**：`server/src/engine/cyclone/chair-runner.ts`

这是整个阶段 C 的核心。结构**照搬 `seat-runner.ts`**，差异点明列如下。

**需导出的两个公开入口**：

```ts
export async function chatChair(
  dataDir: string,
  workshopId: string,
  humanMessage: string,
  onEvent: (ev: SeatEvent) => void,
  signal?: AbortSignal,
): Promise<{ content: string; rawContent: string }>

export async function resumeChair(
  dataDir: string,
  workshopId: string,
  answer: string,
  onEvent: (ev: SeatEvent) => void,
  signal?: AbortSignal,
): Promise<{ content: string; rawContent: string }>
```

**与 seat-runner 的差异**（这是关键，逐项检查）：

1. **锁**：新锁函数 `tryAcquireChairLock(workshopId)`，存在 `locks.ts`（与 `tryAcquireSeatLock` 同一个 `Set`），键为 `"${workshopId}/__chair__"`。锁机制和 seat 一样——内存 Set、非阻塞、占不到抛 409。

2. **加载椅册**：`loadChair(dataDir, workshopId)`。若返回 `null`（旧工作室无 chair.json），**不报错**，初始化为 `{ messages: [] }`，在 `saveChair` 时自动落盘。agent 从 `workshopData.chairAgentId` 加载。

3. **加载工作室**：`loadWorkshop(dataDir, workshopId)` 取 `chairAgentId`。若 `chairAgentId` 为空，抛错 `"该工作室未指定会长"`。

4. **不需要的东西**（对比 seat-runner，这些步骤删掉）：
   - 不调 `loadSeat`、不读 `seat.title`/`seat.rolePrompt`/`seat.duty`
   - 不调 `resolveNativeMode`（椅册无 overrideAgentRole）
   - 不调 `listOtherSeats` / contact-registry（会长不被联络，不给它 contact 工具）

5. **System prompt**：调 `buildChairPrompt(dataDir, workshopId, workshopData, agent)`（C3 写），代替 `buildSeatSystemPrompt`。

6. **消息数组**：`messages = [system, ...chair.messages]`（无工位私聊记忆混合）。

7. **工具**：`loadAgentToolDefs(agentId)` 给全部工具，**不过滤**（会长信得过，不走 plan 限制）。虚拟工具**只加 ask + delegate**，不加 contact（会长不是工位，contact-registry 没它名单）。

8. **React-loop**：复用 `runReActLoopNative` / `runReActLoop`（import from `./react-loop`），参数与 seat-runner 一致。

9. **后处理**：同 seat-runner——去 system 写回 `chair.messages`、处理 pending 挂起/清空、`saveChair`、release 锁。

**注意**：`driveChair(context)` 内部函数结构与 `driveSeat` 完全一致（构建 llm + toolCaller → 调 react-loop → 后处理），只是 `DriveCtx` 里没有 `seat` 字段（换成 `chair: ChairData`），没有 `contactTargets` 字段。

---

### C3：椅提示（buildChairPrompt）— 系统提示词构造

**修改文件**：`server/src/engine/cyclone/seat-prompt.ts`

**新增函数**：

```ts
export function buildChairPrompt(
  dataDir: string,
  workshopId: string,
  workshop: WorkshopData,
  agent: LoadedAgent,
): { systemMessage: ContextMessage; native: boolean }
```

**提示词结构**（逐段拼接成 system 消息的 content）：

```
你是工作室「{workshop.title}」的会长。你的职责是和人类单独对话，
帮忙梳理思路、评估方案、协调资源。你不参与群聊讨论。

## 工作室群聊室一览
{对每个 roomId in workshop.roomIds，loadRoom(dataDir, workshopId, roomId) 后生成：
  - #{room.title}（{room.mode}模式）：{room.participantSeatIds.length}人在场
    最近发言：{取最近 3 条 publicMessages，每条截前 80 字，带发言人署名}
  若某 room 无 publicMessages，写"尚无发言"。
}

## 工作室工位
{遍历 workshop.seatIds，对每个 seat loadSeat 取 seat.title + seat.duty + seat.agentId，
 生成类似 " - 架构师（技术方案设计）[agentId]" 这样的清单。
 不做 contact 能力注入。}
```

**工具协议段**：跟 `buildSeatSystemPrompt` 一样做 native/文本二选一。返回的 `native: boolean` 给 runner 决定走哪条 react-loop 路径。

**性能注意**：`buildChairPrompt` 每个 turn 都调一次，要 load 所有 room + 所有 seat。当前工作室规模不大（room < 10，seat < 20），同步 fs 一次读完即可，不用缓存。若以后慢，再加缓存层。

---

### C4：路由 — HTTP 端点

**修改文件**：`server/src/routes/cyclone.ts`

在现有 seat/room 路由旁边，加四个端点。**完全照搬 seat 路由的模式**，换路径前缀和调用函数。

| 端点 | 方法 | 行为 | 参照 |
|---|---|---|---|
| `POST /api/cyclone/workshop/:wid/chair/chat` | POST `{ message }` | SSE 流式返回，调 `chatChair` | `seat/:id/chat` 的路由 |
| `POST /api/cyclone/workshop/:wid/chair/resume` | POST `{ answer }` | SSE 流式返回，调 `resumeChair` | `seat/:id/resume` 的路由 |
| `GET /api/cyclone/workshop/:wid/chair/status` | GET | 返回 `{ chairAgentId, messages, pending? }`，调 `loadChair` + `loadWorkshop` | `seat/:id/status` 的路由 |
| `POST /api/cyclone/workshop/:wid/chair/abort` | POST | `tryAcquireChairLock` + abort + 解锁 | `seat/:id/abort` 的路由 |

**SSE 事件类型**：与 seat 共用 `SeatEvent` 类型（token/tool-call/tool-result/delegate-start.../answer/ask/error），前端已认这些事件。**不改事件协议**。

---

### C5：流式注册表兼容 — pathOverride

**修改文件**：`src/cyclone/ui/pages/useSeatStreamRunners.ts`

`startStream` 函数里 `streamSSE` 的路径是硬编码的：
```
/api/cyclone/workshop/${workshopId}/seat/${seatId}/${action}
```
主席不走 `/seat/`，走 `/chair/`。

**改动**：`StartStreamOpts` 接口加一个可选字段 `pathOverride?: string`。

在 `startStream` 函数体内，`streamSSE` 的路径：
```ts
const path = opts.pathOverride
  ?? `/api/cyclone/workshop/${workshopId}/seat/${seatId}/${action}`;
```

默认行为不变（不传 `pathOverride` 的所有调用方零变化）。主席调用时传 `/api/cyclone/workshop/${workshopId}/chair/${action}`。

---

### C6：SeatChat 主席模式

**修改文件**：`src/cyclone/ui/pages/SeatChat.tsx`

**改造方式**：在现有 `SeatChat` 组件内加一个 `isChair` 布尔分支，**不拆新组件**。

判断依据：`const isChair = seatId === '__chair__';`

**isChair=true 时的差异**：

| 元素 | isChair=false（现有） | isChair=true（新建） |
|---|---|---|
| status 请求 | `/api/cyclone/workshop/${wid}/seat/${seatId}/status` | `/api/cyclone/workshop/${wid}/chair/status` |
| startStream | 不带 pathOverride | `pathOverride: /api/cyclone/workshop/${wid}/chair/${action}` |
| 标题显示 | 工位名（seat.title） | "会长 / {chairAgentId 或 agent 名}" |
| ⚙ 设置按钮 | 显示 | **隐藏**（会长不是工位，无设定） |
| delete 按钮 | 显示 | **隐藏** |

**status 接口差异**：seat status 返回 `{ id, title, messages, pending? }`，chair status 返回 `{ chairAgentId, messages, pending? }`——没有 `id` 和 `title`。SeatChat 在 isChair 模式下 status 取 `chairAgentId` 作为标题。

**其余渲染完全不变**：消息列表、tool/delegate/ask 卡片、输入区、ask 交互卡、粘性底部、停止按钮——全复用。

**注**：如果你评估下来觉得 isChair 分支污染了 SeatChat，可以拆一个 `ChairChat` 组件。但我判断后者 80% 代码重复，不如一个布尔开关干净。

---

### C7：CyclonePage 入口

**修改文件**：`src/cyclone/ui/pages/CyclonePage.tsx`

**左侧栏入口**：
- 在群聊列表（rooms）下方、工位列表（seats）上方，加一条**固定项**：
  - 标题："会长" + 若 `workshopData.chairAgentId` 存在则显示 agent 名
  - 条件渲染：**仅当工作室指定了会长时才显示**（检查 `activeWid` 对应的 workshop 数据）
  - 点击 → `setView({ kind: 'chair' })`

**view 状态扩展**：`ViewState` 类型加 `{ kind: 'chair' }` 分支。

**右侧面板渲染**：`view.kind === 'chair'` 时渲染 `<SeatChat seatId="__chair__" ... />`，通过 `seatRunners`（流式注册表）通信。

**切走主席时 background**（修复 bug #6）：
- 现有的 `useEffect` 里 `prevSeatRef` 只处理 `kind === 'seat'` 的切换。
- 需要扩展：当 `prevViewRef.kind === 'chair'` 且当前 view 不是 chair 时 → `seatRunners.background('__chair__')`。

**workshop 数据获取**：当前 `loadWorkshop` 只拿了 summary（`/workshop/:id/summary`）。主席入口需要 `chairAgentId`。需确保 summary 接口返回 chairAgentId 字段（检查 `workshop-store.ts` 的 `getWorkshopSummary`）。

---

### C8：回归 — 删工作室清理

**修改文件**：
- `server/src/engine/cyclone/workshop-store.ts` — `deleteWorkshop` 函数
- `src/cyclone/ui/pages/CyclonePage.tsx` — `deleteWorkshop` handler

**后端**：`deleteWorkshop` 里，在删 seats 目录和 rooms 目录之后，加一行：
```ts
const chairPath = chairFile(dataDir, workshopId);
try { fs.unlinkSync(chairPath); } catch {}
```

**前端**：`deleteWorkshop` handler 里，在 `setActiveWid(null)` 之前加：
```ts
seatRunners.kill(activeWid, '__chair__');
```

---

## 4. 隐性 bug 清单（完工前逐项打钩）

- [ ] **chairAgentId 空缺**：没会长的旧工作室，frontend 不显示会长入口，API 返回 400（"未指定会长"）
- [ ] **旧工作室无 chair.json**：首次 chatChair 时 loadChair 返回 null → 初始化为 `{ messages: [] }`，不报错
- [ ] **pathOverride 不影响已有调用**：SeatChat/RoomPanel 不传此参数，行为不变
- [ ] **删工作室清 chair.json**：deleteWorkshop 补删 chair.json + kill runner
- [ ] **主席切走不掐流**：CyclonePage view 切换逻辑补 `kind === 'chair'` 的 background 触发
- [ ] **isChair 不影响私聊**：isChair=false 时所有行为与改造前完全一致
- [ ] **主席 abort 不污染工位**：主席用独立锁 `tryAcquireChairLock`，与工位锁不冲突
- [ ] **buildChairPrompt room 为空**：工作室无群聊室时不生成"群聊室一览"段，不报错
- [ ] **tsserver 零错误**：每步 commit 前 `npx tsc --noEmit -p tsconfig.json` 通过
- [ ] **前端 tsc 零错误**：前端改动后 `npx tsc --noEmit -p tsconfig.json` 通过

---

## 5. 关键参考文件（需读才能动笔）

| 文件 | 读什么 |
|---|---|
| `server/src/engine/cyclone/seat-runner.ts` | chatSeat/resumeSeat 完整流程，C2 照搬 |
| `server/src/engine/cyclone/seat-store.ts` | loadSeat/saveSeat 模式，C1 照搬 |
| `server/src/engine/cyclone/seat-prompt.ts` | buildSeatSystemPrompt 结构，C3 的结构模板 |
| `server/src/engine/cyclone/paths.ts` | 路径函数模式，C1 加 chairFile |
| `server/src/engine/cyclone/types.ts` | SeatData/WorkshopData 类型 |
| `server/src/routes/cyclone.ts` | 路由注册模式，C4 加端点 |
| `src/cyclone/ui/pages/SeatChat.tsx` | 现成渲染逻辑，C6 改 |
| `src/cyclone/ui/pages/CyclonePage.tsx` | view 切换 + 流式注册表接线，C7 改 |
| `src/cyclone/ui/pages/useSeatStreamRunners.ts` | startStream 签名，C5 改 |
| `server/src/engine/cyclone/workshop-store.ts` | deleteWorkshop，C8 补删 |

---

## 6. 验收标准

1. 创建工作室时指定会长 agent → 侧栏出现"会长"入口 → 点击进入私聊 → 会长能回复
2. 会长能看到工作室群聊室的发言摘要（发一句问问会长"群里在聊什么"）
3. 会长对话中切到别的工位再切回 → 不丢内容（流式注册表已就位，理论上天然继承）
4. 没指定会长的工作室 → 侧栏不显示会长入口
5. speak / resume / ask / abort 四个端点均正常
6. `npm run dev` 零 tsc 错误，零运行时异常
