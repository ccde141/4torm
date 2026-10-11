/**
 * 季风虚拟工具 schema —— 原生工具调用模式专用
 *
 * 背景：ask / delegate 等会话级能力不在 tools/registry.json，
 * 是 session-runner 的 toolCaller 按工具名拦截执行的「虚拟工具」。
 *
 * 文本模式：虚拟工具与普通工具共用 JSON 调用信封。
 * 原生模式：模型只能看见 tools 参数里的工具，因此必须把这些虚拟工具也作为 ToolDef
 *           注入 tools 参数，模型才能在原生通道调用它们。执行端拦截逻辑不变。
 *
 * 季风专属（信风/对流虚拟工具集不同：信风有 contact 无 ask），符合引擎隔离。
 */

import type { ToolDef } from '../shared/tool-defs-loader';
import { buildRegisterToolDef } from '../shared/tool-registration.js';

export function shouldAttachToolCaller(
  visibleToolDefs: readonly ToolDef[],
  hasIntercept: boolean,
): boolean {
  return visibleToolDefs.length > 0 || hasIntercept;
}

/**
 * 构建季风原生模式的虚拟工具定义。
 */
export function buildVirtualToolDefs(
  allowToolRegistration = false,
  capabilities: {
    allowAsk?: boolean;
    allowDelegate?: boolean;
    allowFrameworkStatus?: boolean;
  } = {},
): ToolDef[] {
  const defs: ToolDef[] = [
    {
      name: 'ask',
      description: '向用户提出问题并等待回复后继续。仅在信息不足、存在歧义、或需要用户决策时使用；已能推断的事不要问。每次只问一个问题。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '简短一句问句（≤30字），不要写成解释段落' },
          options: { type: 'string', description: "可选。JSON 数组字符串，2-4个互斥短语（每项≤10字），如 '[\"方案A\",\"方案B\"]'。用户也可自由输入选项外答案。" },
        },
        required: ['question'],
      },
    },
    {
      name: 'delegate',
      description: '将子任务委托给独立 SubAgent 执行。SubAgent 在隔离上下文中完成任务后返回结果摘要。涉及阅读/探索/调查/对比、或需读取2个以上文件时优先使用。单个 SubAgent 工具调用上限约25轮，任务过大需拆分为多个 delegate。',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '任务描述（清晰、具体、可独立执行）' },
          context: { type: 'string', description: '必要背景信息。SubAgent 看不到你的对话历史，涉及文件/目录时必须写明绝对路径' },
          systemPrompt: { type: 'string', description: 'SubAgent 的角色定义' },
        },
        required: ['task', 'context', 'systemPrompt'],
      },
    },
    {
      name: 'task_board',
      description: '维护本会话的任务板（用户可见的结构化进度清单）。多步骤任务先写出拆解，每当开始或完成一项就整块覆盖更新，让用户实时看到进度。单步问答不必建板。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'set=整体覆盖写入 / get=读取当前板子 / clear=清空' },
          expectedRevision: { type: 'integer', description: '（set/clear 时）当前任务板 revision；空板首次创建传 0。版本冲突时先 get 再合并' },
          goal: { type: 'string', description: '（set 时）本会话总目标，一句话' },
          tasks: { type: 'array', description: '（set 时）完整任务列表，覆盖式写入，须含所有任务的最新状态。每项为对象 { title, status: todo|doing|done|blocked, note? }' },
        },
        required: ['action'],
      },
    },
    {
      name: 'review_changes',
      description: '复查本轮已完成的全部文件改动：按文件汇总 unified diff（含增删统计）。在多文件编辑后、交付或自我 code review 前调用，一次性结构化回看自己改了什么。无参数。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ];

  if (capabilities.allowFrameworkStatus) {
    defs.push({
      name: 'framework_status',
      description: '读取 4torm 中心路由的统一只读快照：季风、对流、气旋、信风、潮汐的真实运行状态。可调用能力以本轮工具定义和能力路由卡为准；启动持续工作后核对状态，或继续旧任务前判断是否已有执行时使用。',
      parameters: { type: 'object', properties: {}, required: [] },
    });
    defs.push({
      name: 'framework_guide',
      description: '按需读取一项当前可用框架能力的完整使用协议和工具字段。先从主提示词的能力路由卡选择 capability；能力已关闭时会明确拒绝。',
      parameters: {
        type: 'object',
        properties: {
          capability: { type: 'string', description: '能力路由卡中的 ID，例如 team、tradewind、tide' },
          action: { type: 'string', description: '分层能力指南中的操作名；先只传 capability 查操作目录' },
        },
        required: ['capability'],
      },
    });
  }

  if (allowToolRegistration) defs.push(buildRegisterToolDef());

  return defs.filter(def => {
    if (def.name === 'ask') return capabilities.allowAsk !== false;
    if (def.name === 'delegate') return capabilities.allowDelegate !== false;
    return true;
  });
}
