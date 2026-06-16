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
