import type { FrameworkCapabilityDescriptor } from '../../../shared/framework-capability.js';

export const TIDE_AGENT_CAPABILITY: FrameworkCapabilityDescriptor = {
  id: 'tide',
  title: '潮汐自动任务',
  route: '需要定时唤醒 Agent、反复工作或接续会话；启用计划不等于一次运行已经完成。',
  guidance: `### 潮汐自动任务
先查目标 Agent 的现有任务与运行记录，避免重复创建。可为自己或池内 Agent 设置任务；指定季风会话前，先查询该 Agent 的目标会话 ID。
schedule 支持两种格式：every 5m 是间隔触发，Agent 创建时最短60秒；daily 08:00 是每天固定时分，使用24小时制并跟随运行后端的电脑当前时区，不是浏览器时区。每日计划只在后端运行时触发；关闭期间错过的时点在启动后不补跑，重新启用或修改时从下一个未来时点开始。手动立即运行是独立操作。
默认使用独立潮汐会话。同一池化 Agent 在其他功能区忙不代表不能执行潮汐任务，不要据此拒绝交办。不同任务可并行，分别保存会话；同一任务不重入。只有指定追加到同一段季风会话时，才受那段会话的写入占用限制。
创建默认立即启用定时任务；只想保存草稿时传 enabled=false。修改已有任务的启停状态用 set_automation_enabled。需要立即执行时调用运行工具。运行后用任务 ID 与运行 ID 检查或等待，再读取记录核对结果。
更新 agentId 会更换后续执行的 Agent；任务执行或压缩期间不能换绑。旧会话与记录留在原 Agent，新独立会话不沿用原上下文；指定季风会话时必须同时提供属于新 Agent 的真实 targetSessionId。
暂停计划只阻止后续触发；中止当前轮次用 abort_automation，必须填写刚检查到的 taskId 和 runId，不猜标识。accepted=true 仅表示已接收请求，继续检查或等待该轮真正结束，不能立即宣称已中止。结果已经开始保存时会拒绝迟到中止。中止不回滚已完成的文件或工具副作用，也不会关闭后续计划；若人类要求全部停下，先暂停计划再中止当前轮次。`,
  examples: [{ scenario: '为已有 Agent 设置定时简报',
    actions: ['list_automations', 'create_automation', 'get_automation'],
    confirmation: '每天早晨8点使用 schedule="daily 08:00"；回读目标、计划、nextRun 和启用状态。创建成功不等于首次运行已完成，关闭后端期间不会补跑。' }],
};
