import { MAIN_TEAM, MAIN_CAPABILITY_GUIDANCE as guidance } from './main-guidance.js';

export type MainCapabilityDetail = 'workflow-contract' | 'taskboard-state';

export interface MainCapability {
  id: string;
  title: string;
  tools: string[];
  route: string;
  guidance: string;
  detail?: MainCapabilityDetail;
  nativeSchemaTools?: string[];
}

/** 能力选择、正文注入与工具可见性共用同一份登记。 */
export const MAIN_CAPABILITIES: MainCapability[] = [
  {
    id: 'ask',
    title: '向人类询问',
    tools: ['ask'],
    route: '需要暂停执行，等待人类作出关键选择或提供无法自行取得的信息。',
    guidance: guidance.ask,
  },
  {
    id: 'background',
    title: '后台执行',
    tools: ['inspect_execution', 'wait_execution', 'terminate_execution'],
    route: '耗时操作无需立即返回，且等待期间仍有其他工作可以推进。',
    guidance: guidance.background,
  },
  {
    id: 'workflow',
    title: '信风工作流',
    tools: ['list_agents', 'list_workflows', 'create_workflow', 'update_workflow', 'start_workflow'],
    route: '工作需要固定节点、上下游交接、人类关口或可重复执行的结构。',
    guidance: guidance.workflow,
    detail: 'workflow-contract',
  },
  {
    id: 'tide',
    title: '潮汐自动任务',
    tools: ['create_automation', 'update_automation', 'list_automations'],
    route: '工作需要按时间安排反复运行，而非只在当前执行一次。',
    guidance: guidance.tide,
  },
  {
    id: 'team',
    title: '工作队',
    tools: ['team_create', 'team_dispatch', 'team_read', 'team_wait', 'team_ack', 'team_review', 'team_dismiss'],
    route: '工作包含可分别验收的责任单元，或能通过上下文隔离、专业分工、独立复核降低风险。',
    guidance: MAIN_TEAM,
    nativeSchemaTools: ['team_create'],
  },
  {
    id: 'board',
    title: '任务板',
    tools: ['task_board'],
    route: '需要持续记录多个阶段与依赖，使后续接续能够看见真实进展。',
    guidance: guidance.board,
    detail: 'taskboard-state',
  },
  {
    id: 'memory',
    title: '长期记忆',
    tools: ['memory_write', 'memory_list', 'memory_read'],
    route: '已验证的信息跨会话仍有价值，例如稳定偏好、项目约定和失败原因。',
    guidance: guidance.memory,
  },
];

export function renderCapabilityRouter(capabilities: MainCapability[]): string {
  if (!capabilities.length) return '';
  const cards = capabilities.map(capability => `- **${capability.title}**：${capability.route}`).join('\n');
  return `## 选择可用能力

开始较复杂的工作，或执行中出现新的等待、依赖、不确定性和上下文压力时，检查当前提供的能力。收益明确时自主使用；收益不足以覆盖创建、传递和整合成本时，可以直接完成。

${cards}

这些能力可以组合使用，但应明确各自负责的状态与工作，避免重复执行或产生多个相互矛盾的事实来源。`;
}
