/**
 * 气旋工位虚拟工具 schema —— 原生工具调用模式专用
 *
 * 边界铁律：cyclone 各写各的，不 import 季风/对流的 virtual-tools。
 * 只 import shared/。
 *
 * 各场景的虚拟工具组合（经验源自信风成熟设计）：
 * - 私聊：ask + delegate + contact（执行工位，有人类可问、可派子、可联络同事）
 * - 群聊：contact（讨论场，剥 ask/delegate 不阻塞串行循环，但保留联络）
 * - 被联络方一轮：delegate + contact（无人类在场，剥 ask，可继续嵌套联络）
 *
 * 文本协议模式：靠 system prompt 文本教模型写 <action tool="ask">，正则拦截。
 * 原生模式：模型只能看见 tools 参数里的工具，故必须把虚拟工具也作为 ToolDef 注入。
 */

import type { ToolDef } from '../shared/tool-defs-loader';
import type { ContactTarget } from './contact-registry';

export interface SeatVirtualToolOpts {
  /** 是否注入 ask（向人类提问挂起）。群聊/被联络方=false */
  allowAsk?: boolean;
  /** 是否注入 delegate（拆子任务给 SubAgent）。群聊=false */
  allowDelegate?: boolean;
  /** 可联络的其他工位（去自身，带职责名片）。非空才注入 contact */
  contactTargets?: ContactTarget[];
}

/**
 * 构建气旋工位原生模式的虚拟工具定义。
 */
export function buildSeatVirtualToolDefs(opts: SeatVirtualToolOpts = {}): ToolDef[] {
  const { allowAsk = true, allowDelegate = true, contactTargets = [] } = opts;
  const defs: ToolDef[] = [];

  if (allowAsk) {
    defs.push({
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
    });
  }

  if (allowDelegate) {
    defs.push({
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
    });
  }

  if (contactTargets.length > 0) {
    const nameList = contactTargets.map(t => t.title).join('、');
    const roster = contactTargets.map(t => `  - ${t.title}：${t.duty}`).join('\n');
    defs.push({
      name: 'contact',
      description: `联络本工作室里的另一个工位。对方会在自己的会话里完整处理你的消息并返回回复。\n可选目标（工位：职责）：\n${roster}\n按职责挑对人，不要向正在联络你的工位反向联络（死锁）。`,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: `目标工位名称（可选值：${nameList}）` },
          message: { type: 'string', description: '你要传达的内容（问题、请求、交办事项等）' },
        },
        required: ['target', 'message'],
      },
    });
  }

  return defs;
}
