import fs from 'node:fs/promises';
import path from 'node:path';
import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { activeMeetings } from '../../../engine/tradewind/nodes/meeting.js';
import { tradewindRunDir } from '../../../services/data-paths.js';
import { getActiveTradewindOrchestrator } from '../../../services/tradewind-execution.js';
import { sameTradewindDataRoot } from '../../../services/tradewind-execution-registry.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TradewindReadPort, TradewindReadIdentity } from '../application/read-port.js';
import { nodeStatuses } from './node-status-view.js';
import { projectAgentNodeConversation } from './agent-node-view.js';
import type { NodeSnapshot } from '../../../engine/tradewind/execution/node-runner.js';
import { readAgentMeetingConversation } from './agent-meeting-read.js';
import { readTokenUsageFile } from '../../../engine/tradewind/execution/token-usage.js';
import { projectNodeHistory } from '../../../engine/tradewind/execution/node-history-view.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { estimateCurrentInput } from '../../../engine/shared/llm-bridge.js';
import { estimateMeetingCurrentInput } from '../../../engine/tradewind/execution/meeting-current-input.js';

export function createTradewindReadPort(dataDir: string): TradewindReadPort {
  return {
    nodeStatuses: identity => nodeStatuses({ ...identity, dataDir }),
    nodeStatus: (nodeId, identity) => {
      const runner = activeNodeRunners.get(nodeId, resolveExecution(identity, dataDir));
      if (!runner) throw missing('节点尚未激活');
      if (!sameTradewindDataRoot(runner.getDataDir(), dataDir)) throw missing('节点执行身份不匹配');
      if (identity?.workflowId && runner.getIdentity().workflowId !== identity.workflowId) throw missing('节点执行身份不匹配');
      return { busy: runner.isBusy(), ...runner.getIdentity() };
    },
    nodeSnapshot: (nodeId, identity) => nodeSnapshot(dataDir, nodeId, identity),
    meetingStatus: (nodeId, identity) => meetingStatus(nodeId, identity, dataDir),
    agentNodeConversation: input => agentNodeConversation(dataDir, input),
    agentMeetingConversation: input => readAgentMeetingConversation(dataDir, input),
  };
}

async function agentNodeConversation(
  dataDir: string, input: { workflowId: string; executionId: string; nodeId: string; limit: number },
) {
  const active = getActiveTradewindOrchestrator({ ...input, dataDir });
  const sameExecution = active?.getWorkflowId() === input.workflowId
    && active.getExecutionId() === input.executionId;
  const runner = sameExecution ? activeNodeRunners.get(input.nodeId, input.executionId) : undefined;
  if (runner) return projectAgentNodeConversation(runner.getSnapshot(), input);
  const runDir = tradewindRunDir(dataDir, input.workflowId, input.executionId);
  const meta = await readJson(path.join(runDir, 'meta.json'));
  if (!isRecord(meta) || meta.workflowId !== input.workflowId
    || meta.executionId !== input.executionId) throw missing('工作流执行记录不存在');
  const raw = await readJson(path.join(runDir, 'nodes', input.nodeId, 'messages.json'));
  if (!Array.isArray(raw) || !raw.every(message => isRecord(message)
    && typeof message.role === 'string' && typeof message.content === 'string')) {
    throw frameworkError({ code: 'TRADEWIND_NODE_RECORD_INVALID', kind: 'internal',
      message: '节点会话记录格式无效', source: 'tradewind.read', retryable: false });
  }
  const tokenUsage = await readTokenUsageFile(path.join(runDir, 'nodes', input.nodeId, 'usage.json'));
  const snapshot: NodeSnapshot = { messages: projectNodeHistory(raw as ContextMessage[]),
    roundLog: [], busy: false, lastSeq: 0, tokenUsage };
  return projectAgentNodeConversation(snapshot, input);
}

async function readJson(file: string): Promise<unknown> {
  let raw: string;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('不是常规文件');
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) throw missing('节点会话记录不存在');
    throw error;
  }
  try { return JSON.parse(raw) as unknown; }
  catch (error) { throw frameworkError({ code: 'TRADEWIND_NODE_RECORD_INVALID', kind: 'internal',
    message: '节点会话记录损坏', source: 'tradewind.read', retryable: false }, { cause: error }); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function nodeSnapshot(dataDir: string, nodeId: string, identity?: TradewindReadIdentity) {
  const requestedExecution = resolveExecution(identity, dataDir);
  const runner = activeNodeRunners.get(nodeId, requestedExecution);
  if (runner && !sameTradewindDataRoot(runner.getDataDir(), dataDir)) throw missing('节点执行身份不匹配');
  if (runner && identity?.workflowId && runner.getIdentity().workflowId !== identity.workflowId) throw missing('节点执行身份不匹配');
  if (runner) {
    const currentInput = await runner.getCurrentInput();
    return { ...runner.getSnapshot(), ...runner.getIdentity(), ...(currentInput ? { currentInput } : {}) };
  }
  const orchestrator = getActiveTradewindOrchestrator({ ...identity, dataDir });
  const executionId = identity?.executionId ?? orchestrator?.getExecutionId();
  const workflowId = identity?.workflowId ?? orchestrator?.getWorkflowId();
  if (executionId && workflowId) {
    const directory = tradewindRunDir(dataDir, workflowId, executionId);
    const meta = await readJson(path.join(directory, 'meta.json'));
    if (!isRecord(meta) || meta.workflowId !== workflowId || meta.executionId !== executionId) {
      throw missing('节点执行身份不匹配');
    }
    const file = path.join(directory,
      'nodes', nodeId, 'messages.json');
    try {
      const messages = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
      if (!Array.isArray(messages)) throw new Error('节点消息记录格式无效');
      const tokenUsage = await readTokenUsageFile(path.join(path.dirname(file), 'usage.json'));
      const currentInput = await estimateCurrentInput({ dataDir, fullModelKey: '', messages: messages as ContextMessage[] });
      return { messages: projectNodeHistory((messages as ContextMessage[]).slice(1)), roundLog: [], busy: false, lastSeq: 0,
        tokenUsage, workflowId, executionId, currentInput };
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
  return { messages: [], roundLog: [], busy: false, lastSeq: 0 };
}

function meetingStatus(nodeId: string, identity?: TradewindReadIdentity, dataDir?: string) {
  const meeting = activeMeetings.get(nodeId, resolveExecution(identity, dataDir));
  if (!meeting) throw missing('No active meeting');
  if (dataDir && !sameTradewindDataRoot(meeting.dataDir, dataDir)) throw missing('会议执行身份不匹配');
  if (identity?.workflowId && meeting.workflowId !== identity.workflowId) throw missing('会议执行身份不匹配');
  return estimateMeetingCurrentInput(meeting.dataDir, meeting.session, meeting.workspace).then(currentInput => ({
    currentInput,
    nodeId, workflowId: meeting.workflowId, executionId: meeting.executionId,
    round: meeting.session.round,
    busy: meeting.session.busy, runId: meeting.roundIdentity?.runId,
    phase: meeting.session.phase, messageCount: meeting.session.publicMessages.length,
    participants: meeting.session.participants,
    configuredParticipants: meeting.configuredParticipants,
    chairAgentId: meeting.session.chairAgentId,
    publicMessages: meeting.session.publicMessages,
    chairMessages: meeting.session.chairMessages,
    compactionNotice: meeting.session.compactionNotice,
    compactions: meeting.session.compactions,
    tokenUsage: meeting.session.usageRecorder.state,
    streamingCurrent: meeting.session.streamingCurrent || null,
  }));
}

function resolveExecution(identity?: TradewindReadIdentity, dataDir?: string): string | undefined {
  if (identity?.executionId) return identity.executionId;
  return getActiveTradewindOrchestrator({ ...identity, dataDir })?.getExecutionId();
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function missing(message: string) {
  return frameworkError({ code: 'TRADEWIND_NODE_NOT_ACTIVE', kind: 'not_found',
    message, source: 'tradewind.read', retryable: false });
}
