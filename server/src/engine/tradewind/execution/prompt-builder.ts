/**
 * 信风 Agent Prompt 构建器
 *
 * 与对流 prompt-builder 的差异：
 * - 注入 Note 内容（编译期静态注入，来自 note 边）
 * - 注入工作流身份（让 Agent 知道自己在多 Agent 协作系统中工作）
 * - 信封内容不再走 prompt，改为 user message 注入（agent.ts 流程）
 * - 长期记忆段（memorySection）由 agent.ts 经 recallMemory 召回后注入，可空
 *
 * 信风独立副本，可自主演进。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef } from '../../shared/tool-defs-loader';
import { buildSandboxSection, type SandboxLevel } from '../../shared/sandbox-prompt';
import { buildTextToolProtocol } from '../../shared/text-tool-prompt';
import { buildTradewindNodeMeta } from './meta-profiles.js';

/** 读取信风基础协作准则段（baseline.md，与本文件同级）。读不到则静默跳过。 */
function loadBaseline(): string {
  try {
    const p = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'baseline.md');
    return readFileSync(p, 'utf-8').trim();
  } catch {
    return '';
  }
}

// ── 类型 ──────────────────────────────────────────────────────────

export interface TradewindPromptParams {
  /** Agent 角色提示词 */
  rolePrompt: string;
  /** 长期记忆段（recallMemory 返回，可空——空则不渲染） */
  memorySection?: string;
  /** 工具定义列表 */
  toolDefs: ToolDef[];
  /** Note 内容（来自 note 边，多条拼合） */
  notes: string[];
  /** 节点显示名（在工作流中的身份标签） */
  nodeLabel: string;
  /** 团队名册：label + role 列表（含自身） */
  teamRoster: Array<{ label: string; role: string; isSelf: boolean }>;
  /** 工作目录（相对项目根，如 data/tradewind/workflows/{wfId}/workspace） */
  workspace: string;
  /** 工作区绝对路径（用于沙箱段展示） */
  workspaceAbs: string;
  /** 项目根绝对路径 */
  projectDir: string;
  /** 沙箱级别 */
  sandboxLevel: SandboxLevel;
  /** 是否允许 delegate（sub-agent 委托） */
  allowDelegate: boolean;
  // ── 环境信息（引擎自动注入） ──
  /** Agent 实体名称（如"牛顿"、"费曼"） */
  agentName: string;
  /** 执行批次 ID */
  executionId: string;
  /** 节点 ID */
  nodeId: string;
  /** 工作流 ID */
  workflowId: string;
  /** 运行平台 */
  platform: string;
  /** 今日日期 */
  today: string;
  /** 模型标识（如 claude-sonnet-4-20250514） */
  modelId: string;
  /** 模型族（预留扩展） */
  modelFamily?: 'claude' | 'gpt' | 'gemini' | 'other';
  /** 是否走原生工具调用模式（true 时使用精简协议段，不教标签格式） */
  native?: boolean;
  /**
   * 是否自动模式。注意：信封交接段对**所有 native agent**都注入（因两模式 envelope 轮
   * 都用 complete_task 封口投递），autoMode 只调措辞——自动=无人实时驱动、需自主做完；
   * 手动=人可随时介入对话，仅处理上游信封时才 complete_task。text agent（仅手动）不注入。
   */
  autoMode?: boolean;
  /**
   * 下游感知：本节点 complete_task 封口后，信封自动交给的下游节点 label 列表。
   * 注入 prompt 让 agent 明白"我有自动交接路径、下游是谁"，避免误用 contact 前向甩锅。
   * 空数组=终点节点（无 handoff 下游），不渲染下游感知句。
   */
  downstreamLabels?: string[];
}

/** 构建信风 Agent 的完整 system prompt */
export function buildTradewindSystemPrompt(params: TradewindPromptParams): string {
  const sections: string[] = [];

  // §0 环境信息（引擎自动注入，agent 无需理解但工具调用时可参考）
  sections.push([
    `<env>`,
    `  模型: ${params.modelId}`,
    `  平台: ${params.platform}`,
    `  日期: ${params.today}`,
    `  工作流: ${params.workflowId}`,
    `  执行批次: ${params.executionId}`,
    `  节点: ${params.nodeId}`,
    `  工作区: ${params.workspaceAbs}`,
    `  项目根: ${params.projectDir}`,
    `</env>`,
  ].join('\n'));

  // §0.5 共同元认知 + 信风节点身份
  sections.push(buildTradewindNodeMeta());

  // §1 角色定义
  sections.push(`# 角色\n\n${params.rolePrompt}`);

  // §1.2 基础协作准则（baseline.md；角色只能补充专业规范）
  const baseline = loadBaseline();
  if (baseline) sections.push(baseline);

  // §1.5 长期记忆（跨任务经验，recallMemory 召回；空则跳过）
  if (params.memorySection?.trim()) sections.push(params.memorySection.trim());

  // §2 工作环境（信风协作程序背景 + 消息来源识别）
  // native agent 处理上游信封时必须 complete_task 封口投递；text agent 的自然语言回答直接交接。
  const handoffDesc = params.native
    ? `处理上游信封的任务完成后，必须调用 complete_task 封口交接（详见下方「交接信封」段）——普通文本不代表完成、不会交给下游。`
    : `完成后直接输出自然语言，会自动打包成信封交给下游。`;
  sections.push([
    `# 你的工作环境`,
    ``,
    `你运行在「信风」多 Agent 协作程序中，与人类及其他 Agent 持续协作。`,
    ``,
    `你当前的身份：${params.nodeLabel}`,
    `你的名字：${params.agentName}`,
    ``,
    `## 你和谁协作`,
    `- 人类可以随时与你对话、交办任务、调整方向`,
    `- 其他节点可以通过 contact 联络你，你也可以主动联络他们`,
    `- 收到信封时，按其中的职责要求完成当前阶段任务，${handoffDesc}`,
    ``,
    `## 谁在跟你说话`,
    `上下文中所有消息只有两种来源：`,
    `- 系统信息（以「[系统信息：...]」开头）—— 包括流程指令（信封）、其他节点的联络消息，按内容处理`,
    `- 人类消息（无系统标注）—— 优先级更高，可覆盖既定计划`,
  ].join('\n'));

  // §3 团队名册（如果有协作者）
  if (params.teamRoster.length > 1) {
    const rosterLines = params.teamRoster.map(m => {
      const selfMark = m.isSelf ? '（← 你）' : '';
      return `- ${m.label}：${m.role}${selfMark}`;
    });
    sections.push([
      `# 团队名册`,
      ``,
      `你所在的工作流中有以下协作者：`,
      ...rosterLines,
      ``,
      `需要其他节点协助时，使用 contact 工具联络。`,
    ].join('\n'));
  }

  // §4 Note 行为约束（如果有）
  if (params.notes.length > 0) {
    const noteBlock = params.notes.map((n, i) => `[约束 ${i + 1}] ${n}`).join('\n\n');
    sections.push(`# 行为约束\n\n${noteBlock}`);
  }

  // §5 输出协议 + 工具列表（native / text 分支）
  if (params.native) {
    sections.push(buildNativeProtocol(params.toolDefs, params.allowDelegate, params.sandboxLevel, params.teamRoster));
  } else {
    sections.push(buildTradewindTextProtocol(params.toolDefs, params.allowDelegate, params.teamRoster));
  }

  // §5.5 信封交接段（所有 native agent；教信封累积 + complete_task 显式交接）。
  // text agent 以普通自然语言作为可靠终结信号，不需要 complete_task。
  if (params.native) sections.push(buildEnvelopeHandoffSection(params.autoMode ?? false, params.downstreamLabels ?? []));

  // §5.6 长期记忆（工具说明 + 记忆自觉引导；文本/native 都注入）
  sections.push(buildMemorySection());

  // §6 「基地 + 沙箱」段
  sections.push(buildSandboxSection({
    workspaceAbs: params.workspaceAbs,
    projectDir: params.projectDir,
    sandboxLevel: params.sandboxLevel,
    workspaceLabel: '工作流共享工作区',
  }));

  return sections.join('\n\n---\n\n');
}

// ── 长期记忆段 ────────────────────────────────────────────────────

/**
 * 记忆工具说明 + 「记忆自觉」行为引导。
 * 文本/native 都注入：native 已有 schema，此段主要承载"何时该主动记"的引导。
 * 工具执行由引擎侧拦截（execMemoryTool），会自动补时间戳与来源，agent 无需关心。
 */
function buildMemorySection(): string {
  return `# 你的长期记忆

你有跨任务、跨工作流的长期记忆。它独立于当前对话——这次记下的，下次相关任务开始时会自动出现在你上方的「你的经验记忆」里。

## 何时主动写入（用 memory_write）
工作中出现以下情形，**主动**记一条，别等：
- 人类纠正了你的做法，或表达了明确偏好 → category=feedback
- 你踩了坑并找到规避方式 → category=pitfall
- 你确认了一个可跨任务复用的事实（约定、路径、接口、数据位置）→ category=fact
- 值得回访的外部资源 → category=reference

## 怎么写得好
- summary 一句话说清，是召回匹配的关键；detail 写"是什么/为什么/下次怎么用"
- 写入前先用 memory_list 看有没有同类，**有则不要重复写**
- 只记真正可复用的经验，不记一次性的过程细节（那些归档已留存）

## 可用工具
- memory_write(summary, detail, category, tags?) — 记一条（自动带时间戳）
- memory_list() — 查已有条目，避免重复
- memory_read(slug) — 读某条全文`;
}

// ── 信封交接说明段 ────────────────────────────────────────────────

/**
 * 信封交接说明：教 native 模型「攒信封 → 显式 complete_task 交接」的工作方式。
 * 两模式共用（envelope 轮机制同构），autoMode 只改开头对"人是否在场"的措辞。
 * text 模型不注入此段，也拿不到这些信封工具。
 */
function buildEnvelopeHandoffSection(autoMode: boolean, downstreamLabels: string[]): string {
  const intro = autoMode
    ? `你正运行在**自动模式**：没有人类实时驱动，你要自主把当前任务做完，并**显式交接**给下游节点。`
    : `处理上游信封的任务时，你要多轮工作把它做完，并**显式交接**给下游节点。（人类可随时与你对话——那只是聊天，不触发交接；只有处理上游信封、调用 complete_task 才会向下游传递。）`;

  // 下游感知句：让 agent 明白自己有自动交接路径、下游是谁——从根上消除"用 contact 把整包工作
  // 前向甩锅"的动机。终点节点（无下游）则明说交接即完成本工作流。
  const downstreamLine = downstreamLabels.length
    ? `\n\n**你的自动下游**：complete_task 封口后，信封会**自动交给「${downstreamLabels.join('、')}」**——你无需、也不应该用 contact 把本职工作推给他们；做完你这一步、封口交接即可，系统会自动流转。`
    : `\n\n**你是流程终点**：complete_task 封口即完成整个工作流本轮，无下游节点。`;

  return `# 交接信封

**当前你处于信封轮**：你收到的是上游传来的工作信封。完成**你这一步**的职责后，用 complete_task 封口交接给下游。${downstreamLine}

${intro}

## 交接信封（逐步累积）

你要交给下游的**硬信息**（结论、数据、决策、约束等）通过「信封」传递。用以下工具在多轮工作中逐步维护它：
- **envelope_add(text)** — 往信封加一条交接要点（一条一个要点，简洁完整、可独立理解）
- **envelope_list()** — 查看信封当前所有条目及其 id
- **envelope_remove(id)** — 按 id 删掉写错或过时的条目

信封是增量累积的：随着工作推进，随时把可交接的结论沉淀进去，不必等到最后一次性写。

## 完成任务（显式交接）

确认最终目标达成后，调用 **complete_task**（可附一段自由备注：口语化的交接说明、注意事项）。这会**封口信封并交给下游**。

⚠ **关键规则**：
- 只有调用 complete_task 才会向下游交接。**普通文本 / 自然语言答复不代表完成，也不会交接任何东西。**
- 不要用"我完成了""任务已结束"这类话表示完成——必须实际调用 complete_task。
- 即使工作受阻或结论不完美，也要把**已有结论 + 受阻原因**写进信封后调用 complete_task，把能交接的先交接下去，绝不停在半空。`;
}

// ── 工具协议构建 ──────────────────────────────────────────────────

/**
 * Sub-Agent 委托能力说明（信风版本）
 *
 * 设计要点：
 * - delegate 不在 registry.json，是引擎层虚拟工具
 * - sub-agent 使用相同的统一执行策略
 * - 母 agent 必须在 context 中明确告知 sub-agent 工作路径
 */
function buildDelegateSection(): string {
  return `

### delegate
  描述: 将子任务委托给独立的 SubAgent 执行。SubAgent 拥有与你相同的工具集和执行策略，在隔离环境中独立完成任务后返回结果摘要。
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

### 关于 SubAgent 的能力

SubAgent 单次最多 90 轮工具调用，可独立完成相当复杂的任务（深度探索、多文件分析、整模块梳理都没问题）。不必把任务切得过碎——一个 SubAgent 完全可以读十几个文件做完整分析。

仅当任务确实庞大（如同时审计多个互不相关的大模块）时，才按模块拆成几个并行 delegate，让每个聚焦一块、互不干扰。

### 必须 delegate 的场景
1. 任务要求分析/理解一个项目、模块、或代码库
2. 任务要求对比多个方案/文件/实现
3. 任务需要读取多个文件才能回答
4. 任务要求做调研、梳理、盘点

### 不要 delegate 的场景
- 已经知道答案的问题（纯推理）
- 列示完文件后发现读取较少文件就能回答
- 需要先与人类确认才能继续的决策`;
}

function buildTradewindTextProtocol(
  toolDefs: ToolDef[],
  allowDelegate: boolean,
  teamRoster: Array<{ label: string; role: string; isSelf: boolean }>,
): string {
  const tools = toolDefs.filter(tool => tool.name !== 'delegate' && tool.name !== 'contact');
  if (allowDelegate) tools.push(buildDelegateToolDef());
  if (teamRoster.length > 1) tools.push(buildContactToolDef(teamRoster));

  const guidance = [
    buildTextToolProtocol(tools),
    allowDelegate ? buildDelegateSection() : '',
    teamRoster.length > 1 ? buildContactGuidance(teamRoster) : '',
  ];
  return guidance.filter(Boolean).join('\n\n');
}

function buildDelegateToolDef(): ToolDef {
  return {
    name: 'delegate',
    description: '将子任务委托给独立的 SubAgent 执行并返回结果摘要。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '清晰、具体、可独立执行的任务描述' },
        context: { type: 'string', description: '必要背景及涉及文件的绝对路径' },
        systemPrompt: { type: 'string', description: 'SubAgent 的角色定义' },
      },
      required: ['task', 'context', 'systemPrompt'],
    },
  };
}

function buildContactToolDef(
  teamRoster: Array<{ label: string; role: string; isSelf: boolean }>,
): ToolDef {
  const targets = teamRoster.filter(member => !member.isSelf).map(member => member.label).join('、');
  return {
    name: 'contact',
    description: '同步联络工作流中的另一位协作者并等待回复。',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: `目标协作者名称，可选：${targets}` },
        message: { type: 'string', description: '要传达的问题、请求或补充信息' },
      },
      required: ['target', 'message'],
    },
  };
}

function buildContactGuidance(
  teamRoster: Array<{ label: string; role: string; isSelf: boolean }>,
): string {
  const targets = teamRoster.filter(member => !member.isSelf).map(member => member.label).join('、');
  return `## contact 联络说明

- 可选目标：${targets}
- 对方会完整处理消息并返回结论，过程中可能调用工具
- 不要向正在联络你的节点发起反向联络，否则会形成循环
- 收到联络后直接回复，不要反过来 contact 对方
- 只在需要对方的专业能力或缺少必要信息时使用 contact

调用示例：
\`\`\`json
{"type":"tool_call","name":"contact","arguments":{"target":"节点名称","message":"要传达的具体内容"}}
\`\`\``;
}

/**
 * 原生模式协议段：工具调用由 provider 的结构化通道承载。
 * 原生 function calling 由 provider 处理，模型直接自然语言输出即可。
 *
 * 工具列表精简（只列名称 + 描述），不教参数 JSON 格式（schema 已通过 tools 参数注入）。
 * delegate / contact 段保留语义说明（拆分原则、死锁规避等）但去掉调用示例。
 */
function buildNativeProtocol(
  toolDefs: ToolDef[],
  allowDelegate: boolean,
  sandboxLevel: SandboxLevel,
  teamRoster: Array<{ label: string; role: string; isSelf: boolean }>,
): string {
  const tools = toolDefs.filter(t => t.name !== 'delegate' && t.name !== 'contact');
  const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');

  const sections: string[] = [`# 工作方式

你可以调用工具来完成任务。需要时直接发起工具调用，系统会执行并把结果返回给你。

- 需要外部信息或执行操作时，调用对应工具
- 串行依赖请分多轮调用，不要一次性堆叠
- 完成后用自然语言直接给出最终答复，无需特殊格式

## 可用工具

${toolList}`];

  if (allowDelegate) {
    sections.push(`## delegate 委托

可调用 \`delegate\` 把子任务交给独立 SubAgent。SubAgent 在隔离上下文中工作，最多 90 轮，可独立完成相当复杂的任务（深度探索、多文件分析、整模块梳理都没问题）。

**执行策略**：SubAgent 同样以工作区解析相对路径、接受绝对路径，并保留控制面写保护。涉及文件/目录时必须在 context 中写明绝对路径。

**必须委托**的场景：分析整个模块/项目、对比多方案、读取多个文件才能回答、调研盘点。

**不要委托**的场景：纯推理、列示完文件后发现读取较少文件就能答、需要先与人类确认决策。`);
  }

  if (teamRoster.length > 1) {
    const others = teamRoster.filter(m => !m.isSelf).map(m => m.label).join('、');
    sections.push(`## contact 联络

可调用 \`contact\` 联络工作流中的其他节点（可选目标：${others}）。

适合使用 contact 的场景（**拉取协助 / 索取信息**）：
- 需要对方的专业能力协助**你手头**的工作
- 缺少完成本职所必需的信息，需要向对方索取（如上游数据、接口规格、决策依据）

**不适合**使用 contact 的场景：
- **把有自动下游的整包工作推给别人**——那不是你该做的事，用 complete_task 交接给自动下游即可
- 你只是想让下游"接着干"——下游会在收到你封口的信封后自动开始，无需你 contact 催办

注意：收到联络后直接回复，不要反过来 contact 对方（会死锁）`);
  }

  return sections.join('\n\n');
}
