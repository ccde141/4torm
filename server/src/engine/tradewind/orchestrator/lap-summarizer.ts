/**
 * 圈间摘要器 —— carryOver='summary' 模式
 *
 * 职责：把上圈产出（output.json）压成一段"必要摘要"，作为下圈结转输入。
 * - 从 output.source 查找终点 Agent 的模型
 * - 读取不到 output.json 时返回空字符串；找不到模型或模型调用失败时返回原文
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { callLLM } from '../../shared/llm-bridge';
import { loadAgent } from '../../shared/agent-loader';
import type { WorkflowGraph } from '../foundation/types';
import type { ContextMessage } from '../../shared/types';

export interface LapSummarizeParams {
  runDir: string;
  dataDir: string;
  graph: WorkflowGraph;
  /** 用户自定义摘要指令，可空 → 用默认 */
  summaryPrompt?: string;
  signal?: AbortSignal;
}

const DEFAULT_SUMMARY_PROMPT = `你是圈间交接摘要专家。下面是本轮工作流的完整产出。
请压缩成一段"下一轮必要摘要"，要求：
- 只保留下一轮真正需要携带的信息：关键结论、已产出物的位置（文件路径）、未完成项、下一轮应注意的约束
- 丢弃冗长正文、寒暄、过程性描述
- 完整产出已存档于磁盘，摘要无需复述全文
- 直接输出摘要正文，不加前缀说明`;

/** 读取 output.json 并拼接正文；文件缺失、无效或内容为空时返回 null。 */
async function readOutput(runDir: string): Promise<{ source: string; text: string } | null> {
  try {
    const raw = await fs.readFile(path.join(runDir, 'output.json'), 'utf-8');
    const arr = JSON.parse(raw) as Array<{ source?: string; content?: string }>;
    const text = arr.map(e => e.content ?? '').filter(Boolean).join('\n\n---\n\n');
    if (!text.trim()) return null;
    return { source: arr[0]?.source ?? '', text };
  } catch {
    return null;
  }
}

/** 顺 source 节点 id → agentId → agent.model；拿不到返回 '' */
async function resolveSourceModel(graph: WorkflowGraph, dataDir: string, sourceId: string): Promise<string> {
  const node = graph.nodes.find(n => n.id === sourceId && n.type === 'agent');
  const agentId = node && typeof node.config.agentId === 'string' ? node.config.agentId : '';
  if (!agentId) return '';
  const agent = await loadAgent(dataDir, agentId);
  return agent?.model ?? '';
}

/**
 * 生成圈间摘要。模型未配置或调用失败时返回原文；读取不到产出时返回空字符串。
 * 源 Agent 配置读取失败会抛出。
 */
export async function summarizeLap(params: LapSummarizeParams): Promise<string> {
  const out = await readOutput(params.runDir);
  if (!out) return ''; // 无产出，下圈只带种子/框定语
  const fallback = out.text;

  const model = await resolveSourceModel(params.graph, params.dataDir, out.source);
  if (!model) return fallback; // 找不到模型 → 降级为原样带全文（等价 accumulate）

  const messages: ContextMessage[] = [
    { role: 'system', content: params.summaryPrompt?.trim() || DEFAULT_SUMMARY_PROMPT },
    { role: 'user', content: out.text },
  ];
  try {
    const result = await callLLM({
      dataDir: params.dataDir,
      fullModelKey: model,
      messages,
      options: { temperature: 0.3 },
      signal: params.signal,
    });
    const summary = result.content.trim();
    return summary || fallback;
  } catch {
    return fallback; // LLM 失败 → 降级，不断链
  }
}
