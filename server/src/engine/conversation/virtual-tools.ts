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
import { buildRegisterToolDef } from '../shared/tool-registration.js';

export function shouldAttachToolCaller(
  visibleToolDefs: readonly ToolDef[],
  hasIntercept: boolean,
): boolean {
  return visibleToolDefs.length > 0 || hasIntercept;
}

/**
 * 构建季风原生模式的虚拟工具定义。
 * @param allowWorkflow 是否注入工作流搭建工具（list_agents/create_workflow）
 * @param allowAutomation 是否注入潮汐自动化工具（create_automation）。仅在可交互会话（有 sessionId）注入；
 *        潮汐无人值守运行不注入，避免自我繁殖。
 */
export function buildVirtualToolDefs(
  allowWorkflow = true,
  allowAutomation = false,
  allowToolRegistration = false,
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

  if (allowToolRegistration) defs.push(buildRegisterToolDef());

  if (allowAutomation) {
    defs.push(
      {
        name: 'create_automation',
        description: '为自己创建一个潮汐定时自动化任务。仅在用户明确想让某事「定时/自动重复」执行时使用。创建后任务处于「未启用」状态——你无法自行启动，须用户到潮汐页审阅后手动启用。返回值含任务 id，后续可用 update_automation 调整。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '任务名（简短）' },
            schedule: { type: 'string', description: '执行间隔，格式 "every 5m" / "every 1h" / "every 1h30m"，最小 60 秒（every 1m 起）' },
            prompt: { type: 'string', description: '每次触发执行的指令（清晰、可独立执行）' },
            repeatCount: { type: 'string', description: '可选。重复次数：正整数=跑 N 次；-1=永续。默认 -1' },
            windowN: { type: 'string', description: '可选。滚动上下文窗口：1=每次无历史；≥2 须偶数。默认 1' },
            selfLoop: { type: 'string', description: "可选。'true'=自循环（每轮可自改下轮目标，将强制永续+窗口2）。默认 false" },
          },
          required: ['name', 'schedule', 'prompt'],
        },
      },
      {
        name: 'update_automation',
        description: '修改一个已存在的潮汐任务（按 id）。仅传要改的字段，其余保留。注意：无法改动启用状态（enabled 归用户在潮汐页控制）。改前若不知道 id 先调 list_automations。',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: '要修改的任务 id（必须已存在）' },
            name: { type: 'string', description: '可选。新任务名' },
            schedule: { type: 'string', description: '可选。新间隔（最小 60 秒）' },
            prompt: { type: 'string', description: '可选。新指令' },
            repeatCount: { type: 'string', description: '可选。-1 永续 / ≥1' },
            windowN: { type: 'string', description: '可选。1 或 ≥2 偶数' },
            selfLoop: { type: 'string', description: "可选。'true'/'false'" },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'list_automations',
        description: '列出现有的潮汐任务（id / 名称 / 间隔 / 次数 / 是否启用 / 执行 agent）。修改任务前先调用它拿到 id。无参数。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    );
  }

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
      {
        name: 'list_workflows',
        description: '查看已有的信风工作流。不传参数=列出所有工作流（id/名称/节点数）；传 workflowId=返回该工作流的完整结构（节点+边）。修改工作流前必须先调用它拿到当前结构。',
        parameters: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: '可选。要查看详情的工作流 id；不填则列出全部。' },
          },
          required: [],
        },
      },
      {
        name: 'update_workflow',
        description: '修改已有的信风工作流（整图替换）。仅当用户明确要求修改某个工作流或编辑其节点内容时才使用，且修改前应先向用户确认改动方案。必须先 list_workflows 拿到完整结构，在其基础上改动后提交完整的 nodes/edges。',
        parameters: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: '要修改的工作流 id（必须已存在，不会新建）' },
            params: { type: 'string', description: 'JSON 字符串，包含完整的 name、nodes、edges（整图替换，不是增量）。结构与 create_workflow 一致。未改动的节点也要原样带上。' },
          },
          required: ['workflowId', 'params'],
        },
      },
    );
  }

  return defs;
}
