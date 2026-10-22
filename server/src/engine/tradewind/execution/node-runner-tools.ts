/**
 * NodeRunner 工具执行器 —— delegate 和 contact 的实现
 *
 * 从 node-runner.ts 拆出，控制单文件行数。
 */

import { runSubAgent, type SubAgentEvent } from './sub-agent-runner';
import {
  findRunnerByLabel,
  tryRegisterWait,
  clearWait,
} from './contact-registry';
import type { NodeRunner, NodeRunnerEvent, NodeRunnerOpts } from './node-runner';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolCallOutcome } from '../../shared/react/native-loop.js';
import { SUB_AGENT_MAX_ROUNDS } from '../../shared/sub-agent-budget.js';
import { subAgentReport } from '../../shared/sub-agent-result.js';
import { rememberToolImages } from '../../shared/tool-media-access.js';
import type { ToolImageRef } from '../../shared/types.js';

// ── Delegate ─────────────────────────────────────────────────────

export async function execDelegate(
  opts: NodeRunnerOpts,
  args: Record<string, string>,
  emit: (ev: NodeRunnerEvent) => void,
): Promise<ToolCallOutcome> {
  const task = args.task || '';
  const context = args.context || '';
  const subSystemPrompt = args.systemPrompt || '';
  const delegateId = `del-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  emit({ type: 'delegate-start', task, delegateId });
  const images: ToolImageRef[] = [];

  const result = await runSubAgent({
    task, context, systemPrompt: subSystemPrompt,
    agentId: opts.agentId,
    dataDir: opts.dataDir,
    signal: opts.signal,
    maxRounds: SUB_AGENT_MAX_ROUNDS,
    parentSandboxLevel: opts.sandboxLevel,
    emit: (ev: SubAgentEvent) => {
      switch (ev.type) {
        case 'token':
          emit({ type: 'delegate-token', delegateId, content: ev.data.t });
          break;
        case 'tool_call':
          emit({ type: 'delegate-tool-call', delegateId, tool: ev.data.tool, args: ev.data.args });
          break;
        case 'tool_result':
          if (ev.data.toolImages?.length) {
            images.push(...ev.data.toolImages);
            rememberToolImages({ dataDir: opts.dataDir, feature: 'tradewind', target: {
              workflowId: opts.workflowId, executionId: opts.executionId, nodeId: opts.nodeId, kind: 'node' } }, ev.data.toolImages);
          }
          emit({ type: 'delegate-tool-result', delegateId, tool: ev.data.tool, result: ev.data.result, ok: ev.data.ok,
            ...(ev.data.toolImages?.length ? { toolImages: ev.data.toolImages } : {}) });
          break;
      }
    },
  });

  const summary = subAgentReport(result);

  // 归档 sub-agent meta + context
  if (opts.persistDir) {
    const subDir = path.join(opts.persistDir, 'sub-agents', delegateId);
    try {
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, 'meta.json'), JSON.stringify({
        delegateId, task,
        status: result.status,
        rounds: result.rounds,
        timestamp: new Date().toISOString(),
      }, null, 2));
      await fs.writeFile(path.join(subDir, 'summary.txt'), summary);
    } catch { /* 归档失败不阻塞 */ }
  }

  emit({ type: 'delegate-done', delegateId, summary, status: result.status });
  return { result: `[${result.status}] ${summary}`, ok: result.status === 'success',
    ...(images.length ? { toolImages: images.slice(-4) } : {}) };
}

// ── Contact ──────────────────────────────────────────────────────

export async function execContact(
  opts: NodeRunnerOpts,
  args: Record<string, string>,
  emit: (ev: NodeRunnerEvent) => void,
  /** 本轮正在服务的 contact 源节点 ID（非 contact 轮为 null）——死锁提示分流用 */
  currentContactFrom?: string | null,
): Promise<ToolCallOutcome> {
  opts.signal.throwIfAborted();
  const target = args.target || '';
  const message = args.message || '';

  emit({ type: 'contact-start', target });

  // 1. 查找目标 runner
  const found = findRunnerByLabel(target, opts.executionId);
  if (!found) {
    const err = `联络失败：找不到名为「${target}」的协作者。请检查团队名册中的名称。`;
    emit({ type: 'contact-done', target, result: err, ok: false });
    return { result: err, ok: false };
  }

  // 2. 死锁检测：环被拒时，按"目标是否正是当前正在服务你联络的那一方"分流措辞——
  //    - 是：目标此刻确实在等你回复本轮 contact，"在当前回复里处理"是准确可行的建议。
  //    - 否：目标的请求还排在你队列里（或它在等别的链路），本轮你根本没在处理它，
  //      让它"当场处理"会误导。此时应先做完手头的活，它的请求会另轮到你处理。
  const canWait = tryRegisterWait(opts.nodeId, found.nodeId, opts.executionId);
  if (!canWait) {
    const servingTarget = currentContactFrom != null && currentContactFrom === found.nodeId;
    const err = servingTarget
      ? `联络被系统拒绝：「${target}」正在等你回复它本轮的联络，反向联络会造成死锁。请不要再联络它，直接在本次回复里给出它需要的内容。`
      : `联络被系统拒绝：与「${target}」互相联络会造成死锁（它也正需要你的回复）。请勿等待它——先用你已有的信息把手头工作推进/收口；它的请求会在另一轮交由你处理。`;
    emit({ type: 'contact-done', target, result: err, ok: false });
    return { result: err, ok: false };
  }

  return await completeContact(opts, found.runner, target, message, emit);
}

async function completeContact(
  opts: NodeRunnerOpts, runner: NodeRunner, target: string, message: string,
  emit: (ev: NodeRunnerEvent) => void,
): Promise<ToolCallOutcome> {
  try {
    const selfLabel = opts.systemPrompt.match(/你当前的身份：(.+)/)?.[1] || opts.nodeId;
    const contactContent = `[系统信息：来自协作者「${selfLabel}」的联络]\n\n${message}`;

    const answer = await new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, output?: string) => {
        clearTimeout(timeout);
        opts.signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(output ?? '');
      };
      const onAbort = () => finish(new DOMException('本轮联络已中止', 'AbortError'));
      const timeout = setTimeout(() => {
        finish(new Error('contact 超时（20 分钟未响应）'));
      }, 20 * 60 * 1000);
      opts.signal.addEventListener('abort', onAbort, { once: true });
      if (opts.signal.aborted) { onAbort(); return; }

      try {
        runner.push({ source: 'contact', content: contactContent, contactFrom: opts.nodeId,
          onComplete: output => finish(undefined, output), onFailure: finish });
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });

    emit({ type: 'contact-done', target, result: answer, ok: true });
    return { result: `[系统信息：来自协作者「${target}」的回复]\n\n${answer}`, ok: true };
  } catch (e) {
    const err = `联络「${target}」失败：${(e as Error).message}`;
    emit({ type: 'contact-done', target, result: err, ok: false });
    return { result: err, ok: false };
  } finally {
    clearWait(opts.nodeId, opts.executionId);
  }
}
