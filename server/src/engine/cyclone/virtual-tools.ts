/**
 * 气旋工位虚拟工具 schema —— 原生工具调用模式专用
 *
 * 依赖边界：cyclone 不 import 季风/对流的 virtual-tools。
 * 只 import shared/。
 *
 * 各场景的虚拟工具组合：
 * - 私聊：ask + delegate + contact + dispatch（可同步联络，也可异步交办固定工位）
 * - 群聊：contact（讨论场，剥 ask/delegate 不阻塞串行循环，但保留联络）
 * - 被联络方一轮：delegate + contact（无人类在场，剥 ask，可继续嵌套联络）
 *
 * 文本模式：虚拟工具与普通工具共用 JSON 调用信封。
 * 原生模式：模型只能看见 tools 参数里的工具，故必须把虚拟工具也作为 ToolDef 注入。
 */

import type { ToolDef } from '../shared/tool-defs-loader';
import { buildRegisterToolDef } from '../shared/tool-registration.js';
import type { ContactTarget } from './contact-registry';

export interface SeatVirtualToolOpts {
  /** 群聊副本不持有工位任务板；任务板只属于固定工位的执行上下文。 */
  allowTaskBoard?: boolean;
  /** 是否注入 ask（向人类提问挂起）。群聊/被联络方=false */
  allowAsk?: boolean;
  /** 是否注入 delegate（拆子任务给 SubAgent）。群聊=false */
  allowDelegate?: boolean;
  /** 是否注入 dispatch（把复杂工作异步派给固定工位） */
  allowDispatch?: boolean;
  /** 是否允许在有人类在场的工位私聊中确认并注册全局工具 */
  allowToolRegistration?: boolean;
  /** 可联络的其他工位（去自身，带职责名片）。非空才注入 contact */
  contactTargets?: ContactTarget[];
  /** 可异步派发的固定工位；群聊可包含自身。缺省沿用 contactTargets。 */
  dispatchTargets?: ContactTarget[];
}

/**
 * 构建气旋工位原生模式的虚拟工具定义。
 */
export function buildSeatVirtualToolDefs(opts: SeatVirtualToolOpts = {}): ToolDef[] {
  const {
    allowTaskBoard = true,
    allowAsk = true,
    allowDelegate = true,
    allowDispatch = false,
    allowToolRegistration = false,
    contactTargets = [],
  } = opts;
  const dispatchTargets = opts.dispatchTargets ?? contactTargets;
  const defs: ToolDef[] = [];
  if (allowTaskBoard) defs.push({
      name: 'task_board',
      description: '维护本工位的任务板（用户可见的结构化进度清单）。多步骤任务先写出拆解，每当开始或完成一项就整块覆盖更新，让用户实时看到进度。单步问答不必建板。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'set=整体覆盖写入 / get=读取当前板子 / clear=清空' },
          expectedRevision: { type: 'integer', description: '（set/clear 时）当前任务板 revision；空板首次创建传 0。版本冲突时先 get 再合并' },
          goal: { type: 'string', description: '（set 时）本工位当前总目标，一句话' },
          tasks: { type: 'array', description: '（set 时）完整任务列表，覆盖式写入，须含所有任务的最新状态。每项为对象 { title, status: todo|doing|done|blocked, note? }' },
        },
        required: ['action'],
      },
    });
  defs.push({
      name: 'bulletin',
      description: '读取工作室公告板或新增条目（全体工位共享、所有工位可见的结构化看板）。改写和删除仅人类可执行。全体要知晓的结论、目标、状态变化或记录索引保持简短，完整证据留在工位。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'get=读取 / add=新增条目' },
          text: { type: 'string', description: '（add 时）条目内容，一句话结论或事项' },
        },
        required: ['action'],
      },
    });

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
      description: `将本工位职责内、无需长期岗位上下文的临时并行子任务委托给独立 SubAgent，完成后返回摘要。${allowDispatch ? '跨工位职责或需要持续岗位上下文时，优先 dispatch 给固定工位。' : '跨工位职责先联络相应工位。'}单个 SubAgent 工具调用上限约25轮，任务过大需拆分。`,
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

  if (allowToolRegistration) defs.push(buildRegisterToolDef());

  if (allowDispatch && dispatchTargets.length > 0) {
    const nameList = dispatchTargets.map(target => target.title).join('、');
    const roster = dispatchTargets.map(target => `  - ${target.title}：${target.duty}`).join('\n');
    defs.push({
      name: 'dispatch',
      description: `把明确、可独立完成的工作异步派发给本工作室的固定工位。不必等待结果；在群聊中会于本轮结束后启动，在工位私聊中会立即进入后台队列。群聊副本可以派发给自己的固定工位，让讨论结论进入长期执行上下文。\n可选目标（工位：职责）：\n${roster}`,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: `目标工位名称（可选值：${nameList}）` },
          task: { type: 'string', description: '要交办的完整任务，包含目标、必要背景和交付要求' },
        },
        required: ['target', 'task'],
      },
    });
  }

  return defs;
}

/** 被联络轮次不持有独立任务板，也没有可回答 ask 的人类。 */
export function buildContactVirtualToolDefs(contactTargets: ContactTarget[]): ToolDef[] {
  return buildSeatVirtualToolDefs({ allowTaskBoard: false, allowAsk: false, contactTargets });
}
