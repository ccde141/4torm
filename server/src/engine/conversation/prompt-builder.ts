/**
 * 普通会话 system prompt 构建器
 *
 * 构建顺序（由外到内，由大到小）：
 *   1. 元认知（meta.md）— 我是什么，我运行在什么平台
 *   2. 空间 + 权限（sandbox）— 我在哪里操作
 *   3. 角色定义（rolePrompt）— 我扮演谁
 *   4. 基线固件（baseline.md）— 我怎么干活
 *   5. 协议段（native / text）— 我有什么工具
 *   6. delegate 说明
 *   7. ask 说明
 *   8. 工作流搭建假工具
 *   9. 长期记忆（条目化召回 + 记忆自觉引导）
 */

import type { ToolDef } from '../shared/tool-defs-loader';
import { recallMemory } from '../shared/agent-memory';
import { buildSandboxSection, type SandboxLevel } from '../shared/sandbox-prompt';
import { buildWorkflowToolsSection } from '../../services/tradewind-tools/builder';
import { buildSelfManagementSection, buildTextToolProtocol } from '../shared/prompt';
import { buildTaskBoardSection, readTaskboard, taskboardFile } from '../shared/taskboard';
import { buildAgentMeta } from '../shared/meta-prompt.js';
import { SEASON_META } from './meta-profile.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';

function buildDelegateSection(): string {
  return `\n\n### delegate
  描述: 将子任务委托给独立的 SubAgent 执行。SubAgent 拥有与你相同的工具集，在隔离环境中独立完成任务后返回结果摘要。
  参数:
    task: string [必填] — 任务描述（清晰、具体、可独立执行）
    context: string [必填] — 必要的背景信息（SubAgent 看不到你的对话历史；**必须在此说明 SubAgent 需要工作的绝对路径或目录**）
    systemPrompt: string [必填] — SubAgent 的角色定义

## 关于 SubAgent 的执行权限

你派出的 SubAgent 使用相同的统一执行策略：
- 相对路径基于它的工作区，绝对路径直接使用。
- 框架控制面仍禁止通过普通文件工具直接改写。
- 委托涉及具体文件/目录时，**必须在 context 中写明绝对路径**，因为 SubAgent 看不到你的上下文。

## 工作方法：先收集再综合

你的核心工作模式是「委托收集 → 自己综合」：
- 当任务涉及阅读、探索、调查、对比时，先用 delegate 派出 SubAgent 收集原始信息，然后基于返回的结果进行综合分析和回答。

### 任务拆分原则（重要，违反将导致 SubAgent 超限失败）

SubAgent 有严格的工具调用次数上限（单次最多 25 轮）。超过此上限任务直接失败。

你必须提前估算任务需要的步数。如果一个任务需要约 5 步以上工具调用，就必须拆分为多个 delegate。

硬性规则：
- 一个 delegate 最多读取 3-5 个文件
- 读取 6 个以上文件 → 至少拆成 2 个 delegate
- 探索搜索 + 读取 + 分析 → 每个环节单独 delegate
- 不要把"扫描整个模块"或"审计整个项目"塞给单个 SubAgent
- 宁可多派 3-4 个小任务，也不要一个大任务超限失败

正确拆分示例：
❌ 错误："审计 src/ 目录下所有模块" → 1 个 SubAgent → 必超限
✅ 正确：拆成 "审计 src/auth/" + "审计 src/api/" + "审计 src/store/" → 3 个并行

### 必须 delegate 的场景
1. 用户要求分析/理解一个项目、模块、或代码库
2. 用户要求对比多个方案/文件/实现
3. 用户的问题需要读取 2 个以上文件才能回答
4. 用户要求做调研、梳理、盘点

### 不要 delegate 的场景
- 用户问一个你已经知道答案的问题（纯推理）
- 只需要读一个文件就能回答
- 需要与用户确认才能继续的决策`;
}

export interface PromptBuildOpts {
  rolePrompt: string;
  toolDefs: ToolDef[];
  /** 工作区相对路径（项目根相对，如 "data/agents/{id}/.workspace/"） */
  workspace: string;
  /** 工作区绝对路径（用于沙箱段展示） */
  workspaceAbs: string;
  /** 项目根绝对路径 */
  projectDir: string;
  /** 沙箱级别 */
  sandboxLevel: SandboxLevel;
  skillIds: string[];
  dataDir: string;
  agentId: string;
  /** 会话 ID：用于读取本会话的任务板并注入当前进度 */
  sessionId?: string;
  /** 用户消息内容（用于判断是否触发记忆注入） */
  userMessage?: string;
  /**
   * 原生工具调用模式：使用 provider 的结构化工具通道，
   * 工具的调用格式由 provider 处理，prompt 只保留工具的语义指导。
   */
  native?: boolean;
  /** 当前入口是否允许挂起等待人类回答。默认开启。 */
  allowAsk?: boolean;
  /** 当前入口是否允许派出 SubAgent。默认开启。 */
  allowDelegate?: boolean;
  /** 当前功能区的身份段；缺省为季风。 */
  surfaceMeta?: string;
}

function buildSelfDispatchSection(allowAsk: boolean, allowDelegate: boolean): string {
  const rules: string[] = [];
  if (allowAsk) rules.push('- 目标模糊、信息不足、需要人类判断 → 使用 ask');
  if (allowDelegate) {
    rules.push('- 子任务明确且可独立完成或者单一任务比较复杂且执行步骤多 → 使用 delegate');
  }
  if (!rules.length) return '';
  return `### 自我调度\n\n你不需要独自承担所有事情：\n\n${rules.join('\n')}`;
}

/**
 * 记忆自觉引导（积极触发版）。
 * 文本/native 都注入：native 已有 memory_* 的 schema，此段承载"何时该主动记"。
 * 工具执行由引擎侧拦截（execMemoryTool），自动补时间戳与来源，agent 无需关心。
 */
function buildMemoryAwarenessSection(): string {
  return `## 你的长期记忆

你有跨会话、跨任务的长期记忆。这次记下的，下次相关对话开始时会自动出现在上方「你的经验记忆」里。

### 积极记录（用 memory_write）
**宁可多记，不要漏记**。只要出现对未来有复用价值的信息，就立刻记一条，别等：
- 用户表达偏好、习惯、约定，或纠正了你的做法 → category=feedback
- 用户说"记住/以后/务必/别再/我们约定"这类跨会话指令 → **必须** memory_write，这是硬信号
- 你踩坑并找到规避法 → category=pitfall
- 确认了可复用的事实（项目约定、文件路径、接口、数据位置）→ category=fact
- 值得回访的外部资源 → category=reference

### 防噪音（唯一约束）
写入前先 memory_list 看有没有同类，**有则不重复写**；summary 要一句话说清（召回匹配的关键）。

### 工具
- memory_write(summary, detail, category, tags?) — 记一条
- memory_list() — 查已有，去重
- memory_read(slug) — 读某条全文`;
}

/** 原生模式的精简协议段 */
function buildNativeProtocol(): string {
  return `## 工作方式

你可以调用工具来完成任务。需要时直接发起工具调用，系统会执行并把结果返回给你，你据此继续或给出最终回答。

- 需要外部信息或执行操作（读写文件、运行命令、查询等）时，调用对应工具
- 串行依赖（需要前一步结果才能进行下一步）请分多轮调用，不要一次性堆叠
- 工具结果返回后，继续下一步或直接给出最终回答
- 全部完成后，用自然语言给出完整的最终回答即可（无需任何特殊标签）
- 不确定时优先用工具确认，不要凭假设行动`;
}

/** 构建完整 system prompt */
export async function buildConversationSystemPrompt(opts: PromptBuildOpts): Promise<string> {
  const parts: string[] = [];
  const allowAsk = opts.allowAsk !== false;
  const allowDelegate = opts.allowDelegate !== false;

  // 1. 共同元认知 + 当前功能区身份
  parts.push(buildAgentMeta(opts.surfaceMeta ?? SEASON_META));

  // 2. 空间 + 权限：我在哪里操作
  parts.push(buildSandboxSection({
    workspaceAbs: opts.workspaceAbs,
    projectDir: opts.projectDir,
    sandboxLevel: opts.sandboxLevel,
    workspaceLabel: '你的工作区（专属）',
  }));

  // 3. 角色定义：我扮演谁
  if (opts.rolePrompt.trim()) parts.push(opts.rolePrompt.trim());

  // 4. 基线固件：我怎么干活
  const baselinePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'baseline.md');
  try {
    const baseline = await fs.readFile(baselinePath, 'utf-8');
    if (baseline.trim()) parts.push(baseline.trim());
  } catch { /* baseline.md 不存在时跳过 */ }

  const dispatchSection = buildSelfDispatchSection(allowAsk, allowDelegate);
  if (dispatchSection) parts.push(dispatchSection);

  // 5. 协议段：我有什么工具（原生模式精简 / 文本模式完整）
  if (opts.native) {
    parts.push(buildNativeProtocol());
  } else if (opts.toolDefs.length > 0) {
    parts.push(buildTextToolProtocol(opts.toolDefs));
  }

  // 6. delegate 说明
  if (allowDelegate) parts.push(buildDelegateSection());

  // 7. ask 说明
  if (allowAsk) parts.push(buildAskSection());

  // 8. 工作流搭建假工具
  parts.push(buildWorkflowToolsSection(opts.native, allowAsk));

  // 8.5 能力扩展（查看 / 创建工具、技能、MCP）— 与对流/气旋/信风共用 shared 单一来源
  parts.push(buildSelfManagementSection({
    allowToolRegistration: Boolean(opts.sessionId),
    native: opts.native,
  }));

  // 9. 长期记忆（新机制：条目化 + 相关性召回，替代旧 MEMORY.md 全文注入）
  //    userMessage 作 taskHint：feedback 常驻档必带，情境档按相关性挑。召回失败静默降级。
  try {
    const memSection = await recallMemory(opts.dataDir, opts.agentId, opts.userMessage);
    if (memSection) parts.push(memSection);
  } catch { /* 召回失败不阻断对话 */ }

  // 9.5 记忆自觉引导（积极触发：宁可多记，靠 memory_list 去重防噪音）
  parts.push(buildMemoryAwarenessSection());

  // 10. 任务板假工具：始终描述用法（与 ask/delegate 同级）；已有板子时附当前状态（放最后，最贴近用户轮次）
  const board = opts.sessionId
    ? readTaskboard(taskboardFile(opts.dataDir, opts.agentId, opts.sessionId))
    : null;
  parts.push(`## 任务板\n\n${buildTaskBoardSection(board, opts.native)}`);

  return parts.join('\n\n');
}

/** ask 虚拟工具说明（向人类提问） */
function buildAskSection(): string {
  return `

### ask
  描述: 向用户提出问题，等待回复后继续。适用于需要用户确认方向、选择方案、或补充关键信息时。
  参数:
    question: string [必填] — 简短一句问句（≤30 字），不要写成解释段落
    options: string [可选] — JSON 数组，2-4 个互斥短语（每项 ≤10 字），如 '["方案A","方案B","方案C"]'

  规则：
  - 仅在信息不足、存在歧义、或需要用户决策时使用。已能推断的事不要问。
  - 每次只问一个问题，不要在一轮中多次调用 ask。
  - options 要互斥、覆盖合理范围、文字精炼。用户也可自由输入选项外的答案。

  正确示例：
  {"type":"tool_call","name":"ask","arguments":{"question":"遇到了什么类型的问题？","options":"[\\"代码报错\\",\\"界面异常\\",\\"功能不符预期\\"]"}}

  错误示例（question 写成段落、options 过多且重叠）：
  {"type":"tool_call","name":"ask","arguments":{"question":"能具体说说发生了什么吗？比如出现了什么错误提示、哪个功能异常、或者在哪一步卡住了？尽量描述一下你看到的现象，我好帮你排查。","options":"[\\"代码报错或运行异常\\",\\"文件/数据丢失或损坏\\",\\"界面显示不正常\\",\\"操作没有达到预期效果\\",\\"系统或环境出现问题\\",\\"其他问题\\"]"}}

  对比要点：
  - question 是一句问句，不是一段引导语
  - options 互斥、≤4 项、每项简短，"其他"由前端自由输入框承载，不必显式列出
  - **格式铁律**：ask 只能通过 JSON tool_call 信封调用，调用信封外不能包含其他文字。

## 何时应主动使用 ask

你不是被动的执行者——当发现推进方向不明确时，应该主动向用户提问而非凭假设行动。

以下场景应优先使用 ask：
- **bug 分析有多个可能根因**：列出 2-4 个假设让用户确认现象，而非逐个猜测验证
- **技术选型存在权衡**：先了解用户的约束（性能/团队熟悉度/生态/工期），再推荐方案
- **需求描述模糊**：确认范围和边界，而非按最大化理解去实现
- **方案有不可逆后果**：如数据库迁移、架构重构、依赖更换，先确认用户接受的风险等级
- **多步推演需要中间确认**：如选型推演，每一步收窄方向后确认再继续

不应使用 ask 的场景：
- 你已经有足够信息做出判断
- 问题答案可以通过工具调用获得（先查再问）
- 问题过于琐碎（如文件命名风格），直接按最佳实践做`;
}
