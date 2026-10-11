import type { FrameworkCapabilityDescriptor } from '../../../shared/framework-capability.js';

export const TIDE_AGENT_CAPABILITY: FrameworkCapabilityDescriptor = {
  id: 'tide',
  title: '潮汐自动任务',
  route: '需要定时唤醒 Agent、反复工作或接续会话；启用计划不等于一次运行已经完成。',
  guidance: `### 潮汐自动任务
先查目标 Agent 的现有任务与运行记录，避免重复创建。可为自己或池内 Agent 设置任务；指定季风会话前，先查询该 Agent 的目标会话 ID。
创建默认立即启用定时任务；只想保存草稿时传 enabled=false。修改已有任务的启停状态用 set_automation_enabled。需要立即执行时调用运行工具。运行后用任务 ID 与运行 ID 检查或等待，再读取记录核对结果。`,
  examples: [{ scenario: '为已有 Agent 设置定时简报',
    actions: ['list_automations', 'create_automation', 'get_automation'],
    confirmation: '回读目标、时间和启用状态；创建成功不等于首次运行已完成。' }],
};
