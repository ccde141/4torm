import { MAIN_TEAM, MAIN_CAPABILITY_GUIDANCE as guidance } from './main-guidance.js';
import { renderMainToolDefinitions } from './main-tool-defs.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import type { FrameworkCapabilityDescriptor } from '../../shared/framework-capability.js';
import { frameworkCapabilityToolName } from '../../shared/framework-capability.js';

export interface MainCapability extends FrameworkCapabilityDescriptor {
  tools: string[];
}

/** 能力选择、正文注入与工具可见性共用同一份登记。 */
export const MAIN_CAPABILITIES: MainCapability[] = [
  {
    id: 'coordination',
    title: '协作总览',
    tools: ['framework_status', 'framework_guide', 'inspect_operation', 'wait_operation',
      'find_operation_records', 'read_operation_record'],
    route: '需要判断已有工作、等待执行变化，或按时间与 ID 找回历史运行记录。',
    guidance: guidance.coordination,
    examples: [{ scenario: '接续上一轮仍在运行的委托',
      actions: ['framework_status', 'inspect_operation', 'wait_operation'],
      confirmation: '按返回的运行 ID 确认状态；等待超时不等于任务失败。' }],
  },
  {
    id: 'ask',
    title: '向人类询问',
    tools: ['ask'],
    route: '需要暂停执行，等待人类作出关键选择或提供无法自行取得的信息。',
    guidance: guidance.ask,
    examples: [{ scenario: '两种方案影响目标且人类尚未取舍', actions: ['ask'],
      confirmation: '给出必要背景与选择，收到答复后再做依赖该选择的操作。' }],
  },
  {
    id: 'background',
    title: '后台执行',
    tools: ['inspect_execution', 'wait_execution', 'terminate_execution'],
    route: '耗时操作无需立即返回，且等待期间仍有其他工作可以推进。',
    guidance: guidance.background,
    examples: [{ scenario: '已有后台执行 ID，而后续步骤依赖其结果',
      actions: ['inspect_execution', 'wait_execution'],
      confirmation: '以真实终态和输出决定下一步，不把启动回执当作完成。' }],
  },
  {
    id: 'team',
    title: '工作队',
    tools: ['team_start', 'team_create', 'team_dispatch', 'team_read', 'team_wait', 'team_ack', 'team_review', 'team_dismiss'],
    route: '有一个可独立交付或复核的责任单元，就可启动成员；上下文隔离与专业分工也能降低风险。',
    guidance: MAIN_TEAM,
    examples: [{ scenario: '成员已完成调查，主线需要核验并继续派工',
      actions: ['team_read', 'team_review', 'team_ack', 'team_dispatch'],
      confirmation: '先核对证据、记录判断并确认已处理；仍需工作时向原成员补充具体任务。' }],
  },
  {
    id: 'board',
    title: '任务板',
    tools: ['task_board'],
    route: '需要持续记录多个阶段与依赖，使后续接续能够看见真实进展。',
    guidance: guidance.board,
    detail: 'taskboard-state',
    examples: [{ scenario: '任务分成调查、实现、验证三步，需要跨轮接续', actions: ['task_board'],
      confirmation: '先读取当前 revision，再写入实际进度；更新任务板不会启动执行。' }],
  },
  {
    id: 'memory',
    title: '长期记忆',
    tools: ['memory_write', 'memory_list', 'memory_read'],
    route: '已验证的信息跨会话仍有价值，例如稳定偏好、项目约定和失败原因。',
    guidance: guidance.memory,
    examples: [{ scenario: '确认了一条跨会话仍适用的项目约定',
      actions: ['memory_list', 'memory_write'],
      confirmation: '先查重再写入明确事实，不把临时进度当长期记忆。' }],
  },
  {
    id: 'skill',
    title: '技能',
    tools: ['use_skill'],
    route: '任务匹配时先用 use_skill 加载已启用技能的具体方法；技能可与协作形态组合。',
    guidance: '',
    examples: [{ scenario: '已启用技能与当前任务匹配', actions: ['use_skill'],
      confirmation: '先读取技能具体方法，再按其适用范围开展工作。' }],
  },
];

function capabilityEntry(capability: MainCapability, hasGuide: boolean): string {
  if (capability.id === 'team') {
    if (capability.tools.includes('team_start')) {
      return '边界清楚且可独立验收时，用 `team_start` 派出一名成员，自己继续主线；取得回报后核验并合成。';
    }
    if (capability.tools.includes('team_dispatch')) return '已有成员 ID 时，用 `team_dispatch` 继续派工。';
    if (capability.tools.includes('team_create')) return '可用 `team_create` 建立成员；当前没有派工入口。';
    if (capability.tools.includes('team_read')) return '起手：`team_read` 查看已有成员及回报。';
    return '';
  }
  if (MAIN_CAPABILITIES.some(entry => entry.id === capability.id) || !hasGuide) return '';
  return `起手：用 \`framework_guide\` 读取 \`${capability.id}\` 当前 action，再按任务意图调用对应超级工具。`;
}

export function renderCapabilityRouter(capabilities: MainCapability[]): string {
  if (!capabilities.length) return '';
  const collaboration = capabilities.some(capability =>
    ['cyclone', 'convection', 'tradewind', 'tide'].includes(capability.id)
    || (capability.id === 'team' && capability.tools.some(tool =>
      ['team_start', 'team_dispatch'].includes(tool))));
  const canStartTeam = capabilities.some(capability =>
    capability.id === 'team' && capability.tools.includes('team_start'));
  const hasGuide = capabilities.some(capability => capability.tools.includes('framework_guide'));
  const cards = capabilities.map(capability => {
    const entry = capabilityEntry(capability, hasGuide);
    const route = capability.id === 'team' && !capability.tools.some(tool =>
      ['team_start', 'team_dispatch'].includes(tool))
      ? '需要查看已有成员或回报；创建成员与启动任务取决于当前开放的工具。'
      : capability.route;
    return `- \`${capability.id}\` · **${capability.title}**：${route}${entry ? ` ${entry}` : ''}`;
  }).join('\n');
  const guideHint = hasGuide
    ? '决定采用某项高级能力后，需要详细协议时调用 `framework_guide` 并传入上方能力 ID；不要凭旧会话记忆猜测已关闭能力的用法。'
    : '';
  return [
    '## 选择可用能力',
    collaboration
      ? '处理可执行请求时，在第一个实质动作前初选工作形态；可以先做少量读取确认边界。发现新的独立责任单元、等待或复核需要时重新选择，不要把开工时的单干判断视为固定。简单交流和紧密串行任务可直接完成。'
      : '需要检查状态、记录或长期知识时，从当前提供的能力中选择；无须为了使用能力而增加流程。',
    canStartTeam
      ? '中等任务只要有一块独立且可验收的工作，就可考虑在亲自修改前用 `team_start` 派出成员。摸清边界后，若有两个可独立验收、不会争用同一文件或状态的工作面，默认在首次写入前用 `team_start` 派出其中一块，自己推进另一块并整合；无需先证明并行更快。例如，两个互不依赖的模块各有测试时，一块交成员、一块留主线；不要只因源文件少就排除分工。单点修改、强串行依赖或交接成本明显更高时直接完成。'
      : '',
    cards, guideHint,
    '这些能力可以组合使用，但应明确各自负责的状态与工作，避免重复执行或产生多个相互矛盾的事实来源。',
  ].filter(Boolean).join('\n\n');
}

export function activeMainCapabilities(defs: readonly ToolDef[]): MainCapability[] {
  const names = new Set(defs.map(definition => definition.name));
  const local = MAIN_CAPABILITIES.map(capability => ({
    ...capability, tools: capability.tools.filter(name => names.has(name)),
  })).filter(capability => capability.tools.length > 0);
  const dynamic = new Map<string, MainCapability>();
  for (const definition of defs) {
    const descriptor = definition.frameworkCapability;
    if (!descriptor) continue;
    const existing = dynamic.get(descriptor.id);
    if (existing && !sameDescriptor(existing, descriptor)) {
      throw new Error('FRAMEWORK_CAPABILITY_DESCRIPTOR_CONFLICT');
    }
    if (existing) existing.tools.push(definition.name);
    else dynamic.set(descriptor.id, { ...structuredClone(descriptor), tools: [definition.name] });
  }
  const localIds = new Set(local.map(capability => capability.id));
  if ([...dynamic.keys()].some(id => localIds.has(id))) {
    throw new Error('FRAMEWORK_CAPABILITY_DESCRIPTOR_CONFLICT');
  }
  return [...local, ...dynamic.values()];
}

export function renderMainCapabilityGuide(
  capabilityId: string,
  defs: readonly ToolDef[],
  taskboard: unknown,
  action?: string,
): string {
  const capability = activeMainCapabilities(defs)
    .find(candidate => candidate.id === capabilityId);
  if (!capability) throw new Error('FRAMEWORK_GUIDE_UNAVAILABLE');
  const tools = defs.filter(definition => capability.tools.includes(definition.name));
  const extra = capability.detail === 'taskboard-state'
    ? `set/clear 使用当前 expectedRevision；冲突后先 get 再合并。当前任务板：\n${JSON.stringify(taskboard)}`
    : '';
  const definitions = tools.some(tool => tool.frameworkCapability)
    ? renderCapabilityActions(capability.id, tools, capability.actionGuide, action)
    : renderMainToolDefinitions(tools);
  return [action ? '' : capability.guidance, extra,
    action ? '' : renderCapabilityExamples(capability), definitions]
    .filter(Boolean).join('\n\n');
}

function renderCapabilityExamples(capability: MainCapability): string {
  const available = new Set(capability.tools);
  const examples = (capability.examples ?? []).filter(example =>
    example.actions.length > 0 && example.actions.every(action => available.has(action)))
    .slice(0, 2);
  if (!examples.length) return '';
  const lines = examples.map(example =>
    `- 场景：${example.scenario}。操作：${example.actions.map(action => `\`${action}\``).join(' → ')}。确认：${example.confirmation}`);
  return `### 使用示例\n${lines.join('\n')}`;
}

function renderCapabilityActions(
  capabilityId: string, tools: readonly ToolDef[], layered = false, action?: string,
): string {
  const gateway = frameworkCapabilityToolName(capabilityId);
  if (layered && !action) {
    const entries = tools.map(tool => `- \`${tool.name}\`：${tool.description}`);
    return `通过 \`${gateway}\` 调用本能力。先选择 action；需要字段时再调用 \`framework_guide\` 并传入 capability 与 action。\n${entries.join('\n')}`;
  }
  if (layered && action && !tools.some(tool => tool.name === action)) {
    throw new Error('FRAMEWORK_GUIDE_ACTION_UNAVAILABLE');
  }
  const selected = action ? tools.filter(tool => tool.name === action) : tools;
  const actions = selected.map(tool => `#### action: ${tool.name}\n${tool.description}\ninput JSON Schema：\n${JSON.stringify(tool.parameters ?? {})}`);
  return `通过 \`${gateway}\` 调用本能力。将 \`action\` 设为下列操作名，将对应参数对象放入 \`input\`；只能使用当前指南列出的 action。\n\n${actions.join('\n\n')}`;
}

function sameDescriptor(
  left: FrameworkCapabilityDescriptor,
  right: FrameworkCapabilityDescriptor,
): boolean {
  return left.id === right.id && left.title === right.title
    && left.route === right.route && left.guidance === right.guidance
    && left.detail === right.detail && left.actionGuide === right.actionGuide
    && JSON.stringify(left.examples ?? []) === JSON.stringify(right.examples ?? []);
}
