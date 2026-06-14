/**
 * 季风虚拟工具 schema —— 原生工具调用模式专用
 *
 * 背景：ask / delegate / list_agents / create_workflow 不在 tools/registry.json，
 * 是 session-runner 的 toolCaller 按工具名拦截执行的「虚拟工具」。
 *
 * 文本协议模式：靠 system prompt 文本教模型写 <action tool="ask">，正则解析后拦截。
 * 原生模式：模型只能看见 tools 参数里的工具，因此必须把这些虚拟工具也作为 ToolDef
 *           注入 tools 参数，模型才能在原生通道调用它们。执行端拦截逻辑不变。
 *
 * 季风专属（信风/对流虚拟工具集不同：信风有 contact 无 ask），符合引擎隔离。
 */

import type { ToolDef } from '../shared/tool-defs-loader';

/**
 * 构建季风原生模式的虚拟工具定义。
 * @param allowWorkflow 是否注入工作流搭建工具（list_agents/create_workflow）
 */
export function buildVirtualToolDefs(allowWorkflow = true): ToolDef[] {
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
  ];

  if (allowWorkflow) {
    defs.push(
      {
        name: 'list_agents',
        description: '列出框架内所有可用的 Agent 实体（id + 名称 + 角色）。搭建信风工作流前先调用确认可用 Agent。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'create_workflow',
        description: '创建一个完整的信风工作流。必须先 list_agents 确认 agentId 真实存在。',
        parameters: {
          type: 'object',
          properties: {
            params: { type: 'string', description: 'JSON 字符串，包含 name、nodes、edges。节点类型 entry/agent/meeting/human-gate/note/output；边 {source,target} 须构成 DAG（无环）' },
          },
          required: ['params'],
        },
      },
    );
  }

  return defs;
}
