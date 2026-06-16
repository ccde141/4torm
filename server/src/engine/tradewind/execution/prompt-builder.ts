/**
 * 信风 Agent Prompt 构建器
 *
 * 与对流 prompt-builder 的差异：
 * - 注入 Note 内容（编译期静态注入，来自 note 边）
 * - 注入工作流身份（让 Agent 知道自己在多 Agent 协作系统中工作）
 * - 信封内容不再走 prompt，改为 user message 注入（agent.ts 流程）
 * - 无 memory/history 段落（信风 Agent 无持久记忆）
 *
 * 信风独立副本，可自主演进。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef } from '../../shared/tool-defs-loader';
import { buildSandboxSection, type SandboxLevel } from '../../shared/sandbox-prompt';

/** 读取信风元认知段（meta.md，与本文件同级）。读不到则静默跳过。 */
function loadMeta(): string {
  try {
    const metaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'meta.md');
    const meta = readFileSync(metaPath, 'utf-8');
    return meta.trim();
  } catch {
    return '';
  }
}

// ── 类型 ──────────────────────────────────────────────────────────

export interface TradewindPromptParams {
  /** Agent 角色提示词 */
  rolePrompt: string;
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

  // §0.5 元认知（meta.md，紧接环境头之后）
  const meta = loadMeta();
  if (meta) sections.push(meta);

  // §1 角色定义
  sections.push(`# 角色\n\n${params.rolePrompt}`);

  // §2 工作环境（信风协作程序背景 + 消息来源识别）
  const handoffDesc = params.native
    ? `完成后用自然语言给出最终答复即可，会自动打包成信封交给下游。`
    : `完成后输出 <answer>，会自动打包成信封交给下游。`;
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
    sections.push(buildToolProtocol(params.toolDefs, params.allowDelegate, params.sandboxLevel, params.teamRoster));
  }

  // §6 「基地 + 沙箱」段
  sections.push(buildSandboxSection({
    workspaceAbs: params.workspaceAbs,
    projectDir: params.projectDir,
    sandboxLevel: params.sandboxLevel,
    workspaceLabel: '工作流共享工作区',
  }));

  return sections.join('\n\n---\n\n');
}

// ── 工具协议构建 ──────────────────────────────────────────────────

/**
 * Sub-Agent 委托能力说明（信风版本，沙箱级别动态注入）
 *
 * 设计要点：
 * - delegate 不在 registry.json，是引擎层虚拟工具
 * - sub-agent 继承母 agent 的沙箱级别
 * - 母 agent 必须在 context 中明确告知 sub-agent 工作路径
 */
function buildDelegateSection(parentSandboxLevel: SandboxLevel): string {
  return `

### delegate
  描述: 将子任务委托给独立的 SubAgent 执行。SubAgent 拥有与你相同的工具集和沙箱权限，在隔离环境中独立完成任务后返回结果摘要。
  参数:
    task: string [必填] — 任务描述（清晰、具体、可独立执行）
    context: string [必填] — 必要的背景信息（SubAgent 看不到你的对话历史；**必须在此说明 SubAgent 需要工作的绝对路径或目录**）
    systemPrompt: string [必填] — SubAgent 的角色定义

## 关于 SubAgent 的沙箱权限

你派出的 SubAgent **继承你当前的沙箱级别（${parentSandboxLevel}）**：
- 你能访问的文件，SubAgent 也能访问；你不能访问的，SubAgent 同样不能。
- 委托涉及具体文件/目录时，**必须在 context 中写明绝对路径**，因为 SubAgent 看不到你的上下文。
- 如果 SubAgent 在结果摘要中报告"路径越权"错误，说明任务路径写错了或确实需要更高沙箱权限。

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

function buildToolProtocol(
  toolDefs: ToolDef[],
  allowDelegate: boolean,
  sandboxLevel: SandboxLevel,
  teamRoster: Array<{ label: string; role: string; isSelf: boolean }>,
): string {
  // delegate / contact 不在 registry，所以这里 filter 是兜底
  const tools = toolDefs.filter(t => t.name !== 'delegate' && t.name !== 'contact');

  const toolList = tools.map(t => {
    const requiredSet = new Set<string>(
      Array.isArray((t.parameters as any)?.required)
        ? (t.parameters as any).required as string[]
        : [],
    );
    const props = (t.parameters as {
      properties?: Record<string, { type?: string; description?: string }>;
    })?.properties || {};
    const params = Object.keys(props).length > 0
      ? Object.entries(props)
          .map(([k, v]) => {
            const mark = requiredSet.has(k) ? ' [必填]' : ' [可选]';
            return `    ${k}: ${v.type || 'string'}${mark} — ${v.description || ''}`;
          })
          .join('\n')
      : '    无参数';
    return `### ${t.name}\n  描述: ${t.description}\n  参数:\n${params}`;
  }).join('\n\n');

  return `# 输出协议（严格遵守）

你每次回复只能选择以下两种模式之一。

## 模式 A — 需要调用工具
<action tool="工具名">{"参数":"值"}</action>

规则：
- <action> 标签**只能**包含 tool 这一个属性，禁止添加 name="..." 或其它任何属性
- <action> 参数严格 JSON，[必填] 参数不得省略
- **默认每轮只输出 1 个 <action>**。仅当多个动作完全独立、可以并行时才批处理。串行依赖必须分轮。
- 单轮工具数量上限 5 个；超过此数请拆分多轮。
- 禁止在收到工具结果前输出最终结果

## 模式 B — 工作完成，输出结果
<answer>你的最终输出</answer>

规则：
- <answer> 内容将作为本节点的交接内容传递给下游
- 确保内容完整、可被下游节点直接使用

工具执行后你会收到 <result> 回复，解读后继续行动或输出 <answer>。

## 系统行为告知（了解即可，无需操作）

- 如果你的输出因长度限制被截断（标签未闭合），系统会自动要求你继续输出剩余内容。
- 如果你的回复中既没有 <action> 也没有 <answer>，系统会要求你明确下一步。
- 不要因为担心输出过长而省略关键内容——系统有续写机制保障完整输出。
- 工具调用没有硬性次数上限，复杂任务可以多轮调用直到完成。

## 可用工具

${toolList}${allowDelegate ? buildDelegateSection(sandboxLevel) : ''}${teamRoster.length > 1 ? buildContactSection(teamRoster) : ''}

## 协议自检（每次输出前默念）

❌ 不要在 <action> 后输出未包标签的自然语言
❌ 不要在等待 <result> 时就输出 <answer>
❌ 不要忘记把最终结论包在 <answer>...</answer> 里`;
}

/** contact 工具说明段落 */
function buildContactSection(teamRoster: Array<{ label: string; role: string; isSelf: boolean }>): string {
  const others = teamRoster.filter(m => !m.isSelf).map(m => m.label);
  return `

### contact
  描述: 联络工作流中的另一位协作者。对方会完整处理你的消息并返回回复。适用于需要其他专业角色协助的场景。
  参数:
    target: string [必填] — 目标协作者名称（可选值：${others.join('、')}）
    message: string [必填] — 你要传达的内容（问题、请求、交办事项等）

  注意：
  - 对方会认真处理你的消息并返回结论，过程中可能调用工具。
  - 不要向正在联络你的节点发起反向联络，否则会造成死锁。
  - 如果你收到来自某协作者的联络消息，处理完后直接回复即可，不要反过来 contact 对方。
  - 优先自己解决问题，只有确实需要对方专业能力时才使用 contact。
  - 当你发现完成任务所需的信息不足（如缺少上游数据、接口规格、决策依据等），应主动联络相关协作者索取，而非凭假设行动。

  调用示例:
  <action tool="contact">{"target":"节点名称","message":"你要传达的具体内容"}</action>`;
}

/**
 * 原生模式协议段：不教 <action>/<answer> 标签格式。
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

**沙箱继承**：SubAgent 继承你的沙箱级别（${sandboxLevel}）。涉及文件/目录时必须在 context 中写明绝对路径。

**必须委托**的场景：分析整个模块/项目、对比多方案、读取多个文件才能回答、调研盘点。

**不要委托**的场景：纯推理、列示完文件后发现读取较少文件就能答、需要先与人类确认决策。`);
  }

  if (teamRoster.length > 1) {
    const others = teamRoster.filter(m => !m.isSelf).map(m => m.label).join('、');
    sections.push(`## contact 联络

可调用 \`contact\` 联络工作流中的其他节点（可选目标：${others}）。

适合使用 contact 的场景：
- 需要对方的专业能力或已有成果
- 缺少完成本职所必需的信息
- 某个子任务更适合由特定节点承担——可以直接交办给对方

注意：收到联络后直接回复，不要反过来 contact 对方（会死锁）`);
  }

  return sections.join('\n\n');
}
