/**
 * 普通会话 system prompt 构建器
 *
 * 构建内容（按顺序）：
 *   1. 角色定义
 *   2. 基线固件（baseline.txt）
 *   3. 输出协议 + 工具列表
 *   4. delegate 说明
 *   5. ask 说明
 *   6. 工作流搭建假工具
 *   7. 「基地 + 沙箱」段（按 sandboxLevel 动态生成）
 *   8. 历史记忆（条件触发）
 */

import type { ToolDef } from '../shared/tool-defs-loader';
import { buildSandboxSection, type SandboxLevel } from '../shared/sandbox-prompt';
import { buildWorkflowToolsSection } from '../shared/workflow-builder';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';

function renderToolList(tools: ToolDef[]): string {
  return tools.map(t => {
    const req = new Set<string>(
      Array.isArray(t.parameters?.required) ? t.parameters!.required : [],
    );
    const props = t.parameters?.properties ?? {};
    const params = Object.entries(props)
      .map(([k, v]) => {
        const mark = req.has(k) ? ' [必填]' : ' [可选]';
        return `    ${k}: ${v?.type ?? 'string'}${mark} — ${v?.description ?? ''}`;
      })
      .join('\n') || '    无参数';
    return `### ${t.name}\n  描述: ${t.description}\n  参数:\n${params}`;
  }).join('\n\n');
}

function buildDelegateSection(parentSandboxLevel: SandboxLevel): string {
  return `\n\n### delegate
  描述: 将子任务委托给独立的 SubAgent 执行。SubAgent 拥有与你相同的工具集，在隔离环境中独立完成任务后返回结果摘要。
  参数:
    task: string [必填] — 任务描述（清晰、具体、可独立执行）
    context: string [必填] — 必要的背景信息（SubAgent 看不到你的对话历史；**必须在此说明 SubAgent 需要工作的绝对路径或目录**）
    systemPrompt: string [必填] — SubAgent 的角色定义

## 关于 SubAgent 的沙箱权限

你派出的 SubAgent **继承你当前的沙箱级别（${parentSandboxLevel}）**。这意味着：
- 你能访问的文件，SubAgent 也能访问；你不能访问的，SubAgent 同样不能。
- 委托涉及具体文件/目录时，**必须在 context 中写明绝对路径**，因为 SubAgent 看不到你的上下文。
- 如果 SubAgent 在结果摘要中报告"路径越权"错误，说明任务路径写错了，或确实需要更高沙箱权限——后者只能告知用户调整 agent 配置。

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
  /** 用户消息内容（用于判断是否触发记忆注入） */
  userMessage?: string;
  /**
   * 原生工具调用模式：跳过 <action>/<answer> 文本协议段（与原生通道冲突），
   * 工具的调用格式由 provider 处理，prompt 只保留工具的语义指导。
   */
  native?: boolean;
}

const MEMORY_TRIGGERS = /记忆|记住|之前|上次|历史|回忆|还记得/;

/** 原生模式的精简协议段（替代 buildOutputProtocol，不教 <action> 格式） */
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

  // 1. 角色定义
  if (opts.rolePrompt.trim()) parts.push(opts.rolePrompt.trim());

  // 2. 基线固件（角色定义优先于基线）
  const baselinePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'baseline.txt');
  try {
    const baseline = await fs.readFile(baselinePath, 'utf-8');
    if (baseline.trim()) parts.push(baseline.trim());
  } catch { /* baseline.txt 不存在时跳过 */ }

  // 3. 协议段：原生模式用精简版（不教 <action>），文本模式用完整输出协议
  if (opts.native) {
    parts.push(buildNativeProtocol());
  } else if (opts.toolDefs.length > 0) {
    parts.push(buildOutputProtocol(opts.toolDefs));
  }

  // 4. delegate 说明（沙箱说明跟着母 agent 级别）
  parts.push(buildDelegateSection(opts.sandboxLevel));

  // 5. ask 说明（向人类提问）
  parts.push(buildAskSection());

  // 6. 工作流搭建假工具说明
  parts.push(buildWorkflowToolsSection());

  // 7. 「基地 + 沙箱」段
  parts.push(buildSandboxSection({
    workspaceAbs: opts.workspaceAbs,
    projectDir: opts.projectDir,
    sandboxLevel: opts.sandboxLevel,
    workspaceLabel: '你的工作区（专属）',
  }));

  // 8. 记忆注入
  if (opts.userMessage && MEMORY_TRIGGERS.test(opts.userMessage)) {
    const memPath = path.join(opts.dataDir, 'agents', opts.agentId, '.workspace', 'MEMORY.md');
    try {
      const mem = await fs.readFile(memPath, 'utf-8');
      if (mem.trim()) parts.push(`\n\n## 历史记忆\n${mem.trim()}`);
    } catch { /* 文件不存在 */ }
  }

  return parts.join('\n\n');
}

function buildOutputProtocol(tools: ToolDef[]): string {
  const toolList = renderToolList(tools);
  return `## 输出协议（严格遵守）

## 回复模式

你每次回复只能选择以下两种模式之一。

### 模式 A — 需要调用工具

输出结构：
<think>已知什么、缺少什么、决定做什么</think>
<action tool="工具名">{"参数":"值"}</action>

规则：
- 必须包含 <think> + 至少一个 <action>
- <action> 标签**只能**包含 tool 这一个属性，禁止添加 name="..." 或其它任何属性
- <action> 参数严格 JSON，[必填] 参数不得省略
- 禁止在收到工具结果前输出 <answer>
- **默认每轮只输出 1 个 <action>**。仅当多个动作完全独立、可以并行（如同时读 3 个文件用于对比）时才批处理。串行依赖必须分轮。
- 单轮工具数量上限 5 个；超过此数请拆分多轮。

### 模式 B — 直接回答用户

输出结构：
<think>推理过程和最终结论依据</think>
<answer>完整的回答内容</answer>
<note>简短提醒（≤3句话）</note>

规则：
- 必须包含 <think> + <answer>
- <note> 仅用于简短风险提醒，可省略
- 禁止包含 <action>

---

工具执行后你会收到包含 <result> 的回复，解读后继续行动或给出答案。

## 协议自检（每次输出前默念）

❌ 不要在 <action> 后输出未包标签的自然语言（要么放 <answer> 里，要么删掉）
❌ 不要在等待 <result> 时就输出 <answer>
❌ 不要忘记把最终结论包在 <answer>...</answer> 里

## 系统行为告知（了解即可，无需操作）

- 如果你的输出因长度限制被截断（标签未闭合），系统会自动要求你继续输出剩余内容。
- 如果你的回复中既没有 <action> 也没有 <answer>，系统会要求你明确下一步。
- 不要因为担心输出过长而省略关键内容——系统有续写机制保障完整输出。
- 工具调用没有硬性次数上限，复杂任务可以多轮调用直到完成。

## 可用工具

${toolList}`;
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
  <action tool="ask">{"question":"遇到了什么类型的问题？","options":"[\\"代码报错\\",\\"界面异常\\",\\"功能不符预期\\"]"}</action>

  错误示例（question 写成段落、options 过多且重叠）：
  <action tool="ask">{"question":"能具体说说发生了什么吗？比如出现了什么错误提示、哪个功能异常、或者在哪一步卡住了？尽量描述一下你看到的现象，我好帮你排查。","options":"[\\"代码报错或运行异常\\",\\"文件/数据丢失或损坏\\",\\"界面显示不正常\\",\\"操作没有达到预期效果\\",\\"系统或环境出现问题\\",\\"其他问题\\"]"}</action>

  对比要点：
  - question 是一句问句，不是一段引导语
  - options 互斥、≤4 项、每项简短，"其他"由前端自由输入框承载，不必显式列出
  - **格式铁律**：ask 只能通过 <action tool="ask">{...}</action> 调用。禁止写成 <ask question="..."> 这类属性标签，那样无法被识别。

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
