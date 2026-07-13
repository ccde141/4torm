/**
 * 信风虚拟工具 schema —— 原生工具调用模式专用
 *
 * 背景：delegate / contact 不在 tools/registry.json，
 * 是 NodeRunner 的 toolCaller 按工具名拦截执行的「虚拟工具」。
 *
 * 文本协议模式：靠 system prompt 文本教模型写 <action tool="delegate">，正则解析后拦截。
 * 原生模式：模型只能看见 tools 参数里的工具，因此必须把这些虚拟工具也作为 ToolDef
 *           注入 tools 参数，模型才能在原生通道调用它们。执行端拦截逻辑不变。
 *
 * 信风专属（与季风 ask、对流空集不同：信风有 contact 无 ask），符合引擎隔离。
 */

import type { ToolDef } from '../../shared/tool-defs-loader';

export interface BuildVirtualToolDefsParams {
  /** 是否注入 delegate（sub-agent 委托）。沙箱级别在 prompt 段落里说明，schema 不带。 */
  allowDelegate: boolean;
  /** 当前节点之外的协作者标签列表（teamRoster 去自身）。≥1 才注入 contact */
  contactTargets: string[];
}

/**
 * 构建信风原生模式的虚拟工具定义。
 */
export function buildVirtualToolDefs(params: BuildVirtualToolDefsParams): ToolDef[] {
  const { allowDelegate, contactTargets } = params;
  const defs: ToolDef[] = [];

  if (allowDelegate) {
    defs.push({
      name: 'delegate',
      description: '将子任务委托给独立 SubAgent 执行。SubAgent 在隔离上下文中完成任务后返回结果摘要。涉及阅读/探索/调查/对比、或需读取多个文件时优先使用。单个 SubAgent 工具调用上限约90轮，可独立完成相当复杂的任务，不必切得过碎。',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '任务描述（清晰、具体、可独立执行）' },
          context: { type: 'string', description: '必要背景信息。SubAgent 看不到你的对话历史，涉及文件/目录时必须写明绝对路径' },
          systemPrompt: { type: 'string', description: 'SubAgent 的角色定义' },
        },
        required: ['task', 'context', 'systemPrompt'],
      },
    });
  }

  if (contactTargets.length > 0) {
    const targetList = contactTargets.join('、');
    defs.push({
      name: 'contact',
      description: `联络工作流中的另一位协作者。对方会完整处理你的消息并返回回复。可选目标：${targetList}。不要向正在联络你的节点反向联络（死锁）。`,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: `目标协作者名称（可选值：${targetList}）` },
          message: { type: 'string', description: '你要传达的内容（问题、请求、交办事项等）' },
        },
        required: ['target', 'message'],
      },
    });
  }

  return defs;
}

/**
 * 构建自动模式的四个信封工具定义（增/删/扫 + 完成任务）。
 *
 * 仅在自动模式注入（手动模式的信封由人类点"传递"触发，无需这些工具）——
 * 是"两模式代码逻辑分离"的一部分。执行端拦截见 envelope-draft.ts 的
 * execEnvelopeTool；complete_task 由 native 循环识别为终结信号（决策报告 §一、§三）。
 */
export function buildEnvelopeToolDefs(): ToolDef[] {
  return [
    {
      name: 'envelope_add',
      description: '向【交接信封】添加一条结构化交接信息（纯文本，一条一个要点）。你在多轮工作中随时可调用，逐步把要交给下游的硬信息（结论、数据、约束等）沉淀进信封。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '一条交接要点，简洁完整、可独立理解' },
        },
        required: ['text'],
      },
    },
    {
      name: 'envelope_remove',
      description: '从【交接信封】按条目 id 删除一条（id 用 envelope_list 查看）。用于修正、删掉过时或写错的条目。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '条目 id（形如 e1、e2）' },
        },
        required: ['id'],
      },
    },
    {
      name: 'envelope_list',
      description: '列出【交接信封】当前所有条目及其 id，供你自查与修正。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'complete_task',
      description: '声明本节点工作完成：封口交接信封并传递给下游。仅在你确认最终目标已达成时调用。可附一段自由备注（口语化的交接说明、注意事项）。⚠ 未调用此工具，系统不会向下游传递任何东西——绝不要用普通文本表示"我做完了"。',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: '给下游的自由备注（可选）：交接说明、注意事项、口头补充等' },
        },
      },
    },
  ];
}
